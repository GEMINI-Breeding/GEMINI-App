"""Guidance for a pipeline run: what to do next, and doing it.

The pipelines are fixed sequences. A model should not have to rebuild that
sequence from prose each time:

- `next_step` reads a run's state and answers with the step that is due, the
  skill that covers it, and the exact tool call with every argument that can
  be known already filled in.
- `continue_run` goes one further and makes those calls itself, step after
  step, waiting for each job, until the run is finished or it reaches
  something only a person can supply. One tool call instead of a dozen.
- `run_facts` holds what only the person knows about a run (the field design
  file, which corner the rover started from, which side plot 1 is on). The
  Process page has a form for them; both tools fill their calls from them, so
  the agent does not have to ask again in chat.
"""
from __future__ import annotations

import json
import time
from typing import Any, Optional

from .client import AGENT_DIR
from .process_runs import AERIAL_STEPS, GROUND_STEPS, OPTIONAL_STEPS, SCOPE_KEYS
from .tools import TOOLS, _bool, _int, _str, _tool, client, process_tab

STEP_TITLE = {"data_sync": "Upload", "image_review": "Image review", "gcp_selection": "Ground control points",
              "orthomosaic": "Orthomosaic", "plot_boundary_prep": "Plot boundaries",
              "split_orthomosaic": "Plot images", "trait_extraction": "Trait extraction", "inference": "Inference",
              "plot_marking": "Plot marking", "stitching": "Stitching", "associate_boundaries": "File plots by boundary"}

# ── what only the person knows ───────────────────────────────────────────────

FACTS_FILE = AGENT_DIR / "work" / "run_facts.json"
FACT_KEYS = {
    "design_path": "the field design file (.xlsx / .csv) on this computer",
    "first_tier_at": "drone: which end of the field the design's first tier is at (north, south, east, west)",
    "first_bed_at": "drone: which side the design's first bed is on (north, south, east, west)",
    "beds": "drone: which beds of the design this flight covers, e.g. [2,3,4,5,6] (default: all)",
    "gps_reliable": "rover: false when the rover's GPS cannot be trusted for placing plots",
    "start_corner": "rover: the corner of the field the rover started from (e.g. south-east)",
    "pass_axis": "rover: which way the beds run (north-south or east-west)",
    "rows_per_pass": "rover: crop rows in one image (1 or 2)",
    "plots_per_bed": "rover: how many plots each bed has",
    "border_plots": "rover: border plots at each end of a bed (usually 1)",
    "model": "inference: the model to run, as the inference skill describes it",
    "notes": "anything else the agent should know about this run",
}


def _all_facts() -> dict:
    try:
        return json.loads(FACTS_FILE.read_text())
    except (OSError, json.JSONDecodeError):
        return {}


def facts_of(run_id: str) -> dict:
    return dict(_all_facts().get(run_id) or {})


def save_facts(run_id: str, patch: dict) -> dict:
    unknown = [k for k in patch if k not in FACT_KEYS]
    if unknown:
        raise ValueError(f"unknown fact {', '.join(unknown)}. Facts are: {', '.join(FACT_KEYS)}")
    data = _all_facts()
    row = dict(data.get(run_id) or {})
    for k, v in patch.items():
        if v in (None, "", []):
            row.pop(k, None)
        else:
            row[k] = v
    data[run_id] = row
    FACTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    FACTS_FILE.write_text(json.dumps(data, indent=1))
    return row


# ── a run ────────────────────────────────────────────────────────────────────

def _processed(scope: dict) -> str:
    return "Processed/" + "/".join(str(scope[k]) for k in SCOPE_KEYS) + "/"


def _track(run: dict) -> Optional[str]:
    up = run.get("uploadScope") or {}
    ids = up.get("datasetShortIds") or []
    if not ids:
        return None
    return "Raw/" + "/".join(str(up[k]) for k in SCOPE_KEYS) + f"/{ids[0]}/"


def _latest_stitch(processed: str) -> Optional[str]:
    try:
        page = client().list_page(processed, 400, 0)
    except Exception:
        return None
    versions = set()
    for f in page.get("files") or []:
        rest = f["object_name"][len(processed):]
        if rest.startswith("AgRowStitch_v"):
            head = rest.split("/")[0][len("AgRowStitch_v"):]
            if head.isdigit():
                versions.add(int(head))
    return f"{processed}AgRowStitch_v{max(versions)}/" if versions else None


