# GEMINIbase Migration — Gap Analysis

Phase 1 deliverable for the `migration/geminibase` branch. Ground truth from the GEMINIbase submodule cloned at `backend/`, the live OpenAPI spec at `http://localhost:7777/schema/openapi.json`, and source-level audits of the four on-disk workers. Decisions reached in the approved plan (`/Users/bnbailey/.claude/plans/i-want-to-undertake-squishy-lantern.md`) apply: Tauri wraps the compose stack, no data migration, upstream PRs for gaps, Workspace → Experiment.

---

## 1. Live-stack confirmation

- REST API up on :7777; `/schema` returns 200.
- 192 routes; all prefixed `/api/` (earlier WebFetch-based notes missed this).
- No auth challenge — `GET /api/experiments/all` returns 200 with no token. Confirmed auth gap.
- TiTiler :8091 and NodeODM :13000 both healthy.
- WebSocket `/api/jobs/{job_id}/progress` exists in source (`backend/gemini/rest_api/controllers/jobs.py:242-243`) but is not in the OpenAPI spec (Litestar doesn't emit WS routes).

---

## 2. Worker inventory — ground truth

Reviewed each worker under `backend/gemini/workers/`.

| Job type | Worker | Status | Notes |
|---|---|---|---|
| RUN_ODM | `odm/worker.py:158` | **REAL** | DL images → NodeODM → upload → enqueues CREATE_COG |
| CREATE_COG | `geo/worker.py:104` | **REAL** | Reproject to Web Mercator, pyramids, tiled COG |
| TIF_TO_PNG | `geo/worker.py:104` | **REAL** | Rasterio + PIL |
| PROCESS_DRONE_TIFF | `geo/worker.py:104` | **REAL** | Composite of COG + PNG |
| SPLIT_ORTHOMOSAIC | `geo/worker.py:104` | **REAL** | Per-plot PNG masking, WGS84↔raster CRS |
| EXTRACT_BINARY | `flir/worker.py:52` | **REAL** | torch + kornia + kornia-rs + farm-ng protobuf + `flir/bin_to_images.py:689+` — this is exactly what the old FastAPI backend's `bin_to_images/` did; no porting needed |
| RUN_GWAS | `gwas/worker.py:57` | **REAL** | plink2 + gemma subprocess, matplotlib plots |
| TRAIN_MODEL | `ml/worker.py` | **STUB** (landed in Phase 3) | Wired in ml worker; returns FAILED with clear "not implemented" until a training framework is provisioned |
| LOCATE_PLANTS | `ml/worker.py:83` | **REAL** (landed in Phase 3) | Roboflow cloud inference with tile + NMS; ported from main:backend/app/processing/inference_utils.py. Local inference-server mode deferred |
| EXTRACT_TRAITS | `ml/worker.py:155` | **REAL** (landed in Phase 3) | ExG vegetation fraction + DEM canopy height; ported from main:backend/app/processing/aerial.py. Thermal deferred |
| RUN_STITCH | `stitch/worker.py` | **SCAFFOLDED** (Phase 3) | Worker built; compose stanza stays commented until the AgRowStitch submodule lands at `gemini/workers/stitch/vendor/AgRowStitch/` |

**Correction to the approved plan:** EXTRACT_BINARY already exists. EXTRACT_TRAITS was re-routed from "extend geo worker" to ml worker per `JOB_TYPE_WORKER_MAP`. Remaining gap: RUN_STITCH activation (AgRowStitch submodule).

**Worker dependency matrix:**

| Worker | torch | kornia | kornia-rs | opencv | rasterio | Roboflow SDK |
|---|---|---|---|---|---|---|
| odm | — | — | — | — | — | — |
| geo | — | — | — | — | ✅ | — |
| flir | ✅ | ✅ | ✅ | ✅ | — | — |
| gwas | — | — | — | — | — | — |

No worker currently uses the Roboflow `inference-sdk` — LOCATE_PLANTS will need to bring it in.

---

## 3. Endpoint gap summary (current backend → GEMINIbase)

Frontend calls against ~112 distinct current-backend endpoints. After mapping:

- **Direct structural match**: 0 (paths all change, prefix `/api/v1/*` → `/api/*`)
- **Semantic match to an existing GEMINIbase endpoint**: ~12
- **Needs upstream PR (no equivalent)**: ~94
- **Drop (no longer applicable)**: ~6

### Semantic matches (no upstream PR, just frontend adaptation)

| Current | GEMINIbase | Adapter work |
|---|---|---|
| `POST /api/v1/pipeline-runs/{id}/execute-step` | `POST /api/jobs/submit` | Wrap step name + params in `job_type` + `parameters` |
| `POST /api/v1/pipeline-runs/{id}/stop` | `POST /api/jobs/{job_id}/cancel` | Track job id per step |
| `GET /api/v1/pipeline-runs/{id}/progress` (SSE) | WS `/api/jobs/{id}/progress` | New `wsManager.ts` |
| `POST /api/v1/files/` (single shot) | `POST /api/files/upload` / `/upload_chunk` / `check_uploaded_chunks` | Rewrite `useFileUpload.ts` for chunked + resume |
| `POST /api/v1/files/copy-local-stream` (JSON-line events) | `POST /api/files/upload_chunk` + `POST /api/jobs/submit {EXTRACT_BINARY}` + WS | Split into two phases |
| `POST /api/v1/files/convert-geotiff` | `POST /api/jobs/submit {CREATE_COG}` | Async |
| Plot marking save/load (several) | `POST /api/plot_geometry/mark`, `POST /api/plot_geometry/borders`, `POST /api/geojson/{save,load}` | GEMINIbase's plot_geometry controller is richer than anticipated (see §4) |
| GCP — `save-gcp-locations`, `gcp-selection` | Partial: `POST /api/plot_geometry/gps_reference`, `/set_gps_reference`, `/shift_gps` | May be sufficient; verify during Phase 2 |
| `GET /api/v1/analyze/*/traits` | `GET /api/traits/all` + filter | Filter client-side or add server-side filters |
| `GET /api/v1/analyze/trait-records` | `GET /api/datasets/id/{id}/records` | Model lines up after Workspace→Experiment fold |
| Reference-data list / delete | `GET /api/datasets/all`, `DELETE /api/datasets/id/{id}` | After Workspace→Experiment fold |

### Drops

- `/utils/capabilities`, `/utils/docker-check`, `/settings/docker-resources` — local-sidecar-specific; with Tauri wrapping compose, feature-detection moves to the Tauri side or is gated by service-health probes.
- `/items/*`, `/private/users/` — legacy/demo; unused by the frontend in any critical path.
- `/api/v1/migrate/plot-boundaries` — migration utility from the previous backend rewrite; fresh-start decision means it's not needed.

### Unexpectedly present in GEMINIbase (reduces planned Phase 2 scope)

The `plot_geometry` controller covers more than my WebFetch-based assumption:

```
POST /api/plot_geometry/mark
POST /api/plot_geometry/borders
POST /api/plot_geometry/associate
POST /api/plot_geometry/associations
POST /api/plot_geometry/data
POST /api/plot_geometry/delete
POST /api/plot_geometry/gps_data
POST /api/plot_geometry/gps_reference
POST /api/plot_geometry/gps_shift_status
POST /api/plot_geometry/image_plot_index
POST /api/plot_geometry/max_index
POST /api/plot_geometry/set_gps_reference
POST /api/plot_geometry/shift_gps
POST /api/plot_geometry/stitch_direction
POST /api/plot_geometry/stitch_mask/check
POST /api/plot_geometry/stitch_mask/save
POST /api/plot_geometry/undo_gps_shift
```

And `model_management` covers model lifecycle that previously I'd have put in scope:

```
POST /api/model_management/best_locate
POST /api/model_management/best_model
POST /api/model_management/done
POST /api/model_management/info
POST /api/model_management/locate_info
```

**Implication:** Approved-plan Phase 2 PR #2 ("Plot-geometry versioning & tooling endpoints") shrinks — a lot of it is already there. What still needs to be added is **versioning** semantics (named versions of plot markings / boundaries / stitches with rename/activate/delete), which the current backend has and GEMINIbase seems to treat as overwrite-in-place. Confirm during Phase 2 against the actual controller source.

---

## 4. Protocol adaptations

1. **SSE → WebSocket** for step progress. Current `frontend/src/lib/sseManager.ts` (EventSource, singleton-per-run_id, 2s reconnect, late-subscriber replay) must be mirrored as `wsManager.ts` (WebSocket, singleton-per-job_id, `GET /api/jobs/{id}` for late replay, same reconnect semantics).
2. **Chunked uploads**. Current `useFileUpload.ts` POSTs to `/files/copy-local-stream` and parses JSON-line progress. New flow: for each file, loop `POST /api/files/upload_chunk` → `POST /api/files/check_uploaded_chunks` to confirm; after all files, if `.bin`, `POST /api/jobs/submit {job_type: EXTRACT_BINARY}` and subscribe to WS for progress. Per-file progress = chunk upload progress.
3. **All URLs re-prefix** `/api/v1/...` → `/api/...` and most paths change entirely. Regen SDK is mandatory — no partial migration.
4. **Auth** — no token injection today. Once upstream auth PR lands, Bearer token goes in `Authorization` header (frontend already has this plumbing for the current backend; reuse).
5. **File serving**. Current `/files/serve?path=...` (absolute path) → GEMINIbase `/api/files/download/{file_path}` or `GET /api/files/presign/{file_path}` → MinIO presigned URL. Every `<img src>`, map overlay, and download link changes.

---

## 5. Implications for the approved plan

Changes warranted in the plan file:

- **Phase 3 worker scope shrinks**: EXTRACT_BINARY is already implemented upstream in the FLIR worker. Drop the binary-extraction port task. Two new workers needed: `workers/ml/` (LOCATE_PLANTS + EXTRACT_TRAITS + TRAIN_MODEL-stub) and `workers/stitch/` (RUN_STITCH).
- **Phase 2 controller scope shrinks**: `plot_geometry` and `model_management` controllers are already rich. Upstream PR for plot-geometry becomes "add versioning semantics on top of existing endpoints" rather than "author from scratch."
- **Phase 4 ordering**: The SDK regen step is mandatory and will churn every feature file at once. Can't do it page-by-page; plan for a single PR that flips the SDK and bulk-rewrites all call sites, with CI red until it's all green.
- **No data migration** (already decided): skip `scripts/migrate_sqlite_to_postgres.py` / `migrate_files_to_minio.py`.

---

## 6. Critical files (reference for later phases)

### In this repo
- `docker-compose.yaml` (new, Phase 0) — `include:`s the submodule's compose
- `scripts/setup-backend.sh` (new, Phase 0) — submodule init + `.env` seeding
- `frontend/src/client/` — to be regenerated from `http://localhost:7777/schema/openapi.json` during Phase 4
- `frontend/src/lib/sseManager.ts` — template for `wsManager.ts`
- `frontend/src/features/files/hooks/useFileUpload.ts` — to be rewritten for chunked uploads
- `frontend/src/features/{files,process,analyze,dashboard}/api.ts` — call-site rewrites in Phase 4/5

### In the submodule (upstream PR targets)
Note: the submodule now occupies `backend/`. All paths below are relative to `backend/`.
- New: `gemini/rest_api/controllers/auth.py`, `users.py`; `gemini/db/models/users.py`; alembic migration
- New: `gemini/workers/stitch/` (worker.py + Dockerfile + requirements.txt)
- New: `gemini/workers/ml/` (worker.py + Dockerfile + Roboflow `inference-sdk` integration)
- (landed in Phase 3) EXTRACT_TRAITS handled by `gemini/workers/ml/worker.py` (ExG + canopy height); thermal deferred.
- Enhance: `gemini/rest_api/controllers/plot_geometry.py` for versioning (named versions, rename, activate, delete)

### Reuse from the old FastAPI backend (read from git history on `main`)
These files have been deleted from `migration/geminibase`. Retrieve individual files with `git show main:<path>` when porting logic. Locations on `main`:
- `backend/app/processing/aerial.py` — ExG + canopy-height kernels for EXTRACT_TRAITS (ported into `workers/ml/trait_extraction.py`); temp kernels not yet ported.
- `backend/app/processing/inference_utils.py` — `crop_image_with_overlap`, `run_inference_on_image`, `apply_nms` for the new LOCATE_PLANTS worker
- `backend/vendor/AgRowStitch/` (its own GitHub repo: `github.com/GEMINI-Breeding/AgRowStitch`) + `backend/patches/AgRowStitch.py` + `backend/app/processing/ground.py` — stitching logic for the new `workers/stitch/` worker (drop the PyInstaller subprocess channel)
- `backend/app/routes/login.py` + `backend/app/routes/users.py` — pattern for the new auth controller
