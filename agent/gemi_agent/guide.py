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
import re
import time
from typing import Any, Optional

from .client import AGENT_DIR
from .process_runs import AERIAL_STEPS, GROUND_STEPS, OPTIONAL_STEPS, SCOPE_KEYS, pipeline_type
from .tools import TOOLS, _bool, _int, _str, _tool, client, process_tab

STEP_TITLE = {"data_sync": "Upload", "image_review": "Image review", "gcp_selection": "Ground control points",
              "orthomosaic": "Orthomosaic", "plot_boundary_prep": "Plot boundaries",
              "split_orthomosaic": "Plot images", "trait_extraction": "Trait extraction", "inference": "Inference",
              "plot_marking": "Plot marking", "stitching": "Stitching", "associate_boundaries": "File plots by boundary"}

# ── what only the person knows ───────────────────────────────────────────────

FACTS_FILE = AGENT_DIR / "work" / "run_facts.json"
FACT_KEYS = {
    "design_path": "the field design file (.xlsx / .csv) on this computer; for rover data with no design yet, "
                   "the word stand-in (a placeholder design is then made)",
    "first_tier_at": "drone: which end of the field the design's first tier is at (north, south, east, west)",
    "first_bed_at": "drone: which side the design's first bed is on (north, south, east, west)",
    "beds": "drone: which beds of the design this flight covers, e.g. [2,3,4,5,6] (default: all)",
    "crops": "drone: the crops this flight covers, e.g. [\"Sorghum\"] (a flight of one crop; default: all)",
    "plot_length_m": "drone: plot length without the alley in metres, one number or per crop {\"Sorghum\": 3.0}",
    "gps_reliable": "rover: false when the rover's GPS cannot be trusted for placing plots",
    "start_corner": "rover: the corner of the field the rover started from (e.g. south-east)",
    "pass_axis": "rover: which way the beds run (north-south or east-west)",
    "rows_per_pass": "rover: crop rows in one image (1 or 2)",
    "plot_spacing_m": "rover: plot length plus alley in metres (the same all season; marking reports it once measured)",
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
    return {k: v for k, v in (_all_facts().get(run_id) or {}).items() if not k.startswith("_")}


def _note(run_id: str, key: str, value: Any = None) -> Any:
    """The harness's own memory for a run (keys start with _; never shown as facts).
    With a value: remember it. Without: read it."""
    data = _all_facts()
    row = dict(data.get(run_id) or {})
    if value is None:
        return row.get(key)
    row[key] = value
    data[run_id] = row
    FACTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    FACTS_FILE.write_text(json.dumps(data, indent=1))
    return value


def save_facts(run_id: str, patch: dict) -> dict:
    unknown = [k for k in patch if k not in FACT_KEYS]
    if unknown:
        raise ValueError(f"unknown fact {', '.join(unknown)}. Facts are: {', '.join(FACT_KEYS)}")
    data = _all_facts()
    row = dict(data.get(run_id) or {})
    patch = {k: v for k, v in patch.items() if v not in (None, "", [], {})}        # "not known" is not a fact
    for k, v in list(patch.items()):
        if isinstance(v, str) and v.strip().lower() in ("yes", "no", "true", "false"):
            v = v.strip().lower()
        if k == "design_path" and isinstance(v, str) and re.sub(r"[^a-z]", "", v.lower()) in (
                "standin", "mock", "mockfielddesign", "mockdesign", "placeholder", "none", "nodesign", "dummy", "makeone"):
            v = "stand-in"
        if k in ("first_tier_at", "first_bed_at") and isinstance(v, str):
            # "north end", "the East side" -> north, east
            sides = [w for w in ("north", "south", "east", "west") if w in v.lower()]
            if len(sides) != 1:
                raise ValueError(f"{k} must be one of north, south, east, west (got {v!r})")
            v = sides[0]
        if k == "start_corner" and isinstance(v, str):
            v = "-".join(w for w in ("north", "south", "east", "west") if w in v.lower()) or v
        if k == "pass_axis" and isinstance(v, str):
            low = v.lower()
            v = "north-south" if "north" in low or "south" in low else "east-west" if "east" in low or "west" in low else v
        if k == "gps_reliable" and isinstance(v, str):
            v = v in ("yes", "true")
        patch[k] = v
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


PHOTO_PLATFORMS = ("handheld", "hand-held", "phone", "camera", "photos", "photo", "tripod", "pole", "walk", "manual", "plot photos")


def _photo_set(scope: dict) -> bool:
    """An image set that is not a flight and not a rover track: plot photos without positions."""
    return any(w in str(scope.get("platform") or "").lower() for w in PHOTO_PLATFORMS)


def _label_of(run: dict) -> str:
    up = run.get("uploadScope") or {}
    return f"{up.get('location')} {up.get('population')} {up.get('date')}"


def _mark_mode(track_prefix: str) -> Optional[str]:
    """single frames | stitch | mixed, once mark_plots_auto has run on the track."""
    try:
        from .automark import mode_of
        from .tools import _track

        return mode_of(_track({"track": track_prefix}))
    except Exception:
        return None


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

    if _photo_set(scope) and step in ("plot_marking", "stitching", "plot_boundary_prep", "associate_boundaries",
                                      "gcp_selection", "orthomosaic", "split_orthomosaic"):
        # Photos of plots with no positions (hand-held, phone, a fixed camera): ground data, but with no
        # track to mark and nothing to stitch. Each photo is paired with a plot of the field design.
        return out({"skill": "plot-photos",
                    "do": {"tool": "plots_from_images", "args": {"run": _label_of(run), "design_path": design or "<field design file>"}},
                    "then": "show the person the pairing it returns and ask; on their yes, the same call with confirmed=true",
                    "no_design_yet": "record design_path = \"stand-in\" with run_facts (a made-up design is then made)"},
                   need((design, "the field design file, ideally with a column naming each plot's photo (or agree to a "
                                 "made-up design: record design_path = \"stand-in\")")))
    if kind == "ground":
        if step == "data_sync":
            return {"skill": "upload-data", "by_hand": True, "do": {"tool": "upload", "args": {
                "experiment": scope["experiment"], "site": scope["location"], "population": scope["population"],
                "date": scope["date"], "platform": scope["platform"], "sensor": scope["sensor"],
                "data_type": "amiga_bin", "paths": ["<folder with the .bin files>"]}},
                "ask_person": ["where the rover .bin files are on this computer"]}
        if step == "plot_marking":
            known = {k: facts[k] for k in ("plots_per_bed", "border_plots")
                     if isinstance(facts.get(k), (int, float)) or str(facts.get(k) or "").isdigit()}
            try:
                if facts.get("plot_spacing_m"):
                    known["plot_spacing_m"] = float(facts["plot_spacing_m"])
            except (TypeError, ValueError):
                pass
            return {"skill": "ground-plot-marking",
                    "do": {"tool": "mark_plots_auto", "args": {"track": track, "save": True, **known}},
                    "then": "tell the person what its `tell_the_person` says (plots found, passes to look at, stitching "
                            "or not)",
                    "better_with": None if "plots_per_bed" in known else
                    "the number of plots in a bed, if the person knows it (record with run_facts, then mark again)"}
        if step == "stitching" and _mark_mode(track) in ("single frames", "mixed"):
            args = {"track": track, "start_corner": facts.get("start_corner") or "<corner the rover started from>"}
            for k in ("pass_axis", "rows_per_pass"):
                if facts.get(k):
                    args[k] = facts[k]
            if design:
                args["design_path"] = design
            return out({"skill": "ground-pipeline", "by_hand": True,
                        "why": "the plants of most plots fit one camera frame, so those plots need no stitching: "
                               "each gets the raw frame that shows it whole",
                        "do": {"tool": "traversal_layout", "args": args},
                        "then": "traversal_boundaries, stitch_units (it skips the single-frame plots), wait_jobs if it "
                                "started any job, then place_plot_images"},
                       need((facts.get("start_corner"), "which corner of the field the rover started from")))
        if step == "stitching":
            return {"skill": "ground-stitching", "do": {"tool": "stitch", "args": {"track": track}},
                    "then": "wait_jobs with the returned job id, then stitch_stats with run"}
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
                               "args": {"stitch_prefix": stitch, "design_path": design or "<field design file>"}},
                        **({} if design else {"if_there_is_no_design_yet": {
                            "tool": "mock_field_design", "args": {"track": track},
                            "then": "record the design_path it returns with run_facts"}})},
                       need((design, "the field design file (or agree to a stand-in: mock_field_design)"),
                            (facts.get("gps_reliable"), "whether the rover's GPS can be trusted here (if not: which "
                                                        "corner of the field it started from)")))
        if step == "associate_boundaries":
            return {"skill": "ground-pipeline", "do": {"tool": "associate_plots", "args": {"stitch_prefix": stitch}},
                    "then": "wait_jobs with the returned job id"}
    elif _photo_set(scope) and step in ("gcp_selection", "orthomosaic", "plot_boundary_prep", "split_orthomosaic"):
        # Photos of plots with no positions (hand-held, phone, a fixed camera): there is no orthomosaic
        # to build. Each photo is paired with a plot of the field design instead.
        n = design
        return out({"skill": "plot-photos",
                    "do": {"tool": "plots_from_images", "args": {"run": _label_of(run), "design_path": n or "<field design file>"}},
                    "then": "show the person the pairing it returns and ask; on their yes, the same call with confirmed=true",
                    "no_design_yet": "mock_plot_design with plots = the number of photos; tell the person it is made up; "
                                     "record its file as design_path with run_facts"},
                   need((n, "the field design file, ideally with a column naming each plot's photo (or agree to a "
                            "made-up design: record design_path = \"stand-in\")")))
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
            for k in ("first_tier_at", "first_bed_at", "beds", "crops", "plot_length_m"):
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
                    "then": "wait_jobs, then inference_stats",
                    "note_for_you_not_the_person": "if the person has ALREADY named a model, do not ask again: call "
                                                   "continue_run with model (huggingface:<id>, roboflow:<id> or "
                                                   "weights:<path>)"},
                   need((model if isinstance(model, dict) else None, "which model to run, or what to detect")))
    return {"skill": "app-overview"}


