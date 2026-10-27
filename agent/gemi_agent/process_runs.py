"""Keep the app's Process tab in step with what the agent does.

The Process tab shows Workspace → Pipeline → Run → steps. Those live in
the server's process-state store (`/api/process_state`, one JSON document
each), which every browser polls. Whenever the agent uploads data, saves
plot markings or submits a pipeline job, the matching run is created (or
found) here and its step updated — so the person can open Process, see the
run with the same step states, watch a job's progress, and carry on by hand
from the next step.

Document shapes mirror frontend `features/process/lib/runStore.ts`; step
keys and their order mirror GROUND_STEPS / AERIAL_STEPS in RunDetail.tsx.
"""
from __future__ import annotations

import time
import uuid
from typing import Any, Optional

from .client import ApiError, Client

LEGACY_WORKSPACE = "Agent runs"   # where earlier versions put every agent run; `regroup` empties it
GROUND_STEPS = ("data_sync", "plot_marking", "stitching", "plot_boundary_prep", "associate_boundaries", "inference")
AERIAL_STEPS = ("data_sync", "image_review", "gcp_selection", "orthomosaic", "plot_boundary_prep",
                "split_orthomosaic", "trait_extraction", "inference")
OPTIONAL_STEPS = ("image_review", "gcp_selection")
SCOPE_KEYS = ("year", "experiment", "location", "population", "date", "platform", "sensor")

# What the pipeline wizard saves for a new pipeline (ProcessingPipeline.tsx).
PIPELINE_PARAMS = {
    "ground": {"device": "cpu", "num_cpu": 0, "platform": "amiga",
               "agrowstitch_params": {"forward_limit": 4, "max_reprojection_error": 1.0, "crop_rules": [],
                                      "batch_size": 10, "min_inliers": 20},
               "custom_agrowstitch_options": "", "roboflow_models": [], "inference_mode": "cloud"},
    "aerial": {"reconstruction_quality": "Standard", "custom_odm_options": "", "roboflow_models": [],
               "inference_mode": "cloud"},
}
JOB_STEP = {"RUN_STITCH": "stitching", "ASSOCIATE_BOUNDARIES": "associate_boundaries", "RUN_ODM": "orthomosaic",
            "SPLIT_ORTHOMOSAIC": "split_orthomosaic", "EXTRACT_TRAITS": "trait_extraction",
            "LOCATE_PLANTS": "inference"}


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + ".000Z"


def scope_from_path(path: str) -> Optional[dict]:
    """Raw/… or Processed/{year}/{experiment}/{location}/{population}/{date}/{platform}/{sensor}/… → scope,
    plus the dataset short id when the path is a Raw dataset folder."""
    parts = path.strip("/").split("/")
    if len(parts) < 8 or parts[0] not in ("Raw", "Processed"):
        return None
    scope: dict[str, Any] = dict(zip(SCOPE_KEYS, parts[1:8]))
    if parts[0] == "Raw" and len(parts) > 8 and len(parts[8]) == 8:
        scope["datasetShortIds"] = [parts[8]]
    return scope


# Ground: rovers, and cameras carried or set up at ground level. Aerial: cameras and sensors on a UAV.
GROUND_PLATFORMS = ("amiga", "rover", "monopod", "ground", "handheld", "hand-held", "phone", "camera", "tripod", "pole",
                    "cart", "walk", "manual", "plot photos")


def pipeline_type(scope: dict) -> str:
    p = str(scope.get("platform") or "").lower()
    return "ground" if p in GROUND_PLATFORMS or any(w in p for w in ("handheld", "hand-held", "phone", "rover")) else "aerial"


