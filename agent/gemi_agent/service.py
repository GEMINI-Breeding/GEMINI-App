"""The agent service: what the app's home page talks to.

A small HTTP server (stdlib only) that runs agent conversations in the
stack, beside the workers. It holds the model configuration, starts runs,
and serves their event log; the tools act as the signed-in user, using the
token the browser sends.

    python -m gemi_agent serve [--port 7790] [--host 127.0.0.1]

All routes are under /agent/ and need the app's `Authorization: Bearer`
token (checked against the REST API):

    GET  /agent/health                 (no auth)
    GET  /agent/auto_login             (no auth; this computer only) a session for the stack's owner
                                       account, so the app opens without a login screen
    PUT  /agent/auto_login             {require_sign_in: bool}  (administrators)
    GET  /agent/config                 model settings (key masked)
    PUT  /agent/config                 change them (superusers)
    POST /agent/config/test            one round trip to the model
    GET  /agent/skills                 skills with descriptions
    GET  /agent/status                 same as the `status` tool
    GET  /agent/runs                   this user's runs, newest first
    POST /agent/runs                   {text, skill?, track?, groups?} -> run
    GET  /agent/runs/<id>?since=N      status + events from N
    POST /agent/runs/<id>/message      {text}
    POST /agent/runs/<id>/approve      {approved: bool}
    POST /agent/runs/<id>/cancel
    GET  /agent/image?path=...         a picture a tool produced
    GET  /agent/next_step?run=<id>     what is due for a Process-tab run (the `next_step` tool)
    GET  /agent/facts/<run id>         what the person has said about a run; PUT {fact: value} to change
    GET  /agent/compute                what runs on the cluster: core, workers, model
    POST /agent/compute/start          {name, where?}   (administrators)
    POST /agent/compute/stop           {name}
    POST /agent/compute/reconnect      reopen the tunnels to the cluster
    PUT  /agent/compute/prefs          {auto_start?, idle_stop_minutes?}
"""
from __future__ import annotations

import json
import mimetypes
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Optional

from .client import AGENT_DIR, Client
from .runner import RUNS, Run, load_config, save_config, test_connection
from .tools import TOOLS, use_client

WORK = (AGENT_DIR / "work").resolve()
_runs: dict[str, Run] = {}
_users: dict[str, tuple[float, dict]] = {}      # token -> (checked at, user)
_lock = threading.Lock()


class HttpError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


ACCESS = AGENT_DIR / "work" / "access.json"
ALLOWED_ORIGINS = {o.strip() for o in __import__("os").environ.get("GEMI_AGENT_ORIGINS", "").split(",") if o.strip()}


def _require_sign_in() -> bool:
    try:
        return bool(json.loads(ACCESS.read_text()).get("require_sign_in"))
    except (OSError, json.JSONDecodeError):
        return False


def _owner_token() -> str:
    """Sign in as the stack's own account: the one in agent/.env, else the
    cluster stack's first account (read through the gate)."""
    import os
    import urllib.request

    c = Client()
    email, password = os.environ.get("GEMI_EMAIL"), os.environ.get("GEMI_PASSWORD")
    if not email or not password:
        from .hpc_tools import _gemi_hpc, _kv, active_cluster

        cluster = active_cluster()
        if not cluster:
            raise HttpError(404, "no account is configured for signing in automatically")
        login = _kv(_gemi_hpc(["login"], cluster, timeout=60))
        email, password = login.get("GEMINI_FIRST_SUPERUSER_EMAIL"), login.get("GEMINI_FIRST_SUPERUSER_PASSWORD")
        if not email or not password:
            raise HttpError(404, "the cluster stack has no account to sign in with")
    req = urllib.request.Request(c.base + "/api/users/login/access-token",
                                 data=json.dumps({"email": email, "password": password}).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)["access_token"]
    except Exception as e:
        raise HttpError(502, f"could not sign in to the stack: {type(e).__name__}") from None


SETUP_USER = {"email": "local-setup", "is_superuser": True, "setup": True}


def _api_up() -> bool:
    import urllib.request

    try:
        with urllib.request.urlopen(Client().base + "/healthz", timeout=3) as r:
            return r.status == 200
    except Exception:
        return False