def _match(runs: list[dict], words: str) -> list[dict]:
    # The names this module prints ("Davis Sorghum 2026-08-21 (aerial)") must find their run
    # again, as must the everyday words for the two kinds of run; filler words are ignored.
    filler = {"the", "run", "pipeline", "data", "track", "flight", "trial", "at", "on", "of", "from", "for"}
    want = [w for w in re.sub(r"[()\[\],;:\"'/·|]", " ", words.lower()).split() if w not in filler]
    if not want:
        return runs
    kinds = {"ground": "ground rover amiga", "aerial": "aerial drone uav"}

    def text(r: dict) -> str:
        up = r.get("uploadScope") or {}
        kind = kinds[pipeline_type(up)]
        return " ".join([str(r.get("id")), str(r.get("name")), kind] + [str(up.get(k)) for k in SCOPE_KEYS]).lower()

    hits = [r for r in runs if all(w in text(r) for w in want)]
    if len(hits) > 1:
        # "RoverTest" also sits inside "RoverTest2": when whole words pick fewer runs, they decide.
        whole = [r for r in hits if all(w in re.split(r"[^a-z0-9.\-]+", text(r)) for w in want)]
        if whole:
            hits = whole
    if not hits and len(want) > 1:
        # No run has every word: take the run that has the most of them, when one stands out.
        # A date or number that is given must match: a run of another day is another run.
        exact = [w for w in want if any(ch.isdigit() for ch in w)]
        score = sorted(((sum(w in text(r) for w in want), i) for i, r in enumerate(runs)
                        if all(w in text(r) for w in exact)), reverse=True)
        if score and score[0][0] >= 2 and (len(score) == 1 or score[0][0] > score[1][0]):
            hits = [runs[score[0][1]]]
    return hits


