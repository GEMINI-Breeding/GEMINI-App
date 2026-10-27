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
              "entities", "inference_stats", "stitch_stats", "canopy_cover", "traits_available", "analyze",
              "genotype_studies", "gwas", "gwas_result", "cluster_rules", "field_layout", "cluster_folder")
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

# (endpoint, model) pairs seen to answer with thinking only: see chat().
_THINKS: set[tuple[str, str]] = set()


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
    who = (cfg["base_url"], cfg["model"])
    if who in _THINKS:
        body.update({"reasoning_effort": "none", "max_tokens": cfg["max_tokens"] * 3})
    for attempt, delay in enumerate((2, 5, 15, 0)):
        try:
            req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers)
            with urllib.request.urlopen(req, timeout=cfg["request_timeout_s"]) as r:
                msg = json.load(r)["choices"][0]["message"]
            if (not (msg.get("content") or "").strip() and not msg.get("tool_calls") and who not in _THINKS
                    and (msg.get("reasoning") or msg.get("reasoning_content"))):
                # A model that thinks before it answers spent the whole reply on thinking. Ask it
                # to think less and give it more room, for this call and the ones after it.
                _THINKS.add(who)
                body.update({"reasoning_effort": "none", "max_tokens": cfg["max_tokens"] * 3})
                continue
            return msg
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:400]}"
            if e.code == 400 and "reasoning_effort" in body and "reasoning" in last.lower():
                body.pop("reasoning_effort")           # this server does not take the hint; the extra room stays
                continue
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
        parts.append("Guides, one per stage (the whole list). Read one with read_skill and its name; there is no other way to list them:\n" +
                     "\n".join(f"- {s['name']}: {s['description']}" for s in skill_list))
    try:
        from .hpc_tools import _rules_dir, active_cluster

        cl = active_cluster()
        idx = _rules_dir(cl) / "index.json" if cl else None
        rows = json.loads(idx.read_text()) if idx and idx.exists() else []
        if rows:
            parts.append(f"Cluster {cl} has rules for agents from its administrators: " +
                         "; ".join(f"{r['name']} ({r['description'][:120]})" for r in rows) +
                         ". Read them with cluster_rules before any cluster action and follow them over your own "
                         "defaults.")
    except Exception:
        pass
    if context:
        parts.append("Context:\n" + "\n".join(f"- {k}: {v}" for k, v in context.items() if v))
    return "\n\n".join(parts)


def _first_step_tool(skill: str) -> Optional[str]:
    """The tool the first step of a skill's Quick path names, if it names one."""
    try:
        text = str(TOOLS["read_skill"]["fn"]({"name": skill})["result"])
    except Exception:
        return None
    for line in text.splitlines():
        if re.match(r"\s*1\. ", line):
            for word in re.findall(r"`([a-z_]+)`", line):
                if word in TOOLS:
                    return word
            return None
    return None


def native_tools(names: list[str]) -> list[dict]:
    return [{"type": "function", "function": {"name": n, "description": TOOLS[n]["description"],
                                              "parameters": TOOLS[n]["schema"]}} for n in names]


_JSON_BLOCK = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.S)


_GEMMA_CALL = re.compile(r"call:([A-Za-z_][A-Za-z0-9_]*)\s*[{(]")
_CALL_JSON = re.compile(r"call:\s*\{")
_PY_LITERAL = re.compile(r"(?<=[:\[,\s])(None|True|False)(?=\s*[,}\]])")
_BARE_KEY = re.compile(r'([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:')
_SPECIAL = re.compile(r"<\|?/?[a-z_]+\|?>")
# A reply that reports an action as done.
_CLAIMS = re.compile(r"\b(?:has|have|had|was|were|is|are|I|I've|we|we've) (?:now |just |successfully |already )*(?:been )?"
                     r"(uploaded|started|submitted|stopped|saved|stitched|marked|cancell?ed|deleted|launched|queued|recorded"
                     r"|initiated|begun|kicked off|shut down)\b", re.I)
# A reply that asks the person where something is stored.
# "I cannot access files on your computer" about a spreadsheet the person named: the tools can.
_CANT_READ = re.compile(r"\b(can ?not|can't|unable to|don't have access|do not have access)\b[^.\n]{0,40}"
                        r"\b(access|open|read|see|compare)\b[^.\n]{0,60}\b(file|files|spreadsheet|excel|computer)", re.I)
