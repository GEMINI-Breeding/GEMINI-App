"""Minimal GEMINIbase REST client for agent tooling (stdlib only).

Connection comes from the environment, or from ``agent/.env``:

    GEMI_API       base URL of the REST API (default http://127.0.0.1:7777)
    GEMI_EMAIL     login
    GEMI_PASSWORD
    GEMI_BUCKET    storage bucket (default "gemini")
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Optional

# Two places. In a source checkout both are the `agent/` folder. The packaged
# executable (`gemi-agent`, inside the desktop app) is read-only, so it uses:
#   GEMI_AGENT_HOME       writable: config.json, .env, work/, clusters/ (the person's settings and state)
#   GEMI_AGENT_RESOURCES  read-only files shipped with the app: hpc/, backend.tgz, stack-version
# The app sets both when it starts the service. Run by hand from a terminal (or
# by a coding agent as an MCP server) the executable finds the same two places
# itself, so the terminal and the app share one set of settings.
_SOURCE_DIR = Path(__file__).resolve().parent.parent
_FROZEN = Path(getattr(sys, "_MEIPASS", "")) if getattr(sys, "frozen", False) else None
APP_ID = "com.gemi.desktop"


def _packaged_home() -> Path:
    """The desktop app's data folder for the agent (where Tauri's app_data_dir puts it)."""
    if sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    elif os.name == "nt":
        base = Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming")
    else:
        base = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
    return base / APP_ID / "agent"


def _packaged_resources() -> Optional[Path]:
    """The files shipped beside the executable: Contents/Resources/agent in a macOS
    app, an `agent` folder beside it on Windows, /usr/lib/<name>/agent for a Linux package."""
    exe = Path(sys.executable).resolve().parent
    for cand in (exe.parent / "Resources" / "agent", exe / "agent", exe.parent / "lib" / "GEMI" / "agent",
                 exe.parent / "lib" / "gemi" / "agent"):
        if (cand / "hpc" / "gemi-hpc").is_file():
            return cand
    return None


if os.environ.get("GEMI_AGENT_HOME"):
    AGENT_DIR = Path(os.environ["GEMI_AGENT_HOME"]).resolve()
else:
    AGENT_DIR = _packaged_home() if _FROZEN else _SOURCE_DIR
if os.environ.get("GEMI_AGENT_RESOURCES"):
    RESOURCES: Optional[Path] = Path(os.environ["GEMI_AGENT_RESOURCES"]).resolve()
else:
    RESOURCES = _packaged_resources() if _FROZEN else None
# The packaged executable carries the skills inside itself.
SKILLS_DIR = (_FROZEN / "skills") if _FROZEN else (_SOURCE_DIR / "skills")
AGENT_DIR.mkdir(parents=True, exist_ok=True)
RETRY_DELAYS = (1, 3, 10, 30)


def _load_env_file() -> None:
    env = AGENT_DIR / ".env"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


# Called with the job type after every job submitted through a Client.
SUBMIT_HOOKS: list = []


class ApiError(RuntimeError):
    def __init__(self, status: int, body: str, url: str):
        super().__init__(f"HTTP {status} for {url}: {body[:300]}")
        self.status = status
        self.body = body


class Client:
    def __init__(self, token: Optional[str] = None) -> None:
        """`token`: act as an already logged-in user (the agent service passes
        the browser's token); otherwise log in with GEMI_EMAIL/GEMI_PASSWORD."""
        _load_env_file()
        self.base = os.environ.get("GEMI_API", "http://127.0.0.1:7777").rstrip("/")
        self.bucket = os.environ.get("GEMI_BUCKET", "gemini")
        self._token: Optional[str] = token or os.environ.get("GEMI_TOKEN") or None

    def token(self) -> str:
        if self._token is None:
            self._token = self._login()
        return self._token

    # -- plumbing ---------------------------------------------------------
    def _login(self) -> str:
        email, password = os.environ.get("GEMI_EMAIL"), os.environ.get("GEMI_PASSWORD")
        if not email or not password:
            raise RuntimeError("Set GEMI_EMAIL and GEMI_PASSWORD (environment or agent/.env).")
        req = urllib.request.Request(
            f"{self.base}/api/users/login/access-token",
            data=json.dumps({"email": email, "password": password}).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)["access_token"]

    def request(self, method: str, path: str, body: Any = None, timeout: int = 120) -> bytes:
        """One API call; network errors and 5xx are retried a few times."""
        if self._token is None:
            self._token = self._login()
        url = f"{self.base}{path}"
        data = json.dumps(body).encode() if body is not None else None
        for attempt in range(len(RETRY_DELAYS) + 1):
            headers = {"Authorization": f"Bearer {self._token}"}
            if data is not None:
                headers["Content-Type"] = "application/json"
            try:
                req = urllib.request.Request(url, data=data, headers=headers, method=method)
                with urllib.request.urlopen(req, timeout=timeout) as r:
                    return r.read()
            except urllib.error.HTTPError as e:
                text = e.read().decode("utf-8", "replace")
                if e.code < 500 or attempt == len(RETRY_DELAYS):
                    raise ApiError(e.code, text, url) from None
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                if attempt == len(RETRY_DELAYS):
                    raise RuntimeError(f"cannot reach {url}: {e}") from None
            time.sleep(RETRY_DELAYS[attempt])
        raise AssertionError("unreachable")

    def upload_chunk(self, chunk: bytes, index: int, total: int, file_identifier: str, object_name: str,
                     experiment_id: Optional[str] = None, dataset_id: Optional[str] = None) -> None:
        """One part of a chunked upload (multipart/form-data), retried patiently:
        a long batch over a slow or flaky link must not die on one part."""
        if self._token is None:
            self._token = self._login()
        boundary = "----gemiagent" + os.urandom(8).hex()
        fields = {"chunk_index": index, "total_chunks": total, "file_identifier": file_identifier,
                  "object_name": object_name}
        if experiment_id:
            fields["experiment_id"] = experiment_id
        if dataset_id:
            fields["dataset_id"] = dataset_id
        crlf = chr(13) + chr(10)
        head = "".join(f'--{boundary}{crlf}Content-Disposition: form-data; name="{k}"{crlf}{crlf}{v}{crlf}'
                       for k, v in fields.items())
        head += (f'--{boundary}{crlf}Content-Disposition: form-data; name="file_chunk"; filename="part{index}"{crlf}'
                 f"Content-Type: application/octet-stream{crlf}{crlf}")
        body = head.encode() + chunk + f"{crlf}--{boundary}--{crlf}".encode()
        url = f"{self.base}/api/files/upload_chunk"
        delays = (1, 3, 10, 30, 60, 60, 120, 300)
        for attempt in range(len(delays) + 1):
            try:
                req = urllib.request.Request(url, data=body, method="POST", headers={
                    "Authorization": f"Bearer {self._token}",
                    "Content-Type": f"multipart/form-data; boundary={boundary}"})
                with urllib.request.urlopen(req, timeout=600) as r:
                    r.read()
                    return
            except urllib.error.HTTPError as e:
                text = e.read().decode("utf-8", "replace")
                if (e.code < 500 and e.code not in (408, 429)) or attempt == len(delays):
                    raise ApiError(e.code, text, url) from None
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                if attempt == len(delays):
                    raise RuntimeError(f"cannot reach {url}: {e}") from None
            time.sleep(delays[attempt])

    def get_json(self, path: str) -> Any:
        return json.loads(self.request("GET", path) or b"null")

    def post_json(self, path: str, body: Any) -> Any:
        return json.loads(self.request("POST", path, body) or b"null")

    def _object_url(self, kind: str, object_name: str) -> str:
        return f"/api/files/{kind}/{self.bucket}/{urllib.parse.quote(object_name)}"

    # -- files ------------------------------------------------------------
    def download(self, object_name: str) -> bytes:
        return self.request("GET", self._object_url("download", object_name), timeout=300)

    def thumbnail(self, object_name: str, size: int) -> bytes:
        """A WebP no larger than size x size (32-800); cached by the server."""
        return self.request("GET", self._object_url("thumbnail", object_name) + f"?size={size}")

    def list_dir(self, prefix: str) -> list[dict]:
        return self.get_json(self._object_url("list", prefix.rstrip("/"))) or []

    # -- plot-marking versions ---------------------------------------------
    def versions(self, directory: str) -> list[dict]:
        return self.post_json("/api/plot_geometry/versions/list", {"directory": directory}) or []

    def load_version(self, directory: str, version: Optional[int] = None) -> dict:
        body: dict = {"directory": directory}
        if version:
            body["version"] = version
        return self.post_json("/api/plot_geometry/versions/load", body)

    def save_version(self, directory: str, snapshot: dict, name: Optional[str] = None,
                     version: Optional[int] = None) -> dict:
        body: dict = {"directory": directory, "state_snapshot": snapshot}
        if name:
            body["name"] = name
        if version:
            body["version"] = version
        return self.post_json("/api/plot_geometry/versions/save", body)

    def list_page(self, prefix: str, limit: int = 100, offset: int = 0) -> dict:
        return self.get_json(self._object_url("list_paginated", prefix.rstrip("/")) + f"?limit={limit}&offset={offset}")

    def delete_object(self, object_name: str) -> None:
        self.request("DELETE", self._object_url("delete", object_name))

    # -- entities -----------------------------------------------------------
    ENTITY_NAME_KEY = {"experiments": "experiment_name", "sites": "site_name", "populations": "population_name",
                       "seasons": "season_name", "sensor_platforms": "sensor_platform_name", "sensors": "sensor_name",
                       "datasets": "dataset_name"}

    def entities(self, kind: str) -> list[dict]:
        return self.get_json(f"/api/{kind}/all?limit=500&offset=0") or []

    def ensure_entity(self, kind: str, name: str, **extra: Any) -> dict:
        """The entity of this kind with this name, created if missing."""
        key = self.ENTITY_NAME_KEY[kind]
        for e in self.entities(kind):
            if e.get(key) == name:
                return e
        return self.post_json(f"/api/{kind}", {key: name, **extra})

    def me(self) -> dict:
        return self.get_json("/api/users/me")

    # -- jobs ---------------------------------------------------------------
    def jobs(self, status: Optional[str] = None, job_type: Optional[str] = None, limit: int = 100) -> list[dict]:
        q = [f"limit={limit}"]
        if status:
            q.append(f"status={status}")
        if job_type:
            q.append(f"job_type={job_type}")
        return self.get_json("/api/jobs/all?" + "&".join(q)) or []

    def cancel_job(self, job_id: str) -> dict:
        return self.post_json(f"/api/jobs/{job_id}/cancel", {})

    def submit_job(self, job_type: str, parameters: dict, experiment_id: Optional[str]) -> dict:
        body: dict = {"job_type": job_type, "parameters": parameters}
        if experiment_id:
            body["experiment_id"] = experiment_id
        job = self.post_json("/api/jobs/submit", body)
        for hook in SUBMIT_HOOKS:           # e.g. make sure the worker for this job type is up
            try:
                hook(job_type)
            except Exception:
                pass
        return job

    def job(self, job_id: str) -> dict:
        return self.get_json(f"/api/jobs/{job_id}")