def _state(pr) -> tuple[list[dict], dict]:
    from .app_tools import _adopt

    _adopt(pr)
    pr.settle()
    st = pr.state()
    runs = sorted(st["runs"], key=lambda r: r.get("updatedAt") or "", reverse=True)
    return runs, {p["id"]: p for p in st["pipelines"]}


def _label(d: dict) -> str:
    s = d["scope"]
    batch = f", {d['batch_label']}" if d.get("batch_label") else ""        # run of the day / treatment
    return f"{s['location']} {s['population']} {s['date']}{batch} ({d['pipeline']})"


def _extracting(run: dict) -> list[dict]:
    """Rover logs of this run that are still being turned into images. The upload
    is "done" as soon as the files are in; nothing after it can start until
    these jobs finish."""
    scope = run.get("uploadScope") or {}
    if "amiga" not in str(scope.get("platform") or "").lower():
        return []
    want = [str(scope.get(k) or "") for k in ("experiment", "location", "population", "date")]
    try:
        rows = client().jobs(None, "EXTRACT_BINARY", 200)
    except Exception:
        return []
    out = []
    for j in rows:
        if j.get("status") not in ("PENDING", "RUNNING"):
            continue
        text = json.dumps(j.get("parameters") or j.get("params") or {}, default=str)
        if all(w and w in text for w in want):
            out.append({"job_id": str(j["id"]), "status": j["status"], "progress": j.get("progress")})
    return out