def _ortho(run: dict) -> Optional[str]:
    versions = ((run["steps"].get("orthomosaic") or {}).get("outputs") or {}).get("versions") or []
    if not versions:
        return None
    path = str(versions[-1].get("path") or "")
    return path[len("gemini/"):] if path.startswith("gemini/") else path


def _plan(kind: str, step: str, run: dict) -> dict:
    """skill, the call to make, and what must come from the person. Facts
    recorded for the run fill the call; only what is still missing is asked."""
    up = run.get("uploadScope") or {}
    scope = {k: up.get(k) for k in SCOPE_KEYS}
    processed = _processed(scope)
    track = _track(run)
    facts = facts_of(str(run.get("id")))
    design = facts.get("design_path")

    def need(*pairs: tuple[Any, str]) -> list[str]:
        return [question for value, question in pairs if value in (None, "")]

    def out(plan: dict, ask: list[str]) -> dict:
        if ask:
            plan["ask_person"] = ask
        return plan

    if kind == "ground":
        if step == "data_sync":
            return {"skill": "upload-data", "by_hand": True, "do": {"tool": "upload", "args": {
                "experiment": scope["experiment"], "site": scope["location"], "population": scope["population"],
                "date": scope["date"], "platform": scope["platform"], "sensor": scope["sensor"],
                "data_type": "amiga_bin", "paths": ["<folder with the .bin files>"]}},
                "ask_person": ["where the rover .bin files are on this computer"]}
        if step == "plot_marking":
            ask = need((facts.get("plots_per_bed"), "how many plots each bed has"),
                       (facts.get("border_plots"), "whether the first and last plot of a bed are borders"))
            return out({"skill": "ground-plot-marking", "by_hand": True,
                        "do": {"tool": "passes", "args": {"track": track}},
                        "then": "follow the skill pass by pass; finish with apply_boundaries and save_markings"}, ask)
        if step == "stitching":
            return {"skill": "ground-stitching", "do": {"tool": "stitch", "args": {"track": track}},
                    "then": "wait_jobs with the returned job id, then stitch_stats"}
        stitch = _latest_stitch(processed)
        if step == "plot_boundary_prep":
            if facts.get("gps_reliable") is False or facts.get("start_corner"):
                args = {"track": track, "start_corner": facts.get("start_corner") or "<corner the rover started from>"}
                for k in ("pass_axis", "rows_per_pass"):
                    if facts.get(k):
                        args[k] = facts[k]
                if design:
                    args["design_path"] = design
                return out({"skill": "ground-pipeline", "by_hand": True,
                            "do": {"tool": "traversal_layout", "args": args},
                            "then": "read the layout it returns, then traversal_boundaries, stitch_units, "
                                    "place_plot_images (ground-pipeline skill, 'From the driving pattern')"},
                           need((facts.get("start_corner"), "which corner of the field the rover started from")))
            return out({"skill": "ground-pipeline",
                        "do": {"tool": "ground_plot_boundaries",
                               "args": {"stitch_prefix": stitch, "design_path": design or "<field design file>"}}},
                       need((design, "the field design file (or agree to a stand-in: mock_field_design)"),
                            (facts.get("gps_reliable"), "whether the rover's GPS can be trusted here (if not: which "
                                                        "corner of the field it started from)")))
        if step == "associate_boundaries":
            return {"skill": "ground-pipeline", "do": {"tool": "associate_plots", "args": {"stitch_prefix": stitch}},
                    "then": "wait_jobs with the returned job id"}
    else:
        if step == "data_sync":
            return {"skill": "upload-data", "by_hand": True, "do": {"tool": "upload", "args": {
                "experiment": scope["experiment"], "site": scope["location"], "population": scope["population"],
                "date": scope["date"], "platform": scope["platform"], "sensor": scope["sensor"],
                "data_type": "images", "paths": ["<folder with the drone photos>"]}},
                "ask_person": ["where the drone photos are on this computer"]}
        if step == "orthomosaic":
            gcp = (run["steps"].get("gcp_selection") or {}).get("status") == "completed"
            args = {k: scope[k] for k in ("experiment", "location", "population", "date", "platform", "sensor")}
            if not gcp:
                args["skip_gcps"] = True
            return {"skill": "aerial-pipeline", "do": {"tool": "run_orthomosaic", "args": args},
                    "then": "wait_jobs with the returned job id (an orthomosaic takes 30 min to a few hours)",
                    "note": None if gcp else "no ground control points were picked: the map is positioned by the "
                                             "drone's GPS only. Say so to the person."}
        ortho = _ortho(run)
        if step == "plot_boundary_prep":
            args: dict[str, Any] = {"orthomosaic_path": ortho, "design_path": design or "<field design file>",
                                    "preview": True}
            for k in ("first_tier_at", "first_bed_at", "beds"):
                if facts.get(k):
                    args[k] = facts[k]
            return out({"skill": "aerial-pipeline", "do": {"tool": "plot_boundaries", "args": args},
                        "then": "look at the overlay; when it is right, repeat with preview=false"},
                       need((design, "the field design file"),
                            (facts.get("first_tier_at"), "which end of the field the design's first tier is at"),
                            (facts.get("first_bed_at"), "which side of the field the first bed is on")))
        if step == "split_orthomosaic":
            return {"skill": "aerial-pipeline", "do": {"tool": "split_plots", "args": {"orthomosaic_path": ortho}},
                    "then": "wait_jobs with the returned job id"}
        if step == "trait_extraction":
            return {"skill": "aerial-pipeline",
                    "do": {"tool": "canopy_cover", "args": {"images_prefix": processed + "PlotImages/"}},
                    "note": "canopy_cover is the simple colour-based trait; run_trait_extraction is the full one "
                            "(see the skill for its paths)"}
    if step == "inference":
        model = facts.get("model")
        name = str((model or {}).get("model_id") or (model or {}).get("name") or "model").split("/")[-1] \
            if isinstance(model, dict) else "<model>"
        return out({"skill": "inference",
                    "do": {"tool": "run_inference",
                           "args": {"images_prefix": processed + "PlotImages/", "per_plot": True,
                                    "output_predictions_path": f"{processed}predictions/{name}-v1.json",
                                    "model": model if isinstance(model, dict) else "<see the inference skill>"}},
                    "then": "wait_jobs, then inference_stats"},
                   need((model if isinstance(model, dict) else None, "which model to run, or what to detect")))
    return {"skill": "app-overview"}