_LOCAL_TABLE = re.compile(r"[A-Za-z]:[\\/][^\s\"']+\.(xlsx|xlsm|csv|tsv)\b|(^|\s)(~|/)[^\s\"']+\.(xlsx|xlsm|csv|tsv)\b", re.I)
_ASKS_PATH = re.compile(r"\b(provide|give me|specify|tell me|what is|share)\b[^.?!\n]{0,60}\b(path|folder|directory|location|prefix)\b",
                        re.I)
# Calls that act on a cluster: they wait until its administrators' rules have been read.
_CLUSTER_ACTS = {"start_process", "stop_process", "hpc_configure"}
_ACTS_IF = {"cluster_folder": "upload"}                    # tools that act only with this argument set
_CLUSTER_LOOKS = {"status", "logs", "llm_status"}          # hpc actions that only look
# The tool behind a thing said to be done (word in the reply -> tool).
_DOES = {"upload": "upload", "stitch": "stitch", "stop": "stop_process", "shut down": "hpc", "cancel": "cancel_job",
         "saved": "save_markings", "mark": "mark_plots_auto"}
# Tools that only look: calling them is not "doing" what the person asked.
_READ_ONLY = {"read_skill", "skills", "status", "process_runs", "processes", "jobs", "job_detail", "tasks", "browse",
              "datasets", "entities", "next_step", "markings", "passes", "inference_stats", "stitch_stats", "field_design"}
# Waiting and polling are meant to be called again with the same arguments.
_REPEATABLE = {"wait_jobs", "wait_task", "continue_run", "status", "processes", "jobs", "tasks"}
# A reply that ends by promising an action instead of taking it.
_ANNOUNCES = re.compile(r"\b(I will now|I'll now|I will next|I'll next|Next,? I will|Next,? I'll|I am now going to|"
                        r"I'm now going to|Now I will|Now I'll|I will proceed to|I'll proceed to|Let me now|"
                        r"I'll (?:first )?(?:check|look|start|begin|run|read|get|find|identify|see|verify|list|query)|"
                        r"I will (?:first )?(?:check|look|start|begin|run|read|get|find|identify|see|verify|list|query)|"
                        r"Let me (?:first )?(?:check|look|start|begin|run|read|get|find|identify|see|verify|list|query))\b",
                        re.I)