def _row(pr, run: dict, pipelines: dict) -> dict:
    d = pr.describe(run, pipelines)
    extracting = _extracting(run)
    if extracting:
        return {"run": _label(d), "run_id": run["id"], "done": ["Upload"],
                "step": "Extraction (rover log to images)", "state": "running", "jobs": extracting,
                "do": {"tool": "wait_jobs", "args": {"job_ids": [j["job_id"] for j in extracting]}},
                "then": "when it has finished: continue_run (plot marking comes next)"}
    kind, order = d["pipeline"], (GROUND_STEPS if d["pipeline"] == "ground" else AERIAL_STEPS)
    row: dict[str, Any] = {"run": _label(d), "run_id": run["id"],
                           "done": [STEP_TITLE[k] for k in order if d["steps"][k] in ("completed", "skipped")]}
    # "How did X go?" is asked about finished steps: name the call that answers it.
    asked_with = {"stitching": {"tool": "stitch_stats", "args": {"run": _label(d)}}}
    went = {STEP_TITLE[k]: v for k, v in asked_with.items() if k in order and d["steps"].get(k) == "completed"}
    if went:
        row["how_a_finished_step_went"] = went
    if kind == "ground" and d["steps"].get("stitching") == "completed":
        try:                                   # the outcome itself, so "how did it go" needs no further call
            stitch = _latest_stitch("Processed/" + "/".join(str((run.get("uploadScope") or {})[k]) for k in SCOPE_KEYS) + "/")
            m = json.loads(client().download(stitch + "stitch_manifest.json")) if stitch else {}
            ok, bad = len(m.get("succeeded_plots") or []), len(m.get("failed_plots") or {})
            if ok or bad:
                row["stitching_result"] = f"{ok} of {ok + bad} plots stitched" + (f"; failed: {sorted(m['failed_plots'])}" if bad else "")
        except Exception:
            pass
    if d["steps"].get("inference") in (None, "pending") and d["steps"].get("associate_boundaries", d["steps"].get("split_orthomosaic")) == "completed":
        row["measurable_now_without_a_model"] = {"green canopy cover": {"tool": "canopy_cover", "args": {"run": _label(d)}}}
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
        title = STEP_TITLE[d["current_step"]]
        if plan.get("skill") == "plot-photos":
            title = "Pair photos with plots (no GPS)"          # not an orthomosaic: there is none to build
        row.update({"step": title, "state": "to do", **plan})
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
        given = args.get("set")
        if given and not isinstance(given, dict):
            raise ValueError("`set` records ANSWERS the person has given, as an object of fact name and their answer. "
                             "Nothing is recorded for this run by this call. To see what is recorded, call run_facts "
                             "without `set`; to get an answer, ask the person. Fact names: " + ", ".join(FACT_KEYS))
        facts = save_facts(run["id"], dict(given)) if given else facts_of(run["id"])
        out = {"run": _label(pr.describe(run, pipelines)), "facts": facts}
        if given:
            out["next"] = ("recorded. Now call continue_run for this run. Do not ask the person about other facts: "
                           "continue_run says if anything more is needed.")
        else:
            out["can_be_recorded"] = FACT_KEYS
        return out

    out = process_tab(work)
    if isinstance(out, dict) and out.get("error"):
        raise ValueError(out["error"])
    return {"result": out}


