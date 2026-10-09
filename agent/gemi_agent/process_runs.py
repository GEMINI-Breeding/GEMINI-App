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

WORKSPACE_NAME = "Agent runs"
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


def pipeline_type(scope: dict) -> str:
    return "ground" if scope.get("platform", "").lower() in ("amiga", "rover", "monopod", "ground") else "aerial"


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
        if matches:
            run = max(matches, key=lambda r: r.get("updatedAt") or "")
            ids = set((run.get("uploadScope") or {}).get("datasetShortIds") or [])
            new = set(scope.get("datasetShortIds") or [])
            if ids and new and not new <= ids:        # another upload batch joined this scope
                run["uploadScope"]["datasetShortIds"] = sorted(ids | new)
                self._save(run)
            return run
        ws = next((w for w in st["workspaces"] if w.get("name") == WORKSPACE_NAME), None)
        if ws is None:
            ws = {"id": str(uuid.uuid4()), "name": WORKSPACE_NAME,
                  "description": "Runs started by the agent. Open one to follow or continue it step by step.",
                  "createdAt": _now()}
            self._put("workspace", ws)
        name = f"{'Ground' if kind == 'ground' else 'Aerial'} (agent)"
        pipe = next((p for p in st["pipelines"]
                     if p.get("workspaceId") == ws["id"] and p.get("type") == kind and p.get("name") == name), None)
        if pipe is None:
            pipe = {"id": str(uuid.uuid4()), "workspaceId": ws["id"], "name": name, "type": kind,
                    "params": PIPELINE_PARAMS[kind], "createdAt": _now()}
            self._put("pipeline", pipe)
        upload_scope = {**want}
        if scope.get("datasetShortIds"):
            upload_scope["datasetShortIds"] = list(scope["datasetShortIds"])
        exp = next((e for e in self.client.entities("experiments")
                    if e.get("experiment_name") == scope.get("experiment")), None)
        if exp:
            upload_scope["experimentId"] = str(exp["id"])
        run = {"id": str(uuid.uuid4()), "pipelineId": pipe["id"], "workspaceId": ws["id"],
               "name": f"{scope.get('date')} · {scope.get('platform')}/{scope.get('sensor')}",
               "createdBy": "agent",
               "scope": {"experimentId": upload_scope.get("experimentId"), "seasonId": None, "siteId": None,
                         "populationId": None},
               "uploadScope": upload_scope, "status": "draft", "steps": {}, "createdAt": _now(), "updatedAt": _now()}
        self._put("run", run)
        return run

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
        return self.describe(run)

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
        return {"run_id": run["id"], "name": run.get("name"), "pipeline": kind,
                "scope": {k: (run.get("uploadScope") or {}).get(k) for k in SCOPE_KEYS},
                "steps": steps, "current_step": nxt,
                "open_in_app": f"/process/{run['workspaceId']}/run/{run['id']}"}

    def list(self) -> list[dict]:
        st = self.state()
        pipelines = {p["id"]: p for p in st["pipelines"]}
        runs = sorted(st["runs"], key=lambda r: r.get("updatedAt") or "", reverse=True)
        return [self.describe(r, pipelines) for r in runs]