def _match(runs: list[dict], words: str) -> list[dict]:
    want = words.lower().split()
    if not want:
        return runs

    def text(r: dict) -> str:
        up = r.get("uploadScope") or {}
        return " ".join([str(r.get("id")), str(r.get("name"))] + [str(up.get(k)) for k in SCOPE_KEYS]).lower()

    return [r for r in runs if all(w in text(r) for w in want)]


def _state(pr) -> tuple[list[dict], dict]:
    from .app_tools import _adopt

    _adopt(pr)
    pr.settle()
    st = pr.state()
    runs = sorted(st["runs"], key=lambda r: r.get("updatedAt") or "", reverse=True)
    return runs, {p["id"]: p for p in st["pipelines"]}


def _label(d: dict) -> str:
    s = d["scope"]
    return f"{s['location']} {s['population']} {s['date']} ({d['pipeline']})"


def _row(pr, run: dict, pipelines: dict) -> dict:
    d = pr.describe(run, pipelines)
    kind, order = d["pipeline"], (GROUND_STEPS if d["pipeline"] == "ground" else AERIAL_STEPS)
    row: dict[str, Any] = {"run": _label(d), "run_id": run["id"],
                           "done": [STEP_TITLE[k] for k in order if d["steps"][k] in ("completed", "skipped")]}
    busy = [k for k in order if d["steps"][k] == "running"]
    failed = [k for k in order if d["steps"][k] == "failed"]
    if busy:
        ids = (run["steps"][busy[0]].get("jobIds") or [])[-3:]
        row.update({"step": STEP_TITLE[busy[0]], "state": "running",
                    "do": {"tool": "wait_jobs", "args": {"job_ids": ids}}})
    elif failed:
        ids = (run["steps"][failed[0]].get("jobIds") or [])[-1:]
        row.update({"step": STEP_TITLE[failed[0]], "state": "failed",
                    "error": run["steps"][failed[0]].get("error"),
                    "do": {"tool": "job_detail", "args": {"job_id": ids[0]}} if ids else None,
                    "then": "read the error, fix the cause (see the step's skill), run the step again",
                    "retry": _plan(kind, failed[0], run)})
    elif d["current_step"] is None:
        row.update({"step": None, "state": "all steps done",
                    "optional": [STEP_TITLE[k] for k in OPTIONAL_STEPS if k in order
                                 and d["steps"][k] not in ("completed", "skipped")] or None})
    else:
        plan = _plan(kind, d["current_step"], run)
        plan.pop("by_hand", None)
        if plan.get("ask_person"):
            # Something only the person knows is missing: lead with the question, and
            # name the call as what follows their answer, so it is not made early.
            plan = {"skill": plan.get("skill"), "ask_person_first": plan.pop("ask_person"),
                    "after_they_answer_call": plan.pop("do", None),
                    **{k: v for k, v in plan.items() if k != "skill"}}
        row.update({"step": STEP_TITLE[d["current_step"]], "state": "to do", **plan})
    facts = facts_of(run["id"])
    if facts:
        row["known_facts"] = facts
    row["open_in_app"] = d["open_in_app"]
    return {k: v for k, v in row.items() if v is not None}