def _earlier_undrawn(runs: list[dict], run: dict) -> Optional[dict]:
    """An earlier date of the same field and season whose plot boundaries are not done yet."""
    up = run.get("uploadScope") or {}
    same = ("experiment", "location", "population", "platform", "sensor")
    best = None
    for r in runs:
        o = r.get("uploadScope") or {}
        if r is run or str(o.get("date") or "") >= str(up.get("date") or "") or                 str(o.get("date") or "")[:4] != str(up.get("date") or "")[:4]:
            continue
        if any(str(o.get(k)) != str(up.get(k)) for k in same):
            continue
        if ((r.get("steps") or {}).get("plot_boundary_prep") or {}).get("status") == "completed":
            continue
        if best is None or str(o.get("date")) < str((best.get("uploadScope") or {}).get("date")):
            best = r
    if best is None:
        return None
    o = best.get("uploadScope") or {}
    steps = best.get("steps") or {}
    st = next((f"{k}: {v.get('status')}" for k, v in steps.items() if v.get("status") in ("running", "failed")), None)
    return {"label": f"{o.get('location')} {o.get('date')}", "state": st or "waiting for its next step"}


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
        if args.get("model") and not did:
            from .app_tools import _model_spec

            save_facts(run["id"], {"model": _model_spec(args["model"], None)})
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
        extracting = _extracting(run)
        if extracting:
            ids = [j["job_id"] for j in extracting]
            left = int(deadline - time.time())
            wait = TOOLS["wait_jobs"]["fn"]({"job_ids": ids, "timeout_s": max(20, left)})["result"] if left >= 20 else None
            if not wait or not wait["finished"]:
                return stop("still running", step="Extraction (rover log to images)", job_ids=ids,
                            progress=(wait or {}).get("still_open") or extracting,
                            next="call continue_run again later; nothing else is needed from you now")
            did.append({"waited_for": "Extraction (rover log to images)", "jobs": wait["counts"]})
            continue
        if failed:
            ids = (run["steps"][failed[0]].get("jobIds") or [])[-1:]
            return stop("failed", step=STEP_TITLE[failed[0]], error=run["steps"][failed[0]].get("error"),
                        job_id=ids[0] if ids else None,
                        next="read job_detail and the step's skill; fix the cause, then run that step again by hand")
        step = d["current_step"]
        if step is None:
            return stop("all steps done", open_in_app=d["open_in_app"])
        design = str(facts_of(run["id"]).get("design_path") or "").strip().lower()
        if kind == "ground" and step == "plot_boundary_prep" and design in ("stand-in", "stand in", "standin", "placeholder"):
            # No field design yet: make the placeholder one here, so the model has nothing to carry.
            made = TOOLS["mock_field_design"]["fn"]({"track": _track(run)})["result"]
            path = made.get("file") or made.get("design_path") or made.get("path")
            if not path:
                raise RuntimeError(f"the stand-in design was not written: {made}")
            save_facts(run["id"], {"design_path": str(path)})
            did.append({"step": STEP_TITLE[step], "called": "mock_field_design", "result": {"design_path": str(path)}})
        up_scope = run.get("uploadScope") or {}
        if _photo_set(up_scope) and design in ("stand-in", "stand in", "standin", "placeholder"):
            # Plot photos and no field design yet: a made-up design with one plot per photo.
            from .plot_images import _images_of

            _, photos, _ = _images_of({"run": _label_of(run)})
            made = TOOLS["mock_plot_design"]["fn"]({"plots": len(photos)})["result"]
            save_facts(run["id"], {"design_path": str(made["file"])})
            did.append({"step": "Field design", "called": "mock_plot_design",
                        "result": {"design_path": str(made["file"]), "plots": len(photos), "made_up": True}})
        if kind == "aerial" and step == "plot_boundary_prep" and not args.get("fresh_boundaries"):
            # Same field, same season: the earliest date is drawn first (before the canopy closes
            # over the alleys); later dates then take its boundaries, moved onto their own map.
            first = _earlier_undrawn(runs, run)
            if first:
                return stop("earlier date first", step=STEP_TITLE[step],
                            earlier_run=first["label"], its_state=first["state"],
                            why="plot boundaries are drawn on the earliest date of a field and season, then moved "
                                "onto later dates (the canopy hides the alleys later on)",
                            next=f"continue_run with run \"{first['label']}\" first; or fresh_boundaries=true to draw "
                                 "this date on its own")
        plan = _plan(kind, step, run)
        call = plan.get("do") or {}
        if plan.get("ask_person"):
            return stop("needs the person", step=STEP_TITLE[step], ask_person=plan["ask_person"],
                        record_answers_with={"tool": "run_facts", "args": {"run": args["run"], "set": {
                            "<fact>": "<what the person said>"}}},
                        facts_you_can_record=[k for k in FACT_KEYS if k != "notes"],
                        no_design_yet=('record design_path = "stand-in"' if kind == "ground" and step != "inference" else None),
                        needs_no_model=({"green canopy cover of the plots": {"tool": "canopy_cover", "args": {"run": label}}}
                                        if step == "inference" else None),
                        if_the_person_already_said_it="look at their last message first: if it answers any of these (for "
                                                      "example \"there is no design, make one up\"), record that with "
                                                      "run_facts now and call continue_run again. Ask only for what "
                                                      "they have not said.",
                        then="ask the person; record each answer with run_facts; call continue_run again")
        if plan.get("by_hand") or not call:
            return stop("needs you (the agent)", step=STEP_TITLE[step], skill=plan.get("skill"),
                        start_with=call or None, then=plan.get("then"),
                        why="this step is worked through with its skill, not in one call")
        tool, targs = call["tool"], dict(call["args"])
        if tool == "plots_from_images":
            targs["confirmed"] = bool(args.get("boundaries_confirmed"))      # "the person confirmed what was shown"
        if tool == "stitch" and args.get("plots"):
            targs["plot_ids"] = [int(p) for p in args["plots"]]     # the person asked for some plots only
        if tool == "plot_boundaries":
            # Never saved unseen. "Confirmed" only counts for the very layout a preview has shown:
            # a model cannot confirm what the person has not seen, or a layout changed since.
            shown = json.dumps({k: targs.get(k) for k in ("orthomosaic_path", "design_path", "first_tier_at",
                                                           "first_bed_at", "beds")}, sort_keys=True)
            from .tools import confirmable, forget_shown, mark_shown

            key = "boundaries:" + str(run["id"]) + ":" + shown
            targs["preview"] = not (args.get("boundaries_confirmed") and confirmable(key))
            if targs["preview"]:
                _note(run["id"], "_preview", shown)
                mark_shown(key)
            else:
                forget_shown(key)
        out = TOOLS[tool]["fn"](targs)
        result = out.get("result")
        images += list(out.get("images") or [])
        brief = {k: result[k] for k in ("id", "job_id", "status", "plots", "workers", "output", "assumed", "warnings")
                 if isinstance(result, dict) and k in result}
        did.append({"step": STEP_TITLE[step], "called": tool, "result": brief or str(result)[:300]})
        if tool == "plots_from_images":
            did[-1]["result"] = {k: result.get(k) for k in ("photos", "plots_in_design", "paired", "filed", "pairing_rule",
                                                            "first", "last", "problems") if result.get(k) is not None}
            if not result.get("filed"):
                return stop("needs the person", step="Pairing photos with plots (overlay of the pairing)",
                            tell_the_person=result.get("tell_the_person"),
                            ask_person=["is this pairing of photos and plots right? (there is no GPS to check it later)"],
                            then="if yes: continue_run again with boundaries_confirmed=true. If not: ask for a field "
                                 "design with a column naming each plot's photo, record it with run_facts, and "
                                 "continue_run again.")
            continue
        if tool == "plot_boundaries" and targs["preview"]:
            return stop("needs the person", step=STEP_TITLE[step],
                        ask_person=["look at the overlay: is every box on one plot, and are the labels where the "
                                    "field design says?"],
                        then="if yes: continue_run again with boundaries_confirmed=true. If not: correct "
                             "first_tier_at / first_bed_at / beds with run_facts and call continue_run again.")
        if tool == "mark_plots_auto":
            told = result.get("tell_the_person") if isinstance(result, dict) else None
            did[-1]["result"] = {k: result.get(k) for k in ("plots", "passes_marked", "passes_to_check", "recommendation",
                                                            "saved_version")} if isinstance(result, dict) else did[-1]["result"]
            if not (isinstance(result, dict) and result.get("saved_version")):
                # A pass needs a look (or nothing was found): the markings are not saved, so the run stops here.
                return stop("needs you (the agent)", step=STEP_TITLE[step], skill="ground-plot-marking",
                            tell_the_person=told,
                            then="look at the passes to check with panorama (track, pass, markings: true); correct "
                                 "them if needed; then save_markings and continue_run again")
            return stop("needs the person", step="Plot marking (done)", tell_the_person=told,
                        ask_person=["nothing is required: tell them the result. If they know how many plots a bed has "
                                    "and it differs from what was found, record it with run_facts and mark again"],
                        then="continue_run again to go on (stitching, or plot images from single frames)")
        if tool == "canopy_cover":
            pr.set_step(run, "trait_extraction", "completed")
        if time.time() > deadline:
            return stop("paused", next="call continue_run again")
    return stop("paused", next="call continue_run again")


