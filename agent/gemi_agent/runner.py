"""The agent loop: a chat model that works the app through the tools.

Model-agnostic on purpose. It talks to any OpenAI-compatible chat endpoint
(vLLM, Ollama, llama.cpp, LM Studio, hosted APIs) and by default does *not*
rely on the server's function-calling support: the model asks for a tool by
replying with one JSON object, which every instruction-following model can
do. `tool_mode: native` switches to the API's own tool calls.

Configuration (agent/config.json, or environment — see SETUP.md):

    base_url    e.g. http://localhost:8000/v1
    model       the name the endpoint serves
    api_key     optional
    tool_mode   text (default) | native
    vision      true if the model accepts images (needed for plot marking)
"""
from __future__ import annotations

import base64
import io
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Callable, Optional

from .client import AGENT_DIR, Client
from .policy import tool_approval
from .tools import TOOLS, check_args, use_client

CONFIG_PATH = AGENT_DIR / "config.json"
RUNS = AGENT_DIR / "work" / "runs"
DEFAULTS = {"base_url": "http://127.0.0.1:8000/v1", "model": "gemma4", "api_key": "", "tool_mode": "text",
            "vision": True, "max_steps": 60, "max_images": 4, "image_side": 1400, "temperature": 0.2,
            "max_tokens": 2000, "request_timeout_s": 600,
            # skill: the model sees a short core tool list, and reading a skill adds that stage's tools
            # (small models choose far better from 20 tools than from 60). all: every tool from the start.
            "tool_scope": "skill"}

# Always available: orientation, progress, and the things every stage needs.
CORE_TOOLS = ("next_step", "continue_run", "run_facts", "read_skill", "status", "process_runs", "processes", "start_process", "stop_process",
              "hpc", "jobs", "job_detail", "wait_jobs", "cancel_job", "tasks", "wait_task", "browse", "datasets",
              "entities")
_SKILL_TOOLS: dict[str, list[str]] = {}


def skill_tools(name: str) -> list[str]:
    """The tools a skill uses: every tool its text names in code style. Derived
    from the text, so a skill and its tool list cannot drift apart."""
    if name not in _SKILL_TOOLS:
        from .app_tools import SKILLS_DIR

        path = SKILLS_DIR / name / "SKILL.md"
        text = path.read_text(encoding="utf-8") if path.exists() else ""
        found = set(re.findall(r"`([a-z_]+)[`\s({]", text)) | set(re.findall(r'"tool":\s*"([a-z_]+)"', text))
        _SKILL_TOOLS[name] = [n for n in TOOLS if n in found]
    return _SKILL_TOOLS[name]


def load_config() -> dict:
    cfg = dict(DEFAULTS)
    if CONFIG_PATH.exists():
        cfg.update(json.loads(CONFIG_PATH.read_text()))
    # A model started with `gemi-hpc llm up` publishes its address in a file.
    env_file = os.environ.get("GEMI_LLM_ENV_FILE")
    if env_file and Path(env_file).exists():
        kv = dict(line.split("=", 1) for line in Path(env_file).read_text().splitlines() if "=" in line)
        cfg.update({"base_url": kv.get("LLM_URL", cfg["base_url"]), "model": kv.get("LLM_MODEL_NAME", cfg["model"]),
                    "api_key": kv.get("LLM_KEY", cfg["api_key"])})
    for key, var in (("base_url", "GEMI_LLM_URL"), ("model", "GEMI_LLM_MODEL"), ("api_key", "GEMI_LLM_KEY"),
                     ("tool_mode", "GEMI_LLM_TOOL_MODE")):
        if os.environ.get(var):
            cfg[key] = os.environ[var]
    return cfg


def save_config(patch: dict) -> dict:
    stored = json.loads(CONFIG_PATH.read_text()) if CONFIG_PATH.exists() else {}
    for k, v in patch.items():
        if k in DEFAULTS and not (k == "api_key" and v in (None, "", "***")):
            stored[k] = v
    CONFIG_PATH.write_text(json.dumps(stored, indent=1))
    try:
        os.chmod(CONFIG_PATH, 0o600)
    except OSError:
        pass
    return load_config()


# ── model call ───────────────────────────────────────────────────────────────