def _loose_json(text: str) -> Optional[dict]:
    """The JSON object at the start of `text`; also accepts unquoted keys
    ({name: "x"}), which is how some models write arguments."""
    # Also read Python's None / True / False where JSON has null / true / false.
    py = _PY_LITERAL.sub(lambda m: {"None": "null", "True": "true", "False": "false"}[m.group(1)], text)
    for candidate in (text, py, _BARE_KEY.sub(r'\1"\2":', py)):
        try:
            obj, _ = json.JSONDecoder().raw_decode(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            return obj
    return None


def split_pycall(name: str, args: dict) -> tuple[str, dict]:
    """A call written the way a programmer would, in the tool's name:
    `gwas(study="x", trait="yield")` -> ("gwas", {"study": "x", "trait": "yield"})."""
    if "(" not in name:
        return name, args
    import ast

    head, _, rest = name.partition("(")
    head = head.strip()
    try:
        node = ast.parse(f"f({rest.rsplit(')', 1)[0]})", mode="eval").body
        found = {k.arg: ast.literal_eval(k.value) for k in node.keywords if k.arg}          # type: ignore[attr-defined]
    except (SyntaxError, ValueError):
        found = {}
    return head, {**{k: v for k, v in found.items() if v is not None}, **args}


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
        obj = _loose_json(c.strip())          # the first object: a reply may hold several calls in a row
        if not isinstance(obj, dict):
            continue
        # The same call in the shapes other toolkits use: {"tool": {"hpc": {...}}},
        # {"name": "hpc", "arguments": {...}}, {"function": "hpc", "parameters": {...}}.
        if isinstance(obj.get("tool"), dict) and len(obj["tool"]) == 1:
            (n, a), = obj["tool"].items()
            if isinstance(n, str) and isinstance(a, dict):
                return n, a
        if len(obj) == 1 and "tool" not in obj:
            (n, a), = obj.items()
            if isinstance(n, str) and isinstance(a, dict) and (n in TOOLS or n.replace("-", "_") in TOOLS):
                return n.replace("-", "_") if n not in TOOLS else n, a
        for nk in ("name", "function", "tool_name"):
            if "tool" not in obj and isinstance(obj.get(nk), str):
                a = obj.get("arguments", obj.get("parameters", obj.get("args")))
                return obj[nk], a if isinstance(a, dict) else {}
        if isinstance(obj, dict) and isinstance(obj.get("tool"), str):
            args = obj.get("args", obj.get("arguments", obj.get("parameters")))
            if not isinstance(args, dict):
                # Arguments written beside the tool name instead of under "args":
                # {"tool": "continue_run", "run": "Davis 2026-08-21"}
                args = {k: v for k, v in obj.items() if k not in ("tool", "args", "arguments", "parameters")}
            return obj["tool"], args
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
        self._nudged = False
        self._acted = False                 # a tool that changes something ran since the person last spoke
        self._last_call, self._repeats = "", 0
        self._counted = ""                  # the upload whose files were last counted (dry run) for the person
        self._turn = 0                      # how many times the person has spoken
        self._counted_turn = -1             # the turn in which that count was shown
        self._overlay_turn = -1             # the turn in which a boundary preview was last shown
        self._pairing_turn = -1             # the turn in which a photo-to-plot pairing was last shown
        self._seen: dict[str, int] = {}     # how often each exact call was made since the person last spoke
        self._calls = 0                     # tool calls made since the person last spoke
        self._only_read_skill = False       # ... and every one of them was read_skill
        self._waits_for_person = (-1, "")   # (turn, run) for which continue_run stopped to ask the person
        self._shrink = 1.0                  # share of the usual history budget in use (drops when the model's context overflows)
        self._rules_read: set[str] = set()  # cluster rule sets (site skills) read in this conversation
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
                "events": self.events[since:], "event_count": len(self.events),
                "current": getattr(self, "current", None)}

    def save(self) -> None:
        """Write the record (what the person sees) and the conversation (what
        the model needs to carry on), so a run outlives the process."""
        if getattr(self, "deleted", False):
            return                      # removed from the list: nothing to keep
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
        self._nudged = False
        self._acted = False
        self._last_call, self._repeats = "", 0
        self._turn += 1
        from . import tools as _tools

        _tools.TURN_STARTED.set(time.time())
        self._seen = {}
        self._calls = 0
        self._only_read_skill = False
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
                try:
                    msg = chat(self.cfg, self._window(), native_tools(self.names) if native else None)
                except RuntimeError as e:
                    if not re.search(r"context (size|length|window)|exceed_context|too many tokens|maximum context", str(e), re.I) \
                            or self._shrink < 0.2:
                        raise
                    # The conversation outgrew the model's context: send less of the older part and go on.
                    self._shrink *= 0.6
                    self.event("status", text="the conversation is longer than the model can read at once; older tool "
                                              "output is being shortened")
                    self.steps -= 1
                    continue
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
                if call is None and not self._nudged and _ANNOUNCES.search(text[-400:]):
                    # Said what it will do next and stopped. Once per turn of the person: ask for the call.
                    self._nudged = True
                    self.event("assistant", text=_SPECIAL.sub("", text).strip())
                    self.messages.append({"role": "user", "content":
                                          "You said what you will do next but made no tool call. Make that call now. "
                                          "If everything is already done, say what was done instead."})
                    continue
                if call is None and not self._acted and not self._nudged and _CLAIMS.search(text):
                    # Says something was done, but no tool that does anything ran this turn.
                    self._nudged = True
                    self.event("assistant", text=_SPECIAL.sub("", text).strip())
                    verb = _CLAIMS.search(text).group(1).lower()
                    tool = next((t for k, t in _DOES.items() if k in verb or k in text.lower()), None)
                    self.messages.append({"role": "user", "content":
                                          "No tool that changes anything has run since the person's message, so that has "
                                          "NOT been done. Make the tool call that does it now"
                                          + (f" (the tool is `{tool}`: send it with what the person gave you, and it will "
                                             "say exactly what is missing)" if tool and tool in TOOLS else "")
                                          + ". If something you need is missing (a label, a file, a choice), ask the "
                                            "person for exactly that instead."})
                    continue
                if call is None and self._only_read_skill and not self._nudged and "?" not in text:
                    # Read the steps, then neither did the first one nor asked for anything.
                    self._nudged = True
                    self.event("assistant", text=_SPECIAL.sub("", text).strip())
                    self.messages.append({"role": "user", "content":
                                          "You read the steps but have not done them. Do step 1 now: make its tool call. If "
                                          "the person has not given something a step needs (a label, a file, a choice), ask "
                                          "them for exactly that, as a question."})
                    continue
                if (call is None and self._calls == 0 and not self._nudged and _CANT_READ.search(text)
                        and _LOCAL_TABLE.search(self._person_text())):
                    # Said it cannot read a spreadsheet the person named on this computer: it can.
                    self._nudged = True
                    self.event("assistant", text=_SPECIAL.sub("", text).strip())
                    self.messages.append({"role": "user", "content":
                                          "You can read spreadsheets and CSV files on this computer: field_layout with "
                                          "`paths` (every file the person named) reads field designs, field maps and "
                                          "plot lists: plots, beds, tiers, genotypes, crops. Call it now, then answer "
                                          "from its result."})
                    continue
                if call is None and self._calls == 0 and not self._nudged and _ASKS_PATH.search(text):
                    # Asked the person where something is in the app's storage, without looking.
                    self._nudged = True
                    self.event("assistant", text=_SPECIAL.sub("", text).strip())
                    self.messages.append({"role": "user", "content":
                                          "Do not ask the person for a path inside the app: the tools find data by the "
                                          "run's name (its site and date). Look first: read_skill for the stage, or "
                                          "next_step, then make the call. Ask the person only for things only they know."})
                    continue
                if call is None:
                    self.event("assistant", text=_SPECIAL.sub("", text).strip())
                    self.status = "waiting"
                    self.save()
                    return
                name, args, call_id = call
                name, args = split_pycall(str(name), args)
                if text and native:
                    self.event("assistant", text=text)
                if name == "skills":
                    # The list is already in the instructions; calling for it again is a wasted turn.
                    self.event("tool", tool=name, args=args, result="(already listed in the instructions)")
                    self._tool_reply(name, "The skills are listed in your instructions. Do not call skills. "
                                     "Call read_skill with one of those names, or call the tool you need.", [], call_id)
                    continue
                if name not in TOOLS and name.replace("_", "-") in {s["name"] for s in TOOLS["skills"]["fn"]({})["result"]}:
                    name, args = "read_skill", {"name": name.replace("_", "-")}     # a skill named as if it were a tool
                if name not in TOOLS:
                    close = [n for n in TOOLS if name in n or n in name][:4]
                    self._seen["?" + name] = self._seen.get("?" + name, 0) + 1
                    if self._seen["?" + name] >= 3:
                        self.event("assistant", text=f"I keep trying a tool that does not exist ({name}). Tell me what "
                                                     "you would like me to do next.")
                        self.status = "waiting"
                        self.save()
                        return
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
                key = name + " " + json.dumps(args, sort_keys=True, default=str)
                args, problem = check_args(name, args)
                if key == self._last_call and (problem or name not in _REPEATABLE):
                    # The very same call twice in a row: the model is going round in a circle.
                    self._repeats += 1
                    self.event("tool", tool=name, args=args, error="repeated call, not run again")
                    if self._repeats >= 2:
                        self.event("assistant", text="I kept repeating the same step without getting further "
                                                     f"({name}). Tell me what you would like me to do next.")
                        self.status = "waiting"
                        self.save()
                        return
                    first = _first_step_tool(str(args.get("name"))) if name == "read_skill" and not problem else None
                    if first:
                        self._tool_reply(name, f"You already have these steps; reading them again changes nothing. Step 1 "
                                         f"is the tool `{first}`. Call `{first}` now.", [], call_id)
                        continue
                    self._tool_reply(name, "You just made this exact call" + (
                        f" and it was refused: {problem}" if problem else "; its result is above and has not changed.") +
                        " Do not send it again unchanged. Either make the NEXT call the steps name (a different tool, "
                        "or different arguments), or answer the person with what you know or ask them what you need.",
                        [], call_id)
                    continue
                self._last_call, self._repeats = key, 0
                # Going round in a wider circle (A, B, A, B, A): the same call a third time since the
                # person spoke, for a tool that is not meant to be polled.
                self._seen[key] = self._seen.get(key, 0) + 1
                if self._seen[key] >= 3 and name not in ("wait_jobs", "continue_run"):
                    self.event("tool", tool=name, args=args, error="third identical call this turn, not run")
                    self.event("assistant", text="I am going round in circles and not getting further "
                                                 f"(I keep calling {name}). Tell me what you would like me to do next.")
                    self.status = "waiting"
                    self.save()
                    return
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
                if name == "run_facts" and isinstance(args.get("set"), dict):
                    kept, dropped = self._facts_said(args["set"])
                    if dropped:
                        args = {**args, "set": kept}
                        if not kept:
                            self.event("tool", tool=name, args=args, error="facts the person did not give: " + ", ".join(dropped))
                            self._tool_reply(name, "NOT RECORDED. The person has not said: " + ", ".join(dropped) + ". Facts "
                                             "are only what the person told you, not numbers from a tool's result. If you "
                                             "need one of these, ask the person; otherwise go on with continue_run.",
                                             [], call_id)
                            continue
                unread = self._rules_unread(name, args)
                if unread:
                    self.event("tool", tool=name, args=args, error="cluster rules not read yet: " + ", ".join(unread))
                    self._tool_reply(name, "NOT RUN. This cluster's administrators publish rules for agents that have "
                                     "not been read in this conversation: " + ", ".join(unread) + ". Read each with "
                                     "cluster_rules and its name first, then make this call again if the rules allow "
                                     "it.", [], call_id)
                    continue
                if name == "cluster_rules" and args.get("name"):
                    self._rules_read.add(str(args["name"]))
                if name == "upload":
                    invented = self._not_said({k: args.get(k) for k in ("experiment", "site", "population", "date")})
                    if invented:
                        self.event("tool", tool=name, args=args, error="labels the person did not give: " + ", ".join(invented))
                        self._tool_reply(name, "NOT RUN. The person has not said the " + " or the ".join(invented) +
                                         " of this data (the values you sent are not in anything they wrote; examples in "
                                         "a skill are not their data). Ask the person for: " + ", ".join(invented) +
                                         ". Do not guess and do not upload until they answer.", [], call_id)
                        continue
                if name == "upload" and not args.get("dry_run"):
                    # Count first, send second: an upload that was not counted for the person runs as the count.
                    sig = json.dumps({k: args.get(k) for k in ("paths", "experiment", "site", "population", "date", "data_type",
                                                              "platform", "sensor")}, sort_keys=True, default=str)
                    if sig == self._counted and self._counted_turn == self._turn:
                        self.event("tool", tool=name, args=args, error="waiting for the person to confirm the count")
                        self._tool_reply(name, "NOT RUN YET. The person has not answered since you counted the files. Tell "
                                         "them the number of files and where they will be filed, ask them to confirm, and "
                                         "stop. Send this upload call again after they say yes.", [], call_id)
                        continue
                    if sig != self._counted:
                        self._counted, self._counted_turn = sig, self._turn
                        self._execute(name, {**args, "dry_run": True}, call_id, note=(
                            "\n\nNOTHING HAS BEEN UPLOADED YET. This was the count (dry run) that comes first. Tell the "
                            "person the number of files and where they will be filed, and ask them to confirm. When they "
                            "do, send this same upload call again: it will then really upload."))
                        continue
                elif name == "upload":
                    self._counted_turn = self._turn
                    self._counted = json.dumps({k: args.get(k) for k in ("paths", "experiment", "site", "population", "date",
                                                                         "data_type", "platform", "sensor")},
                                               sort_keys=True, default=str)
                if name == "continue_run" and self._waits_for_person == (self._turn, str(args.get("run"))):
                    self.event("tool", tool=name, args=args, error="waiting for the person's answer")
                    self._tool_reply(name, "NOT RUN. This run is waiting for the person: continue_run just said what it "
                                     "needs from them. Ask them that now, as a question, and stop. Call continue_run "
                                     "again after they answer.", [], call_id)
                    continue
                note = ""
                if name == "continue_run" and args.get("boundaries_confirmed") and self._overlay_turn == self._turn:
                    args = {**args, "boundaries_confirmed": False}
                    note = ("\n\nboundaries_confirmed was ignored: the person has not yet answered after seeing the "
                            "overlay. If this result asks them to look at it, show it, ask, and stop; send "
                            "boundaries_confirmed true only after they say it is right.")
                if name == "plots_from_images" and args.get("confirmed") and self._pairing_turn == self._turn:
                    args = {**args, "confirmed": False}
                    note = ("\n\n`confirmed` was ignored: the person has not yet answered after seeing the pairing. Show "
                            "it to them, ask, and stop; send confirmed true only after they say it is right.")
                self._acted = self._acted or name not in _READ_ONLY
                self._only_read_skill = name == "read_skill" and (self._calls == 0 or self._only_read_skill)
                self._calls += 1
                self._execute(name, args, call_id, note=note)
        except Exception as e:
            self.status = "failed"
            self.event("error", text=f"{type(e).__name__}: {e}")

    def _rules_unread(self, name: str, args: dict) -> list[str]:
        """Rule sets of the active cluster not yet read here, when `name` acts on the cluster."""
        acts = (name in _CLUSTER_ACTS or (name == "hpc" and str(args.get("action")) not in _CLUSTER_LOOKS)
                or bool(name in _ACTS_IF and args.get(_ACTS_IF[name])))
        if not acts:
            return []
        try:
            from .hpc_tools import site_rules

            rows = site_rules()
        except Exception:
            return []
        return [r["name"] for r in rows or [] if r["name"] not in self._rules_read]

    def _person_text(self) -> str:
        said = " ".join(str(m.get("content")) for m in self.messages[1:]
                        if m["role"] == "user" and not str(m.get("content")).startswith(("TOOL RESULT", "Skill to follow",
                                                                                         "Picture(s)", "You ", "No tool", "Do not")))
        return (said + " " + " ".join(str(v) for v in self.context.values())).lower()

    def _facts_said(self, facts: dict) -> tuple[dict, list[str]]:
        """(facts the person's own words support, names of the others). Empty values are simply left out."""
        said = self._person_text()
        words = {"design_path": ("stand-in", "stand in", "standin", "mock", "made-up", "made up", "placeholder", "no field design",
                                 "no design"),
                 "gps_reliable": ("gps",)}
        kept, dropped = {}, []
        for k, v in facts.items():
            if v in (None, "", [], {}):
                continue
            text = str(v).strip().lower()
            if isinstance(v, bool) or text in ("true", "false", "yes", "no"):
                ok = any(w in said for w in words.get(k, (k.replace("_", " "),)))
            elif k == "design_path" and re.sub(r"[^a-z]", "", text) in ("standin", "mock", "mockfielddesign", "placeholder"):
                ok = any(w in said for w in words["design_path"])
            elif isinstance(v, (int, float)) or re.fullmatch(r"[\d.]+", text):
                ok = re.search(rf"(?<![\d.]){re.escape(text.rstrip('0').rstrip('.') if '.' in text else text)}(?![\d])", said) is not None
            elif isinstance(v, list):
                ok = all(str(x).lower() in said for x in v)
            else:
                ok = text in said or text.replace("\\", "/") in said.replace("\\", "/") or \
                    all(w in said for w in re.split(r"[\s_\-]+", text) if len(w) > 2)
            if ok:
                kept[k] = v
            else:
                dropped.append(k)
        return kept, dropped

    def _not_said(self, labels: dict) -> list[str]:
        """Labels whose value appears nowhere in what the person wrote (or in the
        context the run was started with). Filing data under a label nobody gave
        is the one mistake that silently attaches results to the wrong plots."""
        said = " ".join(str(m.get("content")) for m in self.messages[1:]
                        if m["role"] == "user" and not str(m.get("content")).startswith(("TOOL RESULT", "Skill to follow",
                                                                                         "Picture(s)")))
        said = (said + " " + " ".join(str(v) for v in self.context.values())).lower()
        months = ("january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
                  "november", "december")
        out = []
        for key, value in labels.items():
            v = str(value or "").strip().lower()
            if not v:
                continue                                  # a missing label is the tool's own complaint
            if key == "date":
                m = re.match(r"(\d{4})-(\d{2})-(\d{2})$", v)
                if not m:
                    continue
                y, mo, d = m.groups()
                day = str(int(d))
                ok = v in said or (y in said and re.search(rf"\b0?{day}(st|nd|rd|th)?\b", said) and (
                    months[int(mo) - 1] in said or months[int(mo) - 1][:3] in said
                    or re.search(rf"\b0?{int(mo)}[/.-]", said) or re.search(rf"[/.-]0?{int(mo)}\b", said)))
                if not ok:
                    out.append("date")
            elif v not in said and v.replace("_", " ") not in said and v.replace("-", " ") not in said:
                out.append(key)
        return out

    def _execute(self, name: str, args: dict, call_id: Optional[str], note: str = "") -> None:
        if "track" in TOOLS[name]["schema"]["properties"] and not args.get("track") and self.context.get("track"):
            args = {**args, "track": self.context["track"]}
        t = time.time()
        # What is working now, and the jobs it started or waits on, so the
        # page can show their progress while the tool runs.
        from .client import SUBMITTED

        given = args.get("job_ids") or ([args["job_id"]] if args.get("job_id") else [])
        self.current = {"tool": name, "since": round(t), "jobs": [str(j) for j in
                        (given if isinstance(given, list) else [given])]}
        SUBMITTED.cb = lambda job: self.current["jobs"].append(str(job.get("id"))) \
            if self.current and job.get("id") else None
        from . import activity

        activity.note(f"agent running {name}…")
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
            text += note
            if name == "continue_run" and ("overlay" in text.lower() or "pairing" in text.lower()) and "needs the person" in text:
                self._overlay_turn = self._turn
            if name == "plots_from_images" and "needs the person" in text:
                self._pairing_turn = self._turn
            if name == "continue_run" and '"state": "needs the person"' in text:
                self._waits_for_person = (self._turn, str(args.get("run")))
            elif name == "run_facts" and args.get("set"):
                self._waits_for_person = (-1, "")          # answers recorded: the run can go on
            self.event("tool", tool=name, args=args, result=text[:4000], images=images, seconds=round(time.time() - t, 1))
            activity.note(f"agent ran {name} ({round(time.time() - t, 1)} s)")
        except Exception as e:
            text, images = f"ERROR {type(e).__name__}: {e}", []
            self.event("tool", tool=name, args=args, error=text, seconds=round(time.time() - t, 1))
            activity.note(f"agent's {name} failed: {type(e).__name__}: {e}", "ERROR")
        finally:
            SUBMITTED.cb = None
            self.current = None
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
        # What fits: the model's context, less room for its reply and for the instructions, at about three
        # characters per token (tool output is JSON, which is token-heavy). `_shrink` drops after a
        # "context exceeded" reply from the model's server, for the rest of the run.
        room = (int(self.cfg.get("context_tokens") or 16000) - int(self.cfg["max_tokens"]) - 800) * 2.7
        budget = int(max(6000, min(90000, room - len(str(self.messages[0].get("content") or "")))) * self._shrink)
        whole, stubs, dropped = budget, int(budget * 0.15), 0
        first_user = next((i for i, m in enumerate(self.messages) if m["role"] == "user"), -1)
        for i in range(len(self.messages) - 1, -1, -1):
            m = self.messages[i]
            m2 = {k: v for k, v in m.items() if k != "_images"}
            imgs = m.get("_images") or []
            content = m2.get("content")
            if isinstance(content, str) and m["role"] != "system":
                if budget <= 0:
                    # Past the budget: a short stub of each older message for a while, then nothing
                    # (the person's first message always stays: it is the task).
                    if stubs <= 0 and i != first_user:
                        dropped += 1
                        continue
                    if len(content) > 300:
                        content = content[:300] + " … [older output shortened]"
                    stubs -= len(content)
                elif len(content) > (int(whole * 0.6) if i == len(self.messages) - 1 else max(budget, 1500)):
                    # The newest result may take most of the room; an older one only what is left.
                    cut = int(whole * 0.6) if i == len(self.messages) - 1 else max(budget, 1500)
                    content = content[:cut] + f" … [shortened: {len(content)} characters in all]"
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
        out = list(reversed(out))
        if dropped:
            out.insert(1, {"role": "user", "content": f"[{dropped} older messages of this conversation are no longer shown. "
                                                      "What matters from them is in the run's recorded facts and steps: "
                                                      "next_step or run_facts show the current state.]"})
        return out


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