# -- inference model entries --------------------------------------------------
# A pipeline's models live in params.roboflow_models (the key predates the
# other sources). Each entry mirrors frontend lib/inferenceModels.ts: label,
# source, task_type and the source's own fields. A provider the app does not
# know yet keeps its settings under `extra`, passed to the worker unchanged,
# so a new source needs no change here or in the app to be listed and re-run.
_MODEL_FIELDS = {
    "huggingface": {"hf_model_id": "hf_model_id", "hf_mode": "hf_mode", "hf_token": "hf_token",
                    "hf_zero_shot": "hf_zero_shot", "hf_prompt": "hf_prompt"},
    "roboflow": {"model_id": "roboflow_model_id", "api_key": "roboflow_api_key"},
    "local_weights": {"weights_path": "weights_path"},
}
_JOB_ONLY = {"image_path", "images_prefix", "output_predictions_path", "count_label", "confidence_threshold",
             "iou_threshold", "boundaries", "source", "task_type", "model_source", "per_plot"}


def model_entry(params: dict) -> Optional[dict]:
    """The pipeline entry for the model a LOCATE_PLANTS job's parameters name."""
    source = str(params.get("source") or params.get("model_source") or "").strip()
    if not source:
        return None
    entry: dict[str, Any] = {"label": str(params.get("count_label") or ""), "source": source,
                             "task_type": str(params.get("task_type") or "detection")}
    fields = _MODEL_FIELDS.get(source)
    if fields is None:
        extra = {k: v for k, v in params.items() if k not in _JOB_ONLY}
        if not extra:
            return None
        entry["extra"] = extra
    else:
        for k, target in fields.items():
            if params.get(k) not in (None, ""):
                entry[target] = params[k]
        if source == "local_weights":
            entry["weights_name"] = str(params.get("weights_path") or "").rsplit("/", 1)[-1]
        if source == "roboflow" and params.get("api_url"):
            entry["extra"] = {"api_url": params["api_url"]}
        if not any(entry.get(t) for t in fields.values()):
            return None
    return entry


def model_identity(entry: dict) -> tuple:
    """Source and model: two entries naming the same model are one."""
    source = entry.get("source")
    key = (entry.get("hf_model_id") if source == "huggingface" else
           entry.get("roboflow_model_id") if source == "roboflow" else
           entry.get("weights_path") if source == "local_weights" else
           tuple(sorted((k, str(v)) for k, v in (entry.get("extra") or {}).items() if "key" not in k and "token" not in k)))
    prompt = entry.get("hf_prompt") if entry.get("hf_zero_shot") else None
    return source, key, prompt