def chat(cfg: dict, messages: list[dict], tools: Optional[list[dict]] = None) -> dict:
    body: dict[str, Any] = {"model": cfg["model"], "messages": messages, "temperature": cfg["temperature"],
                            "max_tokens": cfg["max_tokens"]}
    if tools:
        body["tools"] = tools
    headers = {"Content-Type": "application/json", "User-Agent": "gemi-agent/0.1"}
    if cfg.get("api_key"):
        headers["Authorization"] = f"Bearer {cfg['api_key']}"
    url = cfg["base_url"].rstrip("/") + "/chat/completions"
    last = ""
    for attempt, delay in enumerate((2, 5, 15, 0)):
        try:
            req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers)
            with urllib.request.urlopen(req, timeout=cfg["request_timeout_s"]) as r:
                return json.load(r)["choices"][0]["message"]
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:400]}"
            if e.code < 500 and e.code != 429:
                break
        except (urllib.error.URLError, TimeoutError, ConnectionError, KeyError, json.JSONDecodeError) as e:
            last = f"{type(e).__name__}: {e}"
        if delay:
            time.sleep(delay)
    raise RuntimeError(f"model endpoint {url} failed: {last}")


def test_connection(cfg: dict) -> dict:
    t = time.time()
    msg = chat({**cfg, "max_tokens": 20}, [{"role": "user", "content": "Reply with the single word: ready"}])
    return {"ok": True, "reply": (msg.get("content") or "").strip()[:80], "seconds": round(time.time() - t, 1),
            "model": cfg["model"], "base_url": cfg["base_url"]}


# ── prompt ───────────────────────────────────────────────────────────────────

def _catalog(names: list[str]) -> str:
    lines = []
    for n in names:
        t = TOOLS[n]
        req = set(t["schema"].get("required", []))
        args = ", ".join(f"{k}{'*' if k in req else ''}" for k in t["schema"]["properties"])
        lines.append(f"- {n}({args}){' [asks the person first]' if tool_approval(n) else ''}: {t['description']}")
    return "\n".join(lines)


def system_prompt(cfg: dict, names: list[str], context: dict) -> str:
    scoped = len(names) < len(TOOLS)
    parts = [
        "You are the GEMINI app's agent. You help a plant-breeding researcher run the app: uploading data, "
        "running pipeline steps, marking plots, checking what is running. You act only through the tools below.",
        "Rules:\n"
        "1. To move a pipeline run forward, call continue_run: it does the due steps itself and tells you what it "
        "needs. To only see what is due, call next_step. Record what the person tells you about a run with run_facts.\n"
        "2. Before a stage you have not done in this conversation, call read_skill for it and follow it"
        + (" (that also adds the stage's tools to your list).\n" if scoped else ".\n") +
        "3. Never guess names, ids or paths: take them from a tool result, or ask the person.\n"
        "4. One tool call at a time. Read the result before the next step.\n"
        "5. Long work runs in the background: start it, then wait with wait_jobs or wait_task (not repeated checks).\n"
        "6. Workers start on their own when a job needs one; the result's `workers` note says so.\n"
        "7. Some calls stop and ask the person first (deleting data, starting or ending the cluster session). "
        "Say plainly what will happen and why before you make such a call.\n"
        "8. If something fails, report the exact error and what you tried. Never claim success you did not verify.\n"
        "9. When the task is done or you need the person's decision, answer in plain text, briefly.",
    ]
    if cfg["tool_mode"] == "text":
        parts.append(
            "To call a tool, reply with ONLY one JSON object and nothing else:\n"
            '{"tool": "<name>", "args": {<arguments>}}\n'
            "Arguments marked * are required. To answer the person, reply in plain text (no JSON).")
    parts.append("Tools:\n" + _catalog(names))
    skill_list = TOOLS["skills"]["fn"]({})["result"]
    if skill_list:
        parts.append("Skills (exact names for read_skill):\n" +
                     "\n".join(f"- {s['name']}: {s['description']}" for s in skill_list))
    if context:
        parts.append("Context:\n" + "\n".join(f"- {k}: {v}" for k, v in context.items() if v))
    return "\n\n".join(parts)


def native_tools(names: list[str]) -> list[dict]:
    return [{"type": "function", "function": {"name": n, "description": TOOLS[n]["description"],
                                              "parameters": TOOLS[n]["schema"]}} for n in names]


_JSON_BLOCK = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.S)