def next_step(args: dict) -> dict:
    def work(pr) -> Any:
        runs, pipelines = _state(pr)
        found = _match(runs, str(args.get("run") or ""))
        if not found:
            return {"runs": [], "note": "no run matches. A run appears once data is uploaded; "
                                        "names: " + ", ".join(_label(pr.describe(r, pipelines)) for r in runs[:8])}
        out = [_row(pr, run, pipelines) for run in found[: 1 if args.get("run") else 4]]
        return {"runs": out, "how": "read_skill the named skill once. `do` is a call you can make now. "
                                    "`ask_person_first` means stop and ask; record the answers with run_facts, "
                                    "then make `after_they_answer_call`. Values in <angle brackets> are never "
                                    "real values. continue_run makes these calls for you."}

    return {"result": process_tab(work)}


def run_facts(args: dict) -> dict:
    """Read, or add to, what the person has said about a run."""
    def work(pr) -> Any:
        runs, pipelines = _state(pr)
        found = _match(runs, str(args.get("run") or ""))
        if len(found) != 1:
            return {"error": f"`run` must pick exactly one run; it matches {len(found)}: " +
                             ", ".join(_label(pr.describe(r, pipelines)) for r in (found or runs)[:8])}
        run = found[0]
        facts = save_facts(run["id"], dict(args["set"])) if args.get("set") else facts_of(run["id"])
        return {"run": _label(pr.describe(run, pipelines)), "facts": facts, "can_be_recorded": FACT_KEYS}

    out = process_tab(work)
    if isinstance(out, dict) and out.get("error"):
        raise ValueError(out["error"])
    return {"result": out}