class ProcessRuns:
    def __init__(self, client: Client):
        self.client = client

    # -- store ------------------------------------------------------------
    def state(self) -> dict:
        return self.client.get_json("/api/process_state") or {"workspaces": [], "pipelines": [], "runs": []}

    def _put(self, kind: str, doc: dict) -> None:
        self.client.request("PUT", f"/api/process_state/{kind}/{doc['id']}", {"doc": doc})

    # -- find or create -------------------------------------------------------
    def ensure_run(self, scope: dict, kind: Optional[str] = None) -> dict:
        """The run for this scope and pipeline type; an existing one — made by
        a person or the agent — is reused, so work lands where they look."""
        kind = kind or pipeline_type(scope)
        st = self.state()
        types = {p["id"]: p.get("type") for p in st["pipelines"]}
        want = {k: scope.get(k) for k in SCOPE_KEYS}
        matches = [r for r in st["runs"]
                   if types.get(r.get("pipelineId")) == kind
                   and {k: (r.get("uploadScope") or {}).get(k) for k in SCOPE_KEYS} == want]
        new = set(scope.get("datasetShortIds") or [])
        label = str(scope.get("batchLabel") or "")
        # The run that already holds this batch, whichever it is.
        owning = [r for r in matches if new and new & set((r.get("uploadScope") or {}).get("datasetShortIds") or [])]
        if owning:
            return max(owning, key=lambda r: r.get("updatedAt") or "")
        # Otherwise a labelled batch (a run of the day, a treatment) only joins a run with the same label;
        # each label is processed on its own. Unlabelled batches at one scope pool into one run, as before.
        matches = [r for r in matches if str((r.get("uploadScope") or {}).get("batchLabel") or "") == label]
        if matches:
            run = max(matches, key=lambda r: r.get("updatedAt") or "")
            ids = set((run.get("uploadScope") or {}).get("datasetShortIds") or [])
            if ids and new and not new <= ids:        # another upload batch joined this scope
                run["uploadScope"]["datasetShortIds"] = sorted(ids | new)
                self._save(run)
            return run
        ws = self._workspace_for(st, scope)
        pipe = self._pipeline_for(st, ws, kind, scope)
        upload_scope = {**want}
        if scope.get("datasetShortIds"):
            upload_scope["datasetShortIds"] = list(scope["datasetShortIds"])
        if label:
            upload_scope["batchLabel"] = label
        exp = next((e for e in self.client.entities("experiments")
                    if e.get("experiment_name") == scope.get("experiment")), None)
        if exp:
            upload_scope["experimentId"] = str(exp["id"])
        run = {"id": str(uuid.uuid4()), "pipelineId": pipe["id"], "workspaceId": ws["id"],
               "name": f"{scope.get('date')} · {scope.get('platform')}/{scope.get('sensor')}" + (f" · {label}" if label else ""),
               "createdBy": "agent",
               "scope": {"experimentId": upload_scope.get("experimentId"), "seasonId": None, "siteId": None,
                         "populationId": None},
               "uploadScope": upload_scope, "status": "draft", "steps": {}, "createdAt": _now(), "updatedAt": _now()}
        self._put("run", run)
        return run

    # -- where a person would file it ---------------------------------------
    @staticmethod
    def _norm(text: Any) -> str:
        return " ".join(str(text or "").lower().replace("_", " ").replace("-", " ").split())

    def _kin(self, run: dict, scope: dict) -> bool:
        """Same experiment, season (year) and platform: runs a person keeps together."""
        u = run.get("uploadScope") or {}
        return (self._norm(u.get("experiment")) == self._norm(scope.get("experiment"))
                and str(u.get("date") or "")[:4] == str(scope.get("date") or "")[:4]
                and self._norm(u.get("platform")) == self._norm(scope.get("platform")))

    def _fits(self, st: dict, ws: dict, scope: dict) -> int:
        """How well a workspace suits a run of this scope: the runs a person put there
        of the same experiment, season and platform (agent-made runs do not count, so
        a misfiled run cannot pull others after it); a workspace named after the
        experiment, or the experiment and year, also suits."""
        placed = sum(1 for r in st["runs"] if r.get("workspaceId") == ws["id"] and r.get("createdBy") != "agent"
                     and self._kin(r, scope))
        if placed:
            return placed
        name = self._norm(ws.get("name"))
        exp, year = self._norm(scope.get("experiment")), str(scope.get("date") or "")[:4]
        return 1 if exp and name in (exp, f"{exp} {year}".strip()) else 0

    def _workspace_for(self, st: dict, scope: dict) -> dict:
        """Where a person would file this run: a workspace holding their own runs of the
        same experiment, season and platform, or named after the experiment (and year);
        else a new one, "<experiment> <year>". A workspace made for something else
        (another site's rover runs, say) is not used just because it shares the
        experiment. Never the legacy all-agent workspace."""
        spaces = [w for w in st["workspaces"] if w.get("name") != LEGACY_WORKSPACE]
        scored = [(self._fits(st, w, scope), w) for w in spaces]
        best = max((x for x in scored if x[0] > 0), key=lambda x: x[0], default=None)
        if best:
            return best[1]
        year = str(scope.get("date") or "")[:4]
        name = " ".join(x for x in (str(scope.get("experiment") or "Unnamed experiment"), year) if x)
        ws = {"id": str(uuid.uuid4()), "name": name,
              "description": f"Experiment {scope.get('experiment')}, {year or 'season not given'}", "createdAt": _now()}
        self._put("workspace", ws)
        st["workspaces"].append(ws)
        return ws

    def _pipeline_for(self, st: dict, ws: dict, kind: str, scope: dict,
                      params: Optional[dict] = None) -> dict:
        """A pipeline of this type in the workspace, preferring one whose runs
        share this platform and sensor (same settings); else a new one."""
        pipes = [p for p in st["pipelines"] if p.get("workspaceId") == ws["id"] and p.get("type") == kind]
        kit = (self._norm(scope.get("platform")), self._norm(scope.get("sensor")))

        def same_kit(p: dict) -> int:
            return sum(1 for r in st["runs"] if r.get("pipelineId") == p["id"] and
                       (self._norm((r.get("uploadScope") or {}).get("platform")),
                        self._norm((r.get("uploadScope") or {}).get("sensor"))) == kit)
        if pipes:
            return max(pipes, key=same_kit)
        name = f"{'Ground' if kind == 'ground' else 'Aerial'} · {scope.get('platform')}/{scope.get('sensor')}"
        pipe = {"id": str(uuid.uuid4()), "workspaceId": ws["id"], "name": name, "type": kind,
                "params": params or PIPELINE_PARAMS[kind], "createdAt": _now()}
        self._put("pipeline", pipe)
        st["pipelines"].append(pipe)
        return pipe

    def regroup(self, dry_run: bool = False) -> list[dict]:
        """Move runs out of the legacy "Agent runs" workspace into their
        experiment's workspace (keeping their pipeline settings when the
        workspace has no pipeline of that type yet), then remove the legacy
        workspace and its pipelines once empty. Jobs and data are untouched:
        only the Process tab's folders change."""
        moved = self._rehome(dry_run)
        st = self.state()
        legacy = [w for w in st["workspaces"] if w.get("name") == LEGACY_WORKSPACE]
        if not legacy:
            return moved
        ids = {w["id"] for w in legacy}
        old_pipes = {p["id"]: p for p in st["pipelines"] if p.get("workspaceId") in ids}
        for run in [r for r in st["runs"] if r.get("workspaceId") in ids]:
            scope = run.get("uploadScope") or {}
            old = old_pipes.get(run.get("pipelineId")) or {}
            kind = old.get("type") or pipeline_type(scope)
            ws = self._workspace_for(st, scope) if not dry_run else {"id": "?", "name": scope.get("experiment")}
            pipe = (self._pipeline_for(st, ws, kind, scope, old.get("params")) if not dry_run
                    else {"id": "?", "name": f"{kind} pipeline"})
            moved.append({"run": run.get("name"), "to_workspace": ws.get("name"), "to_pipeline": pipe.get("name")})
            if dry_run:
                continue
            run.update(workspaceId=ws["id"], pipelineId=pipe["id"], createdBy="agent")
            self._put("run", run)
        if not dry_run:
            left = self.state()
            for p in old_pipes:
                if not any(r.get("pipelineId") == p for r in left["runs"]):
                    self.client.request("DELETE", f"/api/process_state/pipeline/{p}")
            for w in ids:
                if not any(r.get("workspaceId") == w for r in left["runs"]):
                    self.client.request("DELETE", f"/api/process_state/workspace/{w}")
        return moved

    def _rehome(self, dry_run: bool = False) -> list[dict]:
        """Agent-made runs filed in a workspace that does not suit them (one made
        for other runs that happened to share the experiment) move to where
        _workspace_for files them now, with their pipeline's settings. A person's
        own runs never move; pipelines the agent made and left empty are removed;
        workspaces are kept."""
        st = self.state()
        pipes = {p["id"]: p for p in st["pipelines"]}
        spaces = {w["id"]: w for w in st["workspaces"]}
        moved: list[dict] = []
        for run in [r for r in st["runs"] if r.get("createdBy") == "agent"]:
            scope = run.get("uploadScope") or {}
            ws = spaces.get(run.get("workspaceId"))
            if not scope.get("experiment") or ws is None or ws.get("name") == LEGACY_WORKSPACE \
                    or self._fits(st, ws, scope):
                continue
            old = pipes.get(run.get("pipelineId")) or {}
            kind = old.get("type") or pipeline_type(scope)
            if dry_run:
                year = str(scope.get("date") or "")[:4]
                to = next((w for w in st["workspaces"] if self._fits(st, w, scope)), None)
                moved.append({"run": f"{scope.get('location')} {scope.get('date')}", "from": ws.get("name"),
                              "to_workspace": (to or {}).get("name") or f"{scope.get('experiment')} {year} (new)"})
                continue
            new_ws = self._workspace_for(st, scope)
            spaces[new_ws["id"]] = new_ws
            pipe = self._pipeline_for(st, new_ws, kind, scope, old.get("params"))
            moved.append({"run": f"{scope.get('location')} {scope.get('date')}", "from": ws.get("name"),
                          "to_workspace": new_ws.get("name"), "to_pipeline": pipe.get("name")})
            run.update(workspaceId=new_ws["id"], pipelineId=pipe["id"])
            self._put("run", run)
        if moved and not dry_run:
            left = self.state()
            for p in left["pipelines"]:
                made = str(p.get("name") or "").startswith(("Aerial · ", "Ground · "))
                if made and not any(r.get("pipelineId") == p["id"] for r in left["runs"]):
                    self.client.request("DELETE", f"/api/process_state/pipeline/{p['id']}")
        return moved

    def _save(self, run: dict) -> None:
        run["updatedAt"] = _now()
        states = [s.get("status") for s in run["steps"].values()]
        if "running" in states:
            run["status"] = "running"
        elif "failed" in states:
            run["status"] = "failed"
        elif run.get("status") == "draft" and not states:
            run["status"] = "draft"
        else:
            run["status"] = "running" if states else "draft"
        self._put("run", run)

    # -- steps ----------------------------------------------------------------
    def set_step(self, run: dict, key: str, status: str, job_id: Optional[str] = None,
                 outputs: Optional[dict] = None, error: Optional[str] = None) -> dict:
        prev = run["steps"].get(key) or {"status": "pending", "jobIds": []}
        step = dict(prev)
        if job_id and job_id not in step["jobIds"]:
            step["jobIds"] = [*step["jobIds"], job_id]
            step["startedAt"] = _now()
            step.pop("completedAt", None)
            step.pop("error", None)
        if status == "running" and job_id is None and prev.get("status") == "running":
            pass
        step["status"] = status
        if status == "running":
            step.setdefault("startedAt", _now())
        if status in ("completed", "failed", "skipped"):
            step["completedAt"] = _now()
        if outputs:
            step["outputs"] = {**(step.get("outputs") or {}), **outputs}
        if error:
            step["error"] = error
        elif status != "failed":
            step.pop("error", None)
        run["steps"][key] = step
        self._save(run)
        return run

    def record_job(self, scope: dict, job: dict, kind: Optional[str] = None, skipped: tuple[str, ...] = ()) -> dict:
        """A pipeline job the agent submitted: attach it to its step."""
        run = self.ensure_run(scope, kind)
        for key in skipped:
            if (run["steps"].get(key) or {}).get("status") not in ("completed", "running"):
                self.set_step(run, key, "skipped")
        step = JOB_STEP.get(str(job.get("job_type")))
        if step:
            self.set_step(run, step, "running", job_id=str(job.get("id")))
        if str(job.get("job_type")) == "LOCATE_PLANTS":
            self.register_model(run, job.get("parameters") or {})
        return self.describe(run)

    # -- inference models on the run's pipeline ------------------------------
    def register_model(self, run: dict, params: dict) -> Optional[dict]:
        """Add the model a LOCATE_PLANTS job ran to the run's pipeline, so the
        Inference tool lists it and a person can run it again. Already listed
        (same source and model) is left alone."""
        entry = model_entry(params)
        if entry is None:
            return None
        pipe = next((p for p in self.state()["pipelines"] if p["id"] == run.get("pipelineId")), None)
        if pipe is None:
            return None
        params_ = dict(pipe.get("params") or {})
        models = list(params_.get("roboflow_models") or [])
        if any(model_identity(m) == model_identity(entry) for m in models):
            return None
        params_["roboflow_models"] = [*models, entry]
        self._put("pipeline", {**pipe, "params": params_})
        return entry

    def register_models_from_jobs(self, run: dict) -> list[dict]:
        """Backfill: every model this run's inference jobs used."""
        added = []
        for jid in (run.get("steps", {}).get("inference") or {}).get("jobIds") or []:
            try:
                job = self.client.job(jid)
            except ApiError:
                continue
            got = self.register_model(run, job.get("parameters") or {})
            if got:
                added.append(got)
        return added

    def settle(self) -> list[dict]:
        """Bring every running step up to date with its jobs. The Process page
        does the same while it is open; this covers the time it is not."""
        changed = []
        for run in self.state()["runs"]:
            dirty = False
            for key, step in list(run.get("steps", {}).items()):
                if step.get("status") != "running" or not step.get("jobIds"):
                    continue
                try:
                    jobs = [self.client.job(j) for j in step["jobIds"][-5:]]
                except ApiError:
                    continue
                if any(j.get("status") in ("PENDING", "RUNNING") for j in jobs):
                    continue                      # something of this step is still going
                last = max(jobs, key=lambda j: j.get("created_at") or "")
                st = last.get("status")
                if st == "COMPLETED":
                    outputs = None
                    if key == "orthomosaic":
                        outputs = self._ortho_outputs(step, last)
                    self.set_step(run, key, "completed", outputs=outputs)
                    dirty = True
                elif st in ("FAILED", "CANCELLED"):
                    self.set_step(run, key, "failed", error=str(last.get("error_message") or st.title()))
                    dirty = True
            if dirty:
                changed.append(self.describe(run))
        return changed

    @staticmethod
    def _ortho_outputs(step: dict, job: dict) -> Optional[dict]:
        """A finished RUN_ODM becomes an orthomosaic version, as the page's
        mergeOrthoVersionFromJobResult does."""
        path = (job.get("result") or {}).get("orthophoto_path")
        if not isinstance(path, str) or not path:
            return None
        versions = list((step.get("outputs") or {}).get("versions") or [])
        if any(v.get("jobId") == str(job.get("id")) for v in versions):
            return None
        versions.append({"filename": path.split("/")[-1], "path": f"gemini/{path}", "source": "RUN_ODM",
                         "jobId": str(job.get("id")), "createdAt": job.get("completed_at") or _now()})
        return {"versions": versions}

    # -- reading ----------------------------------------------------------------
    def describe(self, run: dict, pipelines: Optional[dict] = None) -> dict:
        if pipelines is None:
            pipelines = {p["id"]: p for p in self.state()["pipelines"]}
        kind = (pipelines.get(run.get("pipelineId")) or {}).get("type") or pipeline_type(run.get("uploadScope") or {})
        order = GROUND_STEPS if kind == "ground" else AERIAL_STEPS
        steps = {k: (run["steps"].get(k) or {}).get("status", "pending") for k in order}
        nxt = next((k for k in order if steps[k] not in ("completed", "skipped") and k not in OPTIONAL_STEPS), None)
        out = {"run_id": run["id"], "name": run.get("name"), "pipeline": kind,
               "batch_label": (run.get("uploadScope") or {}).get("batchLabel"),
               "scope": {k: (run.get("uploadScope") or {}).get(k) for k in SCOPE_KEYS},
               "steps": steps, "current_step": nxt,
               "open_in_app": f"/process/{run['workspaceId']}/run/{run['id']}"}
        host = self.folded_into(run)
        if host is not None and not any(v in ("running", "failed") for v in steps.values()):
            # Another camera of an RGB run's flight (thermal beside RGB): processed there.
            out["current_step"] = None
            out["with_run"] = {"run_id": host["id"], "name": host.get("name"),
                               "batch_label": (host.get("uploadScope") or {}).get("batchLabel")}
            out["note"] = (f"these {(run.get('uploadScope') or {}).get('sensor')} frames are processed with the RGB "
                           "run of the same flight: its plot images from the raw frames (split_plots source=frames) "
                           "include them, and a thermal camera gives canopy temperature. Nothing is due here; "
                           "this run's own steps only build this sensor's orthomosaic, if the person asks for one.")
        return out

    # -- one flight, several cameras (the app's companionRuns.ts) ------------------------------------

    PRIMARY_SENSORS = ("rgb", "visible", "wide")

    @staticmethod
    def sensor_type(sensor: Any) -> str:
        """"rgb" from "RGB" or "RGB-SonyA7R" (another camera of that type)."""
        return str(sensor or "").strip().split("-")[0].lower()

    def _batch_treatments(self) -> dict[str, str]:
        """Upload batch (dataset short id) -> its treatment label, once per instance."""
        if getattr(self, "_treatments", None) is None:
            self._treatments = {}
            try:
                rows = self.client.get_json("/api/datasets/all?limit=5000") or []
                rows = rows if isinstance(rows, list) else rows.get("data", [])
                for d in rows:
                    t = str((d.get("dataset_info") or {}).get("treatment") or "").strip()
                    if t:
                        self._treatments[str(d.get("id"))[:8]] = t
            except Exception:
                pass
        return self._treatments

    @staticmethod
    def _split_label(label: Any) -> tuple[str, str]:
        run_part, trt = "", ""
        for part in (p.strip() for p in str(label or "").split("·")):
            if part.lower().startswith("run "):
                run_part = part[4:].strip()
            elif part:
                trt = part
        return run_part, trt

    def _run_treatments(self, run: dict) -> set[str]:
        _, own = self._split_label((run.get("uploadScope") or {}).get("batchLabel"))
        if own:
            return {own}
        labels = self._batch_treatments()
        return {labels[i] for i in (run.get("uploadScope") or {}).get("datasetShortIds") or [] if i in labels}

    def folded_into(self, run: dict, runs: Optional[list] = None) -> Optional[dict]:
        """The RGB run of the same flight another camera's run folds into: same experiment,
        site, population, date and platform, same run of the day, a treatment it holds."""
        up = run.get("uploadScope") or {}
        if self.sensor_type(up.get("sensor")) in self.PRIMARY_SENSORS:
            return None
        place = ("experiment", "location", "population", "date", "platform")
        mine_run, _ = self._split_label(up.get("batchLabel"))
        mine_trt = None
        for r in runs if runs is not None else self.state()["runs"]:
            u = r.get("uploadScope") or {}
            if r is run or self.sensor_type(u.get("sensor")) not in self.PRIMARY_SENSORS:
                continue
            if any(str(u.get(k) or "") != str(up.get(k) or "") for k in place):
                continue
            if self._split_label(u.get("batchLabel"))[0] != mine_run:
                continue
            mine_trt = self._run_treatments(run) if mine_trt is None else mine_trt
            theirs = self._run_treatments(r)
            if not mine_trt or not theirs or mine_trt <= theirs:
                return r
        return None

    def list(self) -> list[dict]:
        st = self.state()
        pipelines = {p["id"]: p for p in st["pipelines"]}
        runs = sorted(st["runs"], key=lambda r: r.get("updatedAt") or "", reverse=True)
        return [self.describe(r, pipelines) for r in runs]