_GEMMA_CALL = re.compile(r"call:([A-Za-z_][A-Za-z0-9_]*)\s*[{(]")
_CALL_JSON = re.compile(r"call:\s*\{")
_BARE_KEY = re.compile(r'([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:')
_SPECIAL = re.compile(r"<\|?/?[a-z_]+\|?>")


def _loose_json(text: str) -> Optional[dict]:
    """The JSON object at the start of `text`; also accepts unquoted keys
    ({name: "x"}), which is how some models write arguments."""
    for candidate in (text, _BARE_KEY.sub(r'\1"\2":', text)):
        try:
            obj, _ = json.JSONDecoder().raw_decode(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            return obj
    return None


def parse_text_call(text: str) -> Optional[tuple[str, dict]]:
    """A tool request in a plain-text reply. Accepts the JSON form asked for
    in the prompt (bare or fenced) and the `call:name{args}` form Gemma
    models are trained to write. Only the first request is taken: tools run
    one at a time."""
    m = _CALL_JSON.search(text)
    if m:                                   # call:{"tool": "x", "args": {...}} - both styles at once
        obj = _loose_json(text[m.end() - 1:])
        if obj and isinstance(obj.get("tool"), str):
            return obj["tool"], obj["args"] if isinstance(obj.get("args"), dict) else {}
    m = _GEMMA_CALL.search(text)
    if m:
        body = text[m.end() - 1:]
        if body.startswith("("):            # call:name(a: 1) — same thing with parentheses
            end = body.rfind(")")
            body = "{" + (body[1:end] if end > 0 else body[1:]) + "}"
        args = _loose_json(body)
        return m.group(1), args if args is not None else {}
    candidates = _JSON_BLOCK.findall(text)
    stripped = text.strip()
    if stripped.startswith("{"):
        candidates.insert(0, stripped)
    if not candidates:
        a, b = text.find("{"), text.rfind("}")
        if 0 <= a < b:
            candidates.append(text[a:b + 1])
    for c in candidates:
        try:
            obj = json.loads(c)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict) and isinstance(obj.get("tool"), str):
            args = obj.get("args")
            return obj["tool"], args if isinstance(args, dict) else {}
    return None


def image_part(path: str, side: int) -> dict:
    from PIL import Image

    img = Image.open(path).convert("RGB")
    if max(img.size) > side:
        img.thumbnail((side, side))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()}}


# ── a run ────────────────────────────────────────────────────────────────────