_run_arg = {**_str, "description": "words that pick one run: its site and date as the person said them, or the "
                                   "name process_runs prints for it"}
_tool(next_step, "What to do next for a pipeline run: the step, its skill, and the exact tool call with known "
      "arguments filled in. Call this whenever you are unsure what comes next. run: words that pick one run, "
      "its site and date as the person said them (default: the most recent runs).",
      {"run": _str}, [], track=False, group="status")
_tool(continue_run, "Carry one pipeline run forward by itself: makes each due call (orthomosaic, plot images, "
      "stitching, filing plots, canopy cover), waits for its job, goes on to the next step, and stops when the "
      "run is finished or something needs the person. Returns what it did and what it needs. Call it again to "
      "resume. Use this instead of making the step calls one by one.",
      {"run": _run_arg, "timeout_s": {**_int, "description": "how long to wait for jobs in this call (default 900)"},
       "fresh_boundaries": {**_bool, "description": "draw this date's plot boundaries on their own, not after the "
                            "earliest date of the field (only when the person asks)"},
       "boundaries_confirmed": {**_bool, "description": "true only after the person approved what continue_run last "
                                                         "showed them: the plot-boundary overlay, or the pairing of "
                                                         "photos with plots"},
       "plots": {"type": "array", "items": _int,
                 "description": "rover stitching only: stitch just these plot numbers, when the person asked for some "
                                "plots and not all"},
       "model": {**_str, "description": "the model for the Inference step, when the person has named one: "
                                        "huggingface:<model id>, roboflow:<model id> or weights:<path>"}},
      ["run"], track=False, group="status")
_tool(run_facts, "What the person has said about a run (field design file, field orientation, the rover's start "
      "corner, the model to use). Without `set`: read them. With `set`: record answers the person just gave, "
      "so next_step and continue_run can use them.",
      {"run": _run_arg, "set": {"type": "object", "description": "facts to record, e.g. {\"design_path\": "
                                "\"C:/data/design.xlsx\", \"first_bed_at\": \"west\"}"}},
      ["run"], track=False, group="status")