def _user(token: Optional[str], local: bool = False) -> dict:
    """Who is asking. Normally the app's signed-in user. Before any stack
    exists there is nothing to sign in to: then a request from this computer
    itself is the *setup user*, who can configure the model and run the
    cluster-setup tools — the first-run path."""
    if not token:
        if local and not _api_up():
            return SETUP_USER
        raise HttpError(401, "sign in to the app first")
    hit = _users.get(token)
    if hit and time.time() - hit[0] < 300:
        return hit[1]
    try:
        me = Client(token=token).me()
    except Exception:
        if local and not _api_up():       # the stack went away under a signed-in browser
            return SETUP_USER
        raise HttpError(401, "the app did not accept this session") from None
    _users[token] = (time.time(), me)
    return me


def _public_config() -> dict:
    cfg = load_config()
    cfg["api_key"] = "***" if cfg.get("api_key") else ""
    return cfg


def _saved_runs(owner: str) -> list[dict]:
    """Runs from earlier service sessions (read-only records)."""
    out = []
    for p in RUNS.glob("*.json") if RUNS.exists() else []:
        if p.stem in _runs or p.name.endswith(".state.json"):
            continue
        try:
            r = json.loads(p.read_text())
        except json.JSONDecodeError:
            continue
        if r.get("owner") == owner:
            if r["status"] in ("running", "idle", "awaiting_approval"):
                r["status"] = "waiting"           # the service restarted under it; a message continues it
            out.append(r)
    return out


def _brief(r: dict) -> dict:
    return {k: r.get(k) for k in ("id", "title", "status", "steps", "created", "model", "event_count")}