class Run:
    """One conversation with the model. Events are the record shown to the
    person (terminal or home page) and saved to work/runs/<id>.json."""

    def __init__(self, cfg: dict, client: Optional[Client] = None, skill: Optional[str] = None,
                 context: Optional[dict] = None, groups: Optional[list[str]] = None, title: str = "",
                 approve: Optional[Callable[[str, dict, str], bool]] = None, owner: str = ""):
        self.id = time.strftime("%m%d-%H%M%S-") + uuid.uuid4().hex[:4]
        self.cfg, self.client, self.owner = cfg, client, owner
        if groups:
            self.names = [n for n, t in TOOLS.items() if t.get("group") in groups or t.get("group") == "skills"]
        elif cfg.get("tool_scope", "skill") == "skill":
            self.names = [n for n in TOOLS if n in CORE_TOOLS]
        else:
            self.names = list(TOOLS)
        self._restricted = bool(groups)        # an explicit tool group (first-run setup): nothing else unlocks
        self.context = dict(context or {})
        self.messages: list[dict] = [{"role": "system", "content": system_prompt(cfg, self.names, self.context)}]
        self.title = title
        self.status = "idle"            # idle | running | awaiting_approval | waiting | failed | cancelled
        self.events: list[dict] = []
        self.pending: Optional[dict] = None
        self.approve = approve
        self.cancelled = False
        self.steps = 0
        self.lock = threading.Lock()
        self.created = time.time()
        if skill:
            if not self._restricted:
                self._unlock(skill)
            text = TOOLS["read_skill"]["fn"]({"name": skill})["result"]
            self.messages.append({"role": "user", "content": f"Skill to follow for this task ({skill}):\n\n{text}"})
            self.messages.append({"role": "assistant", "content": "Understood. I will follow that skill."})
            self.event("skill", name=skill)

    def _unlock(self, skill: str) -> list[str]:
        """Add a skill's tools to this run; the system prompt is rebuilt to list them."""
        added = [n for n in skill_tools(skill) if n not in self.names]
        if added:
            self.names = [n for n in TOOLS if n in self.names or n in added]      # registry order
            self.messages[0] = {"role": "system", "content": system_prompt(self.cfg, self.names, self.context)}
        return added

    # -- record -------------------------------------------------------------
    def event(self, kind: str, **data: Any) -> None:
        with self.lock:
            self.events.append({"n": len(self.events), "t": round(time.time(), 1), "kind": kind, **data})
        self.save()

    def snapshot(self, since: int = 0) -> dict:
        return {"id": self.id, "title": self.title, "status": self.status, "owner": self.owner, "steps": self.steps,
                "created": self.created, "model": self.cfg["model"], "pending": self.pending,
                "events": self.events[since:], "event_count": len(self.events)}

    def save(self) -> None:
        """Write the record (what the person sees) and the conversation (what
        the model needs to carry on), so a run outlives the process."""
        RUNS.mkdir(parents=True, exist_ok=True)
        for name, data in ((f"{self.id}.json", self.snapshot()),
                           (f"{self.id}.state.json", {"messages": self.messages, "context": self.context,
                                                      "names": self.names, "pending": self.pending,
                                                      "restricted": self._restricted})):
            tmp = RUNS / (name + ".tmp")
            tmp.write_text(json.dumps(data))
            for _ in range(20):
                try:
                    os.replace(tmp, RUNS / name)
                    break
                except PermissionError:       # Windows: being read right now
                    time.sleep(0.05)

    @classmethod
    def restore(cls, run_id: str, cfg: dict, client: Optional[Client] = None) -> Optional["Run"]:
        """A run from an earlier process, ready to continue; None if it was
        not saved with its conversation."""
        record, state = RUNS / f"{run_id}.json", RUNS / f"{run_id}.state.json"
        if not (record.exists() and state.exists()):
            return None
        rec, st = json.loads(record.read_text()), json.loads(state.read_text())
        run = cls(cfg, client=client, owner=rec.get("owner", ""))
        run.id, run.title, run.created = rec["id"], rec.get("title", ""), rec.get("created", time.time())
        run.events = rec.get("events", [])
        run.messages, run.context = st["messages"], st.get("context") or {}
        run.names = [n for n in st.get("names") or run.names if n in TOOLS]
        run._restricted = bool(st.get("restricted"))
        run.pending = st.get("pending")
        # It stopped mid-step if it was working: let the person decide what next.
        run.status = "awaiting_approval" if run.pending else "waiting"
        if rec.get("status") in ("running", "idle"):
            run.event("status", text="the agent service restarted while this run was working; "
                                     "send a message to continue")
        return run

    # -- driving --------------------------------------------------------------
    def send(self, text: str) -> None:
        """Add the person's message and work until the model answers, needs an
        approval, or hits the step limit."""
        if not self.title:
            self.title = text.strip().splitlines()[0][:80]
        self.messages.append({"role": "user", "content": text})
        self.event("user", text=text)
        self._work()

    def resolve(self, approved: bool) -> None:
        """Answer a pending approval and carry on."""
        p, self.pending = self.pending, None
        if p is None:
            return
        self.event("approval", approved=approved, tool=p["tool"])
        if approved:
            self._execute(p["tool"], p["args"], p.get("call_id"))
        else:
            self._tool_reply(p["tool"], "The person declined this action. Do not retry it; ask what they want instead.",
                             [], p.get("call_id"))
        self._work()

    def cancel(self) -> None:
        self.cancelled = True

    def _work(self) -> None:
        if self.client is not None:
            use_client(self.client)
        self.status = "running"
        try:
            while True:
                if self.cancelled:
                    self.status = "cancelled"
                    self.event("status", text="cancelled")
                    return
                if self.steps >= self.cfg["max_steps"]:
                    self.status = "waiting"
                    self.event("status", text=f"step limit ({self.cfg['max_steps']}) reached; send a message to continue")
                    self.steps = 0
                    return
                self.steps += 1
                native = self.cfg["tool_mode"] == "native"
                msg = chat(self.cfg, self._window(), native_tools(self.names) if native else None)
                text = msg.get("content") or ""
                call: Optional[tuple[str, dict, Optional[str]]] = None
                if native and msg.get("tool_calls"):
                    tc = msg["tool_calls"][0]
                    try:
                        args = json.loads(tc["function"].get("arguments") or "{}")
                    except json.JSONDecodeError:
                        args = {}
                    call = (tc["function"]["name"], args, tc.get("id"))
                    self.messages.append({"role": "assistant", "content": text or None, "tool_calls": [tc]})
                else:
                    parsed = parse_text_call(text)
                    if parsed:
                        call = (parsed[0], parsed[1], None)
                    self.messages.append({"role": "assistant", "content": text})
                if call is None:
                    self.event("assistant", text=_SPECIAL.sub("", text).strip())
                    self.status = "waiting"
                    self.save()
                    return
                name, args, call_id = call
                if text and native:
                    self.event("assistant", text=text)
                if name not in TOOLS:
                    close = [n for n in TOOLS if name in n or n in name][:4]
                    self.event("tool", tool=name, args=args, error="unknown tool")
                    self._tool_reply(name, f"There is no tool named {name!r}."
                                     + (f" Did you mean: {', '.join(close)}?" if close else "")
                                     + " Use one from the list, or read_skill for the stage to see its tools.", [], call_id)
                    continue
                if name not in self.names:
                    if self.cfg.get("tool_scope", "skill") != "skill" or self._restricted:
                        self.event("tool", tool=name, args=args, error="tool not available in this run")
                        self._tool_reply(name, f"{name} is not available in this run. Use one from the list.", [], call_id)
                        continue
                    self.names = [n for n in TOOLS if n in self.names or n == name]   # a real tool, just not listed yet
                    self.messages[0] = {"role": "system", "content": system_prompt(self.cfg, self.names, self.context)}
                if "track" in TOOLS[name]["schema"]["properties"] and not args.get("track") and self.context.get("track"):
                    args = {**args, "track": self.context["track"]}
                args, problem = check_args(name, args)
                if problem:
                    self.event("tool", tool=name, args=args, error=problem)
                    self._tool_reply(name, "NOT RUN. " + problem + " Send the call again, corrected.", [], call_id)
                    continue
                reason = tool_approval(name, args)
                if reason:
                    if self.approve is not None:           # terminal: ask right now
                        ok = self.approve(name, args, reason)
                        self.event("approval", approved=ok, tool=name)
                        if not ok:
                            self._tool_reply(name, "The person declined this action. Do not retry it.", [], call_id)
                            continue
                    else:                                    # service: park until the page answers
                        self.pending = {"tool": name, "args": args, "call_id": call_id, "reason": reason}
                        self.status = "awaiting_approval"
                        self.event("approval_request", tool=name, args=args, reason=reason)
                        return
                self._execute(name, args, call_id)
        except Exception as e:
            self.status = "failed"
            self.event("error", text=f"{type(e).__name__}: {e}")

    def _execute(self, name: str, args: dict, call_id: Optional[str]) -> None:
        if "track" in TOOLS[name]["schema"]["properties"] and not args.get("track") and self.context.get("track"):
            args = {**args, "track": self.context["track"]}
        t = time.time()
        try:
            out = TOOLS[name]["fn"](dict(args))
            result, images = out.get("result"), list(out.get("images") or [])
            text = result if isinstance(result, str) else json.dumps(result, default=str)
            if name == "read_skill" and not self._restricted and self.cfg.get("tool_scope", "skill") == "skill":
                added = self._unlock(str(args.get("name")))
                if added:
                    text += "\n\nTools added to your list for this skill: " + ", ".join(added) + "."
            if len(text) > 12000:
                text = text[:12000] + f"… [truncated, {len(text)} chars in all; narrow the request]"
            self.event("tool", tool=name, args=args, result=text[:4000], images=images, seconds=round(time.time() - t, 1))
        except Exception as e:
            text, images = f"ERROR {type(e).__name__}: {e}", []
            self.event("tool", tool=name, args=args, error=text, seconds=round(time.time() - t, 1))
        self._tool_reply(name, text, images, call_id)

    def _tool_reply(self, name: str, text: str, images: list[str], call_id: Optional[str]) -> None:
        if call_id is not None:
            self.messages.append({"role": "tool", "tool_call_id": call_id, "content": text})
            if images and self.cfg["vision"]:
                self.messages.append({"role": "user", "_images": images,
                                      "content": f"Picture(s) returned by {name} (look at them):"})
        else:
            m: dict[str, Any] = {"role": "user", "content": f"TOOL RESULT ({name}):\n{text}"}
            if images and self.cfg["vision"]:
                m["_images"] = images
            elif images:
                m["content"] += "\n(pictures were produced, but this model cannot see images)"
            self.messages.append(m)

    def _window(self) -> list[dict]:
        """Messages as sent to the model: only the newest pictures are kept
        (they dominate the context), and old tool output is shortened."""
        keep = self.cfg["max_images"]
        out: list[dict] = []
        budget = 90000
        for m in reversed(self.messages):
            m2 = {k: v for k, v in m.items() if k != "_images"}
            imgs = m.get("_images") or []
            content = m2.get("content")
            if isinstance(content, str) and m["role"] != "system":
                if budget <= 0 and len(content) > 300:
                    content = content[:300] + " … [older output shortened]"
                budget -= len(content)
            if imgs and keep > 0:
                use = imgs[:keep]
                keep -= len(use)
                parts: list[dict] = [{"type": "text", "text": content or ""}]
                parts += [image_part(p, self.cfg["image_side"]) for p in use if Path(p).exists()]
                m2["content"] = parts
            elif imgs:
                m2["content"] = (content or "") + " [picture no longer shown]"
            else:
                m2["content"] = content
            out.append(m2)
        return list(reversed(out))


