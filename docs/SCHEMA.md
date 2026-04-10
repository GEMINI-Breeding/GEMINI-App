# GEMINI-App — Data Schema Reference

This document describes every persistent data store: the SQLite database tables and the filesystem layout (`Raw/`, `Intermediate/`, `Processed/`).

**When to update this doc:** any time you add or rename a database model, add a new file path to `RunPaths`, or change where a data type is uploaded.

---

## Table of Contents

1. [SQLite Database](#sqlite-database)
   - [User](#user)
   - [Workspace](#workspace)
   - [Pipeline](#pipeline)
   - [PipelineRun](#pipelinerun)
   - [TraitRecord](#traitrecord)
   - [PlotRecord](#plotrecord)
   - [FileUpload](#fileupload)
   - [AppSetting](#appsetting)
   - [ReferenceDataset](#referencedataset)
   - [ReferencePlot](#referenceplot)
   - [WorkspaceReferenceDataset](#workspacereferencedataset)
2. [Filesystem Layout](#filesystem-layout)
   - [Raw](#raw)
   - [Intermediate](#intermediate)
   - [Processed](#processed)
3. [Uploaded Data Types](#uploaded-data-types)
4. [How to Add a New Database Model](#how-to-add-a-new-database-model)
5. [How to Add a New File Path](#how-to-add-a-new-file-path)

---

## SQLite Database

**Location (defaults):**

| Platform | Path |
|----------|------|
| Linux    | `~/.local/share/gemi/gemi.db` |
| macOS    | `~/Library/Application Support/GEMI/gemi.db` |
| Windows  | `%APPDATA%\GEMI\gemi.db` |

Override with `SQLITE_DB_PATH=/path/to/gemi.db` in `.env`.

The schema is managed by `SQLModel.metadata.create_all()` at startup — no migration scripts. Alembic exists in `backend/app/alembic/` for history only.

---

### User

**File:** `backend/app/models/user.py`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | |
| `email` | str (unique, indexed) | |
| `hashed_password` | str | |
| `is_active` | bool | default `True` |
| `is_superuser` | bool | default `False` |
| `full_name` | str \| None | |

**Relationships:** `items`, `file_uploads`, `workspaces`

> There is no login UI — `get_current_user()` queries the first superuser directly. The app assumes a single local user per machine.

---

### Workspace

**File:** `backend/app/models/workspace.py`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | |
| `name` | str (max 255) | |
| `description` | str \| None (max 1000) | |
| `owner_id` | UUID (FK → User.id) | CASCADE delete |
| `created_at` | str | ISO timestamp |

**Relationships:** `owner` (User), `pipelines` (list[Pipeline])

Workspace name is used as a folder name in `Intermediate/` and `Processed/` — keep it filesystem-safe (no slashes or special characters).

---

### Pipeline

**File:** `backend/app/models/pipeline.py`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | |
| `name` | str (max 255) | |
| `type` | str (max 50) | `"ground"` or `"aerial"` |
| `config` | dict \| None (JSON) | Stitch direction, ODM options, etc. |
| `workspace_id` | UUID (FK → Workspace.id) | CASCADE delete |
| `created_at` | str | |
| `updated_at` | str \| None | |

**Relationships:** `workspace` (Workspace), `runs` (list[PipelineRun])

> Two pipelines in the same workspace can share a name (e.g. one ground and one aerial). Always use `pipeline_id` (UUID) as the unique key — never `pipeline_name`.

---

### PipelineRun

**File:** `backend/app/models/pipeline.py`

Central record for one data-collection event (one day, one field, one sensor pass).

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | |
| `pipeline_id` | UUID (FK → Pipeline.id) | CASCADE delete |
| `file_upload_id` | UUID \| None (FK → FileUpload.id) | SET NULL on delete |
| `date` | str (max 50) | ISO date — `"2024-06-15"` |
| `experiment` | str (max 255) | e.g. `"Drought2024"` |
| `location` | str (max 255) | e.g. `"Davis"` |
| `population` | str (max 255) | e.g. `"WheatPanel"` |
| `platform` | str (max 255) | `"Amiga"`, `"DJI"`, etc. |
| `sensor` | str (max 255) | `"RGB"`, `"Thermal"`, etc. |
| `status` | str (max 50) | `"pending"` \| `"running"` \| `"completed"` \| `"failed"` |
| `current_step` | str \| None (max 100) | Active step name |
| `steps_completed` | dict[str, bool] \| None (JSON) | `{"stitching": true, ...}` |
| `outputs` | dict[str, Any] \| None (JSON) | **Relative** paths to output files (relative to `data_root`) |
| `error` | str \| None (max 2000) | |
| `created_at` | str | |
| `completed_at` | str \| None | |

**Relationships:** `pipeline` (Pipeline)

#### Ground pipeline steps

| Step key | Description |
|----------|-------------|
| `plot_marking` | User selects image ranges per plot |
| `stitching` | AgRowStitch creates panoramas |
| `inference` | Roboflow detection (optional) |

#### Aerial pipeline steps

| Step key | Description |
|----------|-------------|
| `gcp_selection` | User marks ground control points |
| `orthomosaic` | ODM generates ortho + DEM |
| `plot_boundaries` | User draws polygons on the map |
| `trait_extraction` | Compute VF, height, temperature per plot |
| `inference` | Roboflow on split plot images (optional) |

#### `outputs` JSON keys (common)

| Key | Value | Set by step |
|-----|-------|-------------|
| `msgs_synced` | `Intermediate/.../msgs_synced.csv` (relative) | data sync |
| `stitch_outputs` | list of `{version, path, ...}` entries | stitching |
| `ortho_outputs` | list of `{version, rgb, dem, ...}` entries | orthomosaic |
| `traits_geojson` | `Processed/.../Traits-WGS84.geojson` (relative) | trait extraction |
| `cropped_images_dir` | `Processed/.../cropped_images_v{N}/` (relative) | trait extraction |

> All paths in `outputs` are **relative to `data_root`**. Reconstruct absolute paths with `paths.abs(run.outputs["key"])`.

---

### TraitRecord

**File:** `backend/app/models/pipeline.py`

One record per trait extraction run. Captures provenance (which orthomosaic version, which plot boundary version).

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | |
| `run_id` | UUID (FK → PipelineRun.id, indexed) | CASCADE delete |
| `geojson_path` | str (max 1000) | Relative path to `Traits-WGS84.geojson` |
| `ortho_version` | int \| None | Which orthomosaic version was used (aerial) |
| `ortho_name` | str \| None (max 255) | |
| `boundary_version` | int \| None | Which plot boundary version was used |
| `boundary_name` | str \| None (max 255) | |
| `version` | int | Sequential within the run (1-based) |
| `plot_count` | int | Number of plots extracted |
| `trait_columns` | list[str] (JSON) | Column names present in the GeoJSON |
| `vf_avg` | float \| None | Average vegetation fraction |
| `height_avg` | float \| None | Average canopy height |
| `created_at` | str | |

---

### PlotRecord

**File:** `backend/app/models/plot_record.py`

One row per individual plot, per trait extraction. Denormalized for fast querying in the Analyze tab.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | |
| `trait_record_id` | UUID (indexed) | FK to TraitRecord |
| `run_id` | UUID (indexed) | FK to PipelineRun |
| `pipeline_id` | str (max 100) | |
| `pipeline_type` | str (max 20) | `"aerial"` or `"ground"` |
| `pipeline_name` | str (max 255) | |
| `workspace_id` | str (max 100) | |
| `workspace_name` | str (max 255) | |
| `date` | str (max 50) | |
| `experiment` | str (max 255) | |
| `location` | str (max 255) | |
| `population` | str (max 255) | |
| `platform` | str (max 255) | |
| `sensor` | str (max 255) | |
| `trait_record_version` | int | |
| `ortho_version` | int \| None | Aerial only |
| `stitch_version` | int \| None | Ground only |
| `boundary_version` | int \| None | |
| `plot_id` | str (max 255, indexed) | Unique plot identifier (e.g. `"Plot_001"`) |
| `accession` | str \| None (max 255, indexed) | Genotype / accession name |
| `col` | str \| None (max 100) | Column/bed |
| `row` | str \| None (max 100) | Row/tier |
| `geometry_wkt` | str \| None | WGS84 polygon in WKT format |
| `traits` | dict[str, Any] (JSON) | Numeric trait values (`{"vf": 0.65, "height": 0.42, ...}`) |
| `extra_properties` | dict[str, Any] (JSON) | Non-numeric GeoJSON properties |
| `image_rel_path` | str \| None (max 1000) | Relative path to cropped plot image |
| `created_at` | str | |
| `updated_at` | str \| None | |

**Unique constraint:** `(trait_record_id, plot_id)`

---

### FileUpload

**File:** `backend/app/models/file_upload.py`

Tracks every batch of files uploaded through the Files tab.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | |
| `owner_id` | UUID (FK → User.id) | CASCADE delete |
| `data_type` | str (max 100) | See [Uploaded Data Types](#uploaded-data-types) |
| `experiment` | str (max 255) | |
| `location` | str (max 255) | |
| `population` | str (max 255) | |
| `date` | str (max 50) | |
| `platform` | str \| None (max 255) | |
| `sensor` | str \| None (max 255) | |
| `storage_path` | str (max 1000) | Relative path to uploaded files |
| `original_filename` | str \| None (max 500) | |
| `file_count` | int | Number of files in the batch |
| `file_size_bytes` | int \| None | |
| `status` | str (max 50) | `"pending"` \| `"processing"` \| `"completed"` \| `"failed"` |
| `notes` | str \| None (max 1000) | |
| `created_at` | str | |
| `updated_at` | str \| None | |

**Relationships:** `owner` (User)

---

### AppSetting

**File:** `backend/app/models/app_settings.py`

Key/value store for user-configured application settings.

| Column | Type | Notes |
|--------|------|-------|
| `key` | str (PK, max 255) | |
| `value` | str (max 4096) | |

| Key | Description | Default |
|-----|-------------|---------|
| `data_root` | Root directory for all data storage | `~/GEMI-Data` |

> **Do not** call `get_setting("data_root")` directly in route handlers. Always use `RunPaths.from_db()` — it reads `data_root` internally.

---

---

### ReferenceDataset

**File:** `backend/app/models/reference_data.py`

Represents one upload of hand-measured field data (e.g. "LAI Hand Measurements Apr 2024").

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | |
| `name` | str | Required. User-assigned during upload. |
| `experiment` | str | From upload metadata |
| `location` | str | From upload metadata |
| `population` | str | From upload metadata |
| `date` | str \| None | Metadata only — not used for plot matching |
| `column_mapping` | JSON | Maps file column → canonical trait name |
| `plot_count` | int | Row count after import |
| `trait_columns` | JSON list[str] | Trait column names present in this dataset |
| `created_at` | datetime | Auto |

**Relationships:** `plots` (list[ReferencePlot]), workspace links via `WorkspaceReferenceDataset`

---

### ReferencePlot

**File:** `backend/app/models/reference_data.py`

One row of a `ReferenceDataset` — one plot's hand-measured values.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | |
| `dataset_id` | UUID (FK → ReferenceDataset, CASCADE delete) | |
| `plot_id` | str \| None | From column mapping |
| `col` | str \| None | Optional |
| `row` | str \| None | Optional |
| `accession` | str \| None | Optional |
| `traits` | JSON dict[str, float] | `{ trait_name: value }` |

**Matching:** Reference plots are matched to `PlotRecord`s at query time by `(experiment, location, population, plot_id)` — never stored as a FK. `date` is **not** part of reference matching.

**Index on:** `(dataset_id, plot_id)`

---

### WorkspaceReferenceDataset

**File:** `backend/app/models/reference_data.py`

Join table associating uploaded reference datasets with workspaces.

| Column | Type | Notes |
|--------|------|-------|
| `workspace_id` | UUID (FK → Workspace) | Composite PK |
| `dataset_id` | UUID (FK → ReferenceDataset) | Composite PK |

A dataset can be associated with multiple workspaces. Deleting the dataset removes all workspace links.

---

## Filesystem Layout

All paths are derived from the `RunPaths` class in `backend/app/core/paths.py`. **Never construct these paths manually** in route handlers or processing functions.

```
{data_root}/
├── Raw/
│   └── {year}/{experiment}/{location}/{population}/{date}/{platform}/{sensor}/
│       ├── Images/          ← uploaded image files (JPEGs, PNGs)
│       └── Metadata/        ← platform logs (.bin/.log/.tlog), synced metadata CSVs
│
│   └── {year}/{experiment}/{location}/{population}/
│       ├── FieldDesign/     ← field design CSVs (plot layout)
│       └── gcp_locations.csv ← GCP lat/lon table (shared across dates)
│
├── Intermediate/
│   └── {workspace}/
│       ├── {year}/{location}/{population}/          ← shared across all experiments
│       │   ├── Plot-Boundary-WGS84.geojson
│       │   ├── Plot-Boundary-WGS84_v{N}.geojson
│       │   ├── Pop-Boundary-WGS84.geojson
│       │   └── field_design.csv
│       │
│       └── {year}/{experiment}/{location}/{population}/   ← experiment-scoped
│           ├── plot_borders.csv
│           ├── plot_borders_v{N}.csv
│           ├── stitch_mask.json
│           ├── gcp_locations.csv
│           └── {date}/{platform}/{sensor}/          ← run-level
│               ├── msgs_synced.csv
│               ├── drone_msgs.csv
│               ├── gcp_list.txt
│               ├── geo.txt
│               ├── temp/                            ← ODM working directory
│               └── plot_images/                     ← aerial: split plot PNGs
│
└── Processed/
    └── {workspace}/
        └── {year}/{experiment}/{location}/{population}/{date}/{platform}/{sensor}/
            ├── AgRowStitch_v{N}/        ← ground pipeline outputs
            │   ├── full_res_mosaic_temp_plot_{id}.png
            │   ├── georeferenced_plot_{id}_utm.tif
            │   ├── combined_mosaic_utm.tif
            │   ├── roboflow_predictions_{task}.csv
            │   └── Traits-WGS84.geojson
            │
            ├── {date}-RGB.tif           ← aerial orthomosaic (latest)
            ├── {date}-RGB-v{N}.tif      ← aerial orthomosaic (versioned)
            ├── {date}-DEM.tif           ← aerial DEM (latest)
            ├── {date}-DEM-v{N}.tif      ← aerial DEM (versioned)
            ├── {date}-RGB-Pyramid.tif   ← tiled pyramid for map viewer
            ├── cropped_images/          ← aerial: per-plot crop images (latest)
            ├── cropped_images_v{N}/     ← aerial: per-plot crop images (versioned)
            ├── roboflow_predictions_{task}.csv
            └── Traits-WGS84.geojson
```

### RunPaths property reference

| Property / Method | Resolves to | Scope |
|---|---|---|
| `paths.raw` | `Raw/{year}/{exp}/{loc}/{pop}/{date}/{plat}/{sen}/` | Run |
| `paths.raw_metadata` | `Raw/…/{sen}/Metadata/` | Run |
| `paths.field_design_dir` | `Raw/{year}/{exp}/{loc}/{pop}/FieldDesign/` | Population |
| `paths.gcp_locations_raw` | `Raw/{year}/{exp}/{loc}/{pop}/gcp_locations.csv` | Population |
| `paths.intermediate_shared_pop` | `Intermediate/{ws}/{year}/{loc}/{pop}/` | Shared (cross-exp) |
| `paths.plot_boundary_geojson` | `…/Plot-Boundary-WGS84.geojson` | Shared |
| `paths.pop_boundary_geojson` | `…/Pop-Boundary-WGS84.geojson` | Shared |
| `paths.field_design_intermediate` | `…/field_design.csv` | Shared |
| `paths.intermediate_year` | `Intermediate/{ws}/{year}/{exp}/{loc}/{pop}/` | Year + experiment |
| `paths.plot_borders` | `…/plot_borders.csv` | Ground, year |
| `paths.stitch_mask` | `…/stitch_mask.json` | Ground, year |
| `paths.gcp_locations_intermediate` | `…/gcp_locations.csv` | Year |
| `paths.gcp_locations()` | Raw path if exists, else Intermediate fallback | Aerial |
| `paths.intermediate_run` | `…/{date}/{plat}/{sen}/` | Run |
| `paths.msgs_synced` | `…/msgs_synced.csv` | Run |
| `paths.drone_msgs` | `…/drone_msgs.csv` | Run (aerial) |
| `paths.gcp_list` | `…/gcp_list.txt` | Run (aerial) |
| `paths.geo_txt` | `…/geo.txt` | Run (aerial) |
| `paths.odm_working_dir` | `…/temp/` | Run (aerial) |
| `paths.plot_images_dir` | `…/plot_images/` | Run (aerial) |
| `paths.processed_run` | `Processed/{ws}/{year}/{exp}/{loc}/{pop}/{date}/{plat}/{sen}/` | Run |
| `paths.agrowstitch_dir(n)` | `…/AgRowStitch_v{n}/` | Ground, versioned |
| `paths.aerial_rgb` | `…/{date}-RGB.tif` | Aerial (latest) |
| `paths.aerial_rgb_versioned(n)` | `…/{date}-RGB-v{n}.tif` | Aerial, versioned |
| `paths.aerial_dem` | `…/{date}-DEM.tif` | Aerial (latest) |
| `paths.aerial_dem_versioned(n)` | `…/{date}-DEM-v{n}.tif` | Aerial, versioned |
| `paths.aerial_rgb_pyramid` | `…/{date}-RGB-Pyramid.tif` | Aerial (latest) |
| `paths.cropped_images_dir` | `…/cropped_images/` | Aerial (latest) |
| `paths.cropped_images_versioned(n)` | `…/cropped_images_v{n}/` | Aerial, versioned |
| `paths.traits_geojson` | `…/Traits-WGS84.geojson` | Run |
| `paths.roboflow_predictions(task)` | `…/roboflow_predictions_{task}.csv` | Run |

### Path storage rules

- **Store:** `paths.rel(absolute_path)` — saves a POSIX string relative to `data_root`
- **Read back:** `paths.abs(relative_string)` — reconstructs the absolute path

Always store relative paths in `PipelineRun.outputs` so paths remain valid if the user changes their `data_root`.

---

## Uploaded Data Types

Defined in `frontend/src/config/dataTypes.ts`. Each type maps to an upload destination under `Raw/`.

| Data Type | Fields Required | Upload Destination |
|-----------|----------------|-------------------|
| `Image Data` | experiment, location, population, date, platform, sensor | `Raw/{year}/{exp}/{loc}/{pop}/{date}/{plat}/{sen}/Images/` |
| `Ardupilot Logs` | experiment, location, population, date, platform, sensor | `Raw/{year}/{exp}/{loc}/{pop}/{date}/{plat}/{sen}/Metadata/` |
| `Synced Metadata` | experiment, location, population, date, platform, sensor | `Raw/{year}/{exp}/{loc}/{pop}/{date}/{plat}/{sen}/Metadata/` |
| `Farm-ng Binary File` | experiment, location, population, date | `Raw/{year}/{exp}/{loc}/{pop}/{date}/Amiga/RGB/Images/` (fixed platform/sensor) |
| `Orthomosaic` | experiment, location, population, date, platform, sensor | `Raw/{year}/{exp}/{loc}/{pop}/{date}/{plat}/{sen}/Orthomosaic/` |
| `Weather Data` | experiment, location, population, date | `Raw/{year}/{exp}/{loc}/{pop}/{date}/WeatherData/` |
| `Field Design` | experiment, location, population, date | `Raw/{year}/{exp}/{loc}/{pop}/FieldDesign/` |

---

## How to Add a New Database Model

1. **Create the model file** in `backend/app/models/`:

```python
# backend/app/models/my_thing.py
from sqlmodel import Field, SQLModel
import uuid

class MyThing(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    name: str
    workspace_id: uuid.UUID = Field(foreign_key="workspace.id")
```

2. **Register it** in `backend/app/models/__init__.py` so `create_all` sees it:

```python
from .my_thing import MyThing  # noqa: F401
```

3. **Add CRUD helpers** in `backend/app/crud/my_thing.py`.

4. **Restart the backend** — the table is created automatically.

5. **Add API routes** in `backend/app/api/routes/`, register in `backend/app/api/main.py`, add to `hiddenimports` in `gemi-backend.spec`.

6. **Regenerate the frontend client:**
   ```bash
   ./scripts/generate-client.sh
   ```

7. **Update this document** — add the table to [SQLite Database](#sqlite-database) above.

---

## How to Add a New File Path

1. **Add a property or method** to `RunPaths` in `backend/app/core/paths.py`:

```python
@property
def my_new_file(self) -> Path:
    """Description — what this file contains and which step produces it."""
    return self.processed_run / "my_new_file.csv"
```

Use a method (not a property) when the path is versioned:

```python
def my_versioned_dir(self, version: int) -> Path:
    return self.processed_run / f"my_dir_v{version}"
```

2. **Use the path in your processing function:**

```python
paths.my_new_file.write_text(content)
return {"my_new_file": paths.rel(paths.my_new_file)}
```

3. **Update the directory layout diagram** in this document (the ASCII tree above) and the property reference table.