class Handler(BaseHTTPRequestHandler):
    server_version = "gemi-agent/0.1"

    def log_message(self, fmt: str, *args: Any) -> None:  # quiet: one line per error only
        if args and str(args[1])[:1] in "45":
            super().log_message(fmt, *args)

    # -- plumbing -----------------------------------------------------------
    def _cors(self) -> None:
        """The desktop app's window is another origin than this service
        (tauri://localhost, http://tauri.localhost). Only origins the app
        named when it started the service (GEMI_AGENT_ORIGINS) may read answers."""
        origin = self.headers.get("Origin") or ""
        if origin and origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
            self.send_header("Access-Control-Max-Age", "600")

    def do_OPTIONS(self) -> None:  # noqa: N802  (preflight)
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _send(self, status: int, body: Any, content_type: str = "application/json") -> None:
        data = body if isinstance(body, bytes) else json.dumps(body, default=str).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _body(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(n))
        except json.JSONDecodeError:
            raise HttpError(400, "body is not JSON") from None

    def _token(self, query: dict) -> Optional[str]:
        h = self.headers.get("Authorization") or ""
        if h.lower().startswith("bearer "):
            return h[7:].strip()
        return (query.get("token") or [None])[0]       # <img> tags cannot send headers

    def _handle(self, method: str) -> None:
        url = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(url.query)
        parts = [p for p in url.path.split("/") if p]
        try:
            if parts[:1] != ["agent"]:
                raise HttpError(404, "not found")
            route = parts[1:]
            if route == ["health"]:
                return self._send(200, {"ok": True})
            if route == ["mode"]:
                from .hpc_tools import active_cluster

                up = _api_up()
                return self._send(200, {"mode": "ready" if up else "setup", "stack_reachable": up,
                                        "cluster": active_cluster(), "require_sign_in": _require_sign_in()})
            if route == ["auto_login"] and method == "GET":
                # Hands out the owner's session, so: this computer only (also by Host
                # header, against DNS rebinding), and never when sign-in is required.
                host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]")
                if self.client_address[0] not in ("127.0.0.1", "::1") or host not in ("127.0.0.1", "localhost", "::1"):
                    raise HttpError(403, "automatic sign-in is only available on the computer running the app")
                if _require_sign_in():
                    return self._send(200, {"enabled": False})
                return self._send(200, {"enabled": True, "token": _owner_token()})
            token = self._token(query)
            user = _user(token, local=self.client_address[0] in ("127.0.0.1", "::1"))
            if user.get("setup"):
                token = None
            self._send(200, self._route(method, route, query, token, user))  # type: ignore[arg-type]
        except HttpError as e:
            self._send(e.status, {"error": str(e)})
        except _Raw as raw:
            self._send(200, raw.data, raw.content_type)
        except Exception as e:  # never take the server down for one request
            self._send(500, {"error": f"{type(e).__name__}: {e}"})

    def do_GET(self) -> None:  # noqa: N802
        self._handle("GET")

    def do_POST(self) -> None:  # noqa: N802
        self._handle("POST")

    def do_PUT(self) -> None:  # noqa: N802
        self._handle("PUT")

    # -- routes ---------------------------------------------------------------
    def _route(self, method: str, route: list[str], query: dict, token: str, user: dict) -> Any:
        owner = str(user.get("email") or user.get("id"))
        if route == ["auto_login"] and method == "PUT":
            if not user.get("is_superuser"):
                raise HttpError(403, "only an administrator can change how the app signs in")
            ACCESS.parent.mkdir(parents=True, exist_ok=True)
            ACCESS.write_text(json.dumps({"require_sign_in": bool(self._body().get("require_sign_in"))}))
            return {"require_sign_in": _require_sign_in()}
        if route == ["config"] and method == "GET":
            return _public_config()
        if route == ["config"] and method == "PUT":
            if not user.get("is_superuser"):
                raise HttpError(403, "only an administrator can change the model settings")
            save_config(self._body())
            return _public_config()
        if route == ["config", "test"] and method == "POST":
            try:
                return test_connection(load_config())
            except Exception as e:
                return {"ok": False, "error": str(e)}
        if route == ["skills"]:
            return TOOLS["skills"]["fn"]({})["result"]
        if route == ["tools"]:
            return [{"name": n, "group": t.get("group"), "description": t["description"],
                     "destructive": bool(t.get("destructive"))} for n, t in TOOLS.items()]
        if route == ["status"]:
            if user.get("setup"):
                return {"setup": True, "jobs_active": [], "workers_busy": [], "uploads": [], "experiments": [],
                        "jobs_recent": {}, "pending_job_types": [],
                        "note": "No processing stack is connected yet."}
            use_client(Client(token=token))
            return TOOLS["status"]["fn"]({})["result"]
        if route[:1] == ["compute"]:
            from . import compute

            if not user.get("setup"):
                use_client(Client(token=token))
            if route == ["compute"] and method == "GET":
                return compute.overview(fresh=bool(query.get("fresh")), with_jobs=not user.get("setup"))
            # Starting and stopping cluster jobs uses this computer's SSH access: administrators only.
            if not user.get("is_superuser"):
                raise HttpError(403, "only an administrator can start or stop what runs on the cluster")
            body = self._body()
            try:
                if route == ["compute", "start"] and method == "POST":
                    return compute.start(str(body.get("name")), body.get("where"))
                if route == ["compute", "stop"] and method == "POST":
                    return compute.stop(str(body.get("name")))
                if route == ["compute", "reconnect"] and method == "POST":
                    return compute.reconnect()
                if route == ["compute", "prefs"] and method == "PUT":
                    return compute.set_prefs(body)
            except (ValueError, RuntimeError) as e:
                raise HttpError(400, str(e)) from None
        if route == ["next_step"] and method == "GET" and not user.get("setup"):
            use_client(Client(token=token))
            return TOOLS["next_step"]["fn"]({"run": (query.get("run") or [""])[0]})["result"]
        if len(route) == 2 and route[0] == "facts" and not user.get("setup"):
            from . import guide

            if method == "GET":
                return {"facts": guide.facts_of(route[1]), "keys": guide.FACT_KEYS}
            if method == "PUT":
                try:
                    return {"facts": guide.save_facts(route[1], self._body()), "keys": guide.FACT_KEYS}
                except ValueError as e:
                    raise HttpError(400, str(e)) from None
        if route == ["image"]:
            path = Path((query.get("path") or [""])[0]).resolve()
            if WORK not in path.parents or not path.is_file():
                raise HttpError(404, "no such picture")
            raise _Raw(path.read_bytes(), mimetypes.guess_type(path.name)[0] or "application/octet-stream")
        if route == ["runs"] and method == "GET":
            with _lock:
                live = [r.snapshot(since=10**9) for r in _runs.values() if r.owner == owner]
            rows = live + _saved_runs(owner)
            return sorted((_brief(r) for r in rows), key=lambda r: r["created"] or 0, reverse=True)[:50]
        if route == ["runs"] and method == "POST":
            body = self._body()
            text = str(body.get("text") or "").strip()
            if not text:
                raise HttpError(400, "say what the agent should do")
            setup = bool(user.get("setup"))
            run = Run(load_config(), client=None if setup else Client(token=token),
                      skill=body.get("skill") or ("connect-hpc" if setup else None),
                      context={"track": body.get("track"),
                               "situation": "first-run setup: no processing stack is connected yet" if setup else None},
                      groups=["hpc"] if setup else (body.get("groups") or None), owner=owner)
            with _lock:
                _runs[run.id] = run
            threading.Thread(target=run.send, args=(text,), daemon=True).start()
            return run.snapshot()
        if len(route) >= 2 and route[0] == "runs":
            run = _runs.get(route[1])
            if run is None:
                saved = next((r for r in _saved_runs(owner) if r["id"] == route[1]), None)
                if saved is None:
                    raise HttpError(404, "no such run")
                if method == "GET":
                    return saved
                # Continue a run from before the service restarted.
                run = Run.restore(route[1], load_config(), Client(token=token))
                if run is None:
                    raise HttpError(410, "this run was recorded before runs could be continued; start a new one")
                with _lock:
                    _runs[run.id] = run
            if run.owner != owner:
                raise HttpError(404, "no such run")
            if len(route) == 2 and method == "GET":
                return run.snapshot(since=int((query.get("since") or ["0"])[0]))
            if method == "POST" and route[2:] == ["message"]:
                if run.status == "running":
                    raise HttpError(409, "the agent is still working")
                text = str(self._body().get("text") or "").strip()
                if not text:
                    raise HttpError(400, "empty message")
                run.cancelled = False
                threading.Thread(target=run.send, args=(text,), daemon=True).start()
                return {"ok": True}
            if method == "POST" and route[2:] == ["approve"]:
                if run.status != "awaiting_approval":
                    raise HttpError(409, "nothing is waiting for approval")
                approved = bool(self._body().get("approved"))
                threading.Thread(target=run.resolve, args=(approved,), daemon=True).start()
                return {"ok": True}
            if method == "POST" and route[2:] == ["cancel"]:
                run.cancel()
                return {"ok": True}
        raise HttpError(404, "not found")