def continue_run(args: dict) -> dict:
    """Carry a run forward: make each due call, wait for its job, go on, and
    stop at the first thing that needs a person."""
    from .process_runs import ProcessRuns

    pr = ProcessRuns(client())
    deadline = time.time() + min(int(args.get("timeout_s") or 900), 3300)
    did: list[dict] = []
    images: list[str] = []

    def stop(state: str, **more: Any) -> dict:
        return {"result": {"run": label, "did": did or None, "state": state,
                           **{k: v for k, v in more.items() if v is not None}}, "images": images}

    label = ""
    for _ in range(8):
        runs, pipelines = _state(pr)
        found = _match(runs, str(args["run"]))
        if len(found) != 1:
            raise ValueError(f"`run` must pick exactly one run; it matches {len(found)}: " +
                             ", ".join(_label(pr.describe(r, pipelines)) for r in (found or runs)[:8]))
        run = found[0]
        d = pr.describe(run, pipelines)
        label = _label(d)
        kind, order = d["pipeline"], (GROUND_STEPS if d["pipeline"] == "ground" else AERIAL_STEPS)
        busy = [k for k in order if d["steps"][k] == "running"]
        failed = [k for k in order if d["steps"][k] == "failed"]
        if busy:
            ids = (run["steps"][busy[0]].get("jobIds") or [])[-3:]
            left = int(deadline - time.time())
            if left < 20:
                return stop("still running", step=STEP_TITLE[busy[0]], job_ids=ids,
                            next="call continue_run again later; nothing else is needed from you now")
            wait = TOOLS["wait_jobs"]["fn"]({"job_ids": ids, "timeout_s": left})["result"]
            if not wait["finished"]:
                return stop("still running", step=STEP_TITLE[busy[0]], job_ids=ids, progress=wait.get("still_open"),
                            next="call continue_run again later; nothing else is needed from you now")
            did.append({"waited_for": STEP_TITLE[busy[0]], "jobs": wait["counts"]})
            continue
        if failed:
            ids = (run["steps"][failed[0]].get("jobIds") or [])[-1:]
            return stop("failed", step=STEP_TITLE[failed[0]], error=run["steps"][failed[0]].get("error"),
                        job_id=ids[0] if ids else None,
                        next="read job_detail and the step's skill; fix the cause, then run that step again by hand")
        step = d["current_step"]
        if step is None:
            return stop("all steps done", open_in_app=d["open_in_app"])
        plan = _plan(kind, step, run)
        call = plan.get("do") or {}
        if plan.get("ask_person"):
            return stop("needs the person", step=STEP_TITLE[step], ask_person=plan["ask_person"],
                        record_answers_with={"tool": "run_facts", "args": {"run": args["run"], "set": {}}},
                        then="call continue_run again")
        if plan.get("by_hand") or not call:
            return stop("needs you (the agent)", step=STEP_TITLE[step], skill=plan.get("skill"),
                        start_with=call or None, then=plan.get("then"),
                        why="this step is worked through with its skill, not in one call")
        tool, targs = call["tool"], dict(call["args"])
        if tool == "plot_boundaries":
            # Never saved unseen: first a preview with the overlay, saved only once someone has agreed.
            targs["preview"] = not args.get("boundaries_confirmed")
        out = TOOLS[tool]["fn"](targs)
        result = out.get("result")
        images += list(out.get("images") or [])
        brief = {k: result[k] for k in ("id", "job_id", "status", "plots", "workers", "output", "assumed", "warnings")
                 if isinstance(result, dict) and k in result}
        did.append({"step": STEP_TITLE[step], "called": tool, "result": brief or str(result)[:300]})
        if tool == "plot_boundaries" and targs["preview"]:
            return stop("needs the person", step=STEP_TITLE[step],
                        ask_person=["look at the overlay: is every box on one plot, and are the labels where the "
                                    "field design says?"],
                        then="if yes: continue_run again with boundaries_confirmed=true. If not: correct "
                             "first_tier_at / first_bed_at / beds with run_facts and call continue_run again.")
        if tool == "canopy_cover":
            pr.set_step(run, "trait_extraction", "completed")
        if time.time() > deadline:
            return stop("paused", next="call continue_run again")
    return stop("paused", next="call continue_run again")


_run_arg = {**_str, "description": "words that pick one run, e.g. 'Davis 2026-08-21' or 'Coachella ground'"}
_tool(next_step, "What to do next for a pipeline run: the step, its skill, and the exact tool call with known "
      "arguments filled in. Call this whenever you are unsure what comes next. run: words that pick one run, "
      "e.g. 'Davis 2026-08-21' (default: the most recent runs).",
      {"run": _str}, [], track=False, group="status")
_tool(continue_run, "Carry one pipeline run forward by itself: makes each due call (orthomosaic, plot images, "
      "stitching, filing plots, canopy cover), waits for its job, goes on to the next step, and stops when the "
      "run is finished or something needs the person. Returns what it did and what it needs. Call it again to "
      "resume. Use this instead of making the step calls one by one.",
      {"run": _run_arg, "timeout_s": {**_int, "description": "how long to wait for jobs in this call (default 900)"},
       "boundaries_confirmed": {**_bool, "description": "true only after the person approved the plot-boundary overlay"}},
      ["run"], track=False, group="status")
_tool(run_facts, "What the person has said about a run (field design file, field orientation, the rover's start "
      "corner, the model to use). Without `set`: read them. With `set`: record answers the person just gave, "
      "so next_step and continue_run can use them.",
      {"run": _run_arg, "set": {"type": "object", "description": "facts to record, e.g. {\"design_path\": "
                                "\"C:/data/design.xlsx\", \"first_bed_at\": \"west\"}"}},
      ["run"], track=False, group="status")