# ── terminal ─────────────────────────────────────────────────────────────────

def _print_event(e: dict) -> None:
    k = e["kind"]
    if k == "assistant":
        print(f"\n{e['text']}\n")
    elif k == "tool":
        args = json.dumps(e.get("args") or {})
        print(f"  > {e['tool']}({args[:160]})  {e.get('seconds', '')}s")
        if e.get("error"):
            print(f"    {e['error'][:300]}")
        for p in e.get("images") or []:
            print(f"    [image] {p}")
    elif k in ("status", "error"):
        print(f"  [{k}] {e['text']}")
    elif k == "skill":
        print(f"  [skill] {e['name']}")


def main_cli(argv: list[str]) -> int:
    """python -m gemi_agent chat [--skill NAME] [--track PREFIX] [--groups a,b] [--yes] [TEXT...]"""
    opts: dict[str, str] = {}
    words: list[str] = []
    i = 0
    while i < len(argv):
        if argv[i] in ("--skill", "--track", "--groups", "--model", "--url"):
            opts[argv[i][2:]] = argv[i + 1]
            i += 2
        elif argv[i] == "--yes":
            opts["yes"] = "1"
            i += 1
        else:
            words.append(argv[i])
            i += 1
    cfg = load_config()
    if opts.get("model"):
        cfg["model"] = opts["model"]
    if opts.get("url"):
        cfg["base_url"] = opts["url"]

    def approve(tool: str, args: dict, reason: str) -> bool:
        if opts.get("yes"):
            return True
        try:
            return input(f"\nAllow {tool}({json.dumps(args)[:300]})? It {reason}. [y/N] ").strip().lower() == "y"
        except EOFError:        # no terminal to ask on: the safe answer
            return False

    run = Run(cfg, skill=opts.get("skill"), context={"track": opts.get("track") or os.environ.get("GEMI_TRACK")},
              groups=opts["groups"].split(",") if opts.get("groups") else None, approve=approve)
    print(f"model {cfg['model']} at {cfg['base_url']} ({cfg['tool_mode']} tool mode); run {run.id}; Ctrl-C to stop")
    shown = 0

    def flush() -> None:
        nonlocal shown
        for e in run.events[shown:]:
            if e["kind"] != "user":
                _print_event(e)
        shown = len(run.events)

    def turn(text: str) -> None:
        worker = threading.Thread(target=run.send, args=(text,), daemon=True)
        worker.start()
        try:
            while worker.is_alive():
                worker.join(0.5)
                flush()
        except KeyboardInterrupt:
            run.cancel()
            worker.join(30)
        flush()

    if words:
        turn(" ".join(words))
        return 0 if run.status != "failed" else 1
    try:
        while True:
            text = input("you> ").strip()
            if text in ("exit", "quit"):
                break
            if text:
                turn(text)
    except (EOFError, KeyboardInterrupt):
        pass
    return 0