class _Raw(Exception):
    def __init__(self, data: bytes, content_type: str):
        self.data, self.content_type = data, content_type


def _alive(pid: int) -> bool:
    import os

    if os.name == "nt":
        import ctypes

        k = ctypes.windll.kernel32
        k.OpenProcess.restype = ctypes.c_void_p
        handle = k.OpenProcess(0x00100000, False, pid)          # SYNCHRONIZE
        if not handle:
            return False
        try:
            return k.WaitForSingleObject(ctypes.c_void_p(handle), 0) == 0x102   # WAIT_TIMEOUT: still running
        finally:
            k.CloseHandle(ctypes.c_void_p(handle))
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def _exit_with_parent(pid: int) -> None:
    import os

    while _alive(pid):
        time.sleep(2)
    os._exit(0)      # tunnels and cluster jobs are separate processes and are left as they are


def serve(argv: list[str]) -> None:
    port, host = 7790, "127.0.0.1"
    for i, a in enumerate(argv):
        if a == "--port":
            port = int(argv[i + 1])
        if a == "--host":
            host = argv[i + 1]
        if a == "--parent-pid":
            # Started by the desktop app: stop when the app is gone, however it ended
            # (a crash or a forced quit never reaches the app's own cleanup).
            threading.Thread(target=_exit_with_parent, args=(int(argv[i + 1]),), daemon=True).start()
    from . import compute

    threading.Thread(target=compute.watch, daemon=True).start()
    cfg = load_config()
    print(f"gemi-agent service on http://{host}:{port}/agent  (model {cfg['model']} at {cfg['base_url']})", flush=True)
    ThreadingHTTPServer((host, port), Handler).serve_forever()
