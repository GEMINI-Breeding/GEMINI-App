# Reference Data & Master Table — Feature Spec

This document describes the design and implementation plan for two related features:
1. **Reference Data** — upload and visualize hand-measured field data alongside extracted traits
2. **Master Table** — a workspace-level merged view of all pipeline trait results per plot

**When to update this doc:** any time the scope, schema, or component structure changes during implementation.

---

## Table of Contents

1. [Terminology](#terminology)
2. [Reference Data](#reference-data)
   - [Database Schema](#reference-data-database-schema)
   - [How Reference Data Flows Through the App](#how-reference-data-flows-through-the-app)
   - [Upload Tab — New Data Type](#upload-tab--new-data-type)
   - [Column Mapping Step](#column-mapping-step)
   - [Workspace Association](#workspace-association)
   - [Plot Matching Logic](#plot-matching-logic)
   - [API Endpoints](#reference-data-api-endpoints)
   - [UI — Plot Viewers (Table, Query, Map)](#ui--plot-viewers-table-query-map)
   - [UI — Query Tab (Collapsed View)](#ui--query-tab-collapsed-view)
   - [UI — Map Tab (Color By)](#ui--map-tab-color-by)
   - [Warning / Error Notifications](#warning--error-notifications)
3. [Master Table](#master-table)
   - [Merge Logic](#merge-logic)
   - [Column Color Coding](#column-color-coding)
   - [API Endpoint](#master-table-api-endpoint)
   - [UI — Master Table Component](#ui--master-table-component)
   - [UI — Merged Plot Viewer](#ui--merged-plot-viewer)
4. [Implementation Task List](#implementation-task-list)
5. [Open Design Questions](#open-design-questions)

---

## Terminology

| Term | Meaning |
|------|---------|
| **Reference Data** | Hand-measured field data uploaded by the user. No plot boundaries — tied to plots by identity. |
| **ReferenceDataset** | A named upload (e.g. "LAI Hand Measurements Apr 2024"). One workspace can have many associated. |
| **ReferencePlot** | One row of a ReferenceDataset — one plot's reference measurements. |
| **Plot identity** | The tuple `(experiment, location, population, plot_id)` used to match across pipelines and reference data. `date` is metadata only. |
| **Master Table** | A workspace-level table where each row is a unique plot identity, with trait columns from all pipelines and reference datasets merged. |

---

## Reference Data

### How Reference Data Flows Through the App

Reference data follows the same two-phase pattern as other data types in the app:

**Phase 1 — Upload (Files tab):**
User uploads a CSV or Excel file as a new "Reference Data" data type. Metadata (name, experiment, location, population, date) and column mapping are collected during upload. The result is a `ReferenceDataset` + `ReferencePlot` rows stored in the database.

**Phase 2 — Workspace Association (Process tab):**
The user navigates to a workspace and selects which uploaded reference datasets to include. This is analogous to selecting an uploaded file when creating a new run — the dataset is already uploaded, the workspace just picks it up. A workspace can have multiple reference datasets; a reference dataset can be associated with multiple workspaces.

**Consumption (Analyze tab):**
The Analyze tab reads whichever reference datasets are associated with the current workspace. Reference traits appear as additional columns in the Master Table and as toggleable panels in all plot viewers. There is no separate reference data table in the Analyze tab.

---

### Reference Data Database Schema

**File:** `backend/app/models/reference_data.py` *(new)*

#### `ReferenceDataset`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK |
| `name` | str | Required. User-assigned during upload. |
| `experiment` | str | From upload metadata |
| `location` | str | From upload metadata |
| `population` | str | From upload metadata |
| `date` | str | Metadata only — not used for plot matching |
| `column_mapping` | JSON | Maps file column → canonical trait name |
| `plot_count` | int | Row count after import |
| `trait_columns` | JSON list | Trait column names in this dataset |
| `created_at` | datetime | Auto |

#### `ReferencePlot`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | PK |
| `dataset_id` | UUID | FK → ReferenceDataset, cascade delete |
| `plot_id` | str | From column mapping |
| `col` | str \| None | Optional |
| `row` | str \| None | Optional |
| `accession` | str \| None | Optional |
| `traits` | JSON | `{ trait_name: float }` |

#### `WorkspaceReferenceDataset` *(join table)*

| Column | Type | Notes |
|--------|------|-------|
| `workspace_id` | UUID | FK → Workspace |
| `dataset_id` | UUID | FK → ReferenceDataset |

**Composite PK:** `(workspace_id, dataset_id)`

**Index on `ReferenceDataset`:** none needed beyond PK — matching is by `(experiment, location, population, plot_id)` which are columns on `ReferencePlot` joined through `ReferenceDataset`.

**Index on `ReferencePlot`:** `(dataset_id, plot_id)` for fast per-dataset lookups.

---

### Upload Tab — New Data Type

A new entry is added to the data types list in `dataTypes.ts`:

| Field | Value |
|-------|-------|
| Type key | `reference_data` |
| Display name | `Reference Data` |
| Accepted extensions | `.csv`, `.xlsx`, `.xls` |
| Metadata fields | Name (required), Experiment, Location, Population, Date |
| Extra step | Column mapping (see below) |

**Upload flow (steps):**
1. User selects "Reference Data" from the data type dropdown in the Upload tab.
2. Metadata form: **Name** (required), Experiment, Location, Population, Date.
3. File picker: drag-drop or browse for `.csv`, `.xlsx`, or `.xls`.
4. **Column mapping step** appears after file selection (before submit) — see below.
5. Submit → backend parses file, inserts `ReferenceDataset` + `ReferencePlot` rows, returns match count (matched against all workspaces' `PlotRecord`s that share the same experiment/location/population).
6. Success toast shows: "Reference Data uploaded. Associate it with a workspace in the Process tab."

---

### Column Mapping Step

Displayed as a modal step after file selection, before final upload submit. Mirrors the `MsgsSyncedUploadDialog` two-step pattern.

- App reads file headers and displays a two-column mapping table: **File Column → Maps To**.
- "Maps To" options: `plot_id`, `col`, `row`, `accession`, `[trait name]` (free text, defaults to original column name), or `[ignore]`.
- **Required:** either `plot_id` OR both `col` + `row` must be mapped. Validation blocks submit if missing.
- All numeric columns not otherwise mapped are pre-assigned as traits using their original column name.
- A live preview of the first 4 rows is shown, reflecting the current mapping.
- The final `column_mapping` JSON is stored on `ReferenceDataset`.

---

### Workspace Association

In the **WorkspaceDetail page** (`/process/$workspaceId`), a **"Reference Data"** section is added below the pipeline list:

```
Pipelines
  [ Aerial Pipeline ]  [ Ground Pipeline ]  [ + New Pipeline ]

──────────────────────────
Reference Data
  LAI Measurements        Apr 2024   48 plots   [Remove]
  NDVI Hand Collected     Mar 2024   48 plots   [Remove]
  [ + Add Reference Data ]
──────────────────────────
```

- **"+ Add Reference Data"** opens a selector dialog listing all uploaded `ReferenceDataset`s, filterable by experiment/location/population. User picks one or more → they are linked via `WorkspaceReferenceDataset`.
- **"Remove"** unlinks the dataset from the workspace (does not delete the dataset).
- A warning icon appears on a dataset row if it has unmatched plots against this workspace's `PlotRecord`s.
- Clicking a dataset name shows its details (trait columns, match report) in a side panel.

---

### Plot Matching Logic

At query time, reference plots are matched to `PlotRecord`s in the workspace by:

```
experiment == ReferenceDataset.experiment
location   == ReferenceDataset.location
population == ReferenceDataset.population
plot_id    == ReferencePlot.plot_id      (OR col == col AND row == row)
```

`date` is **not** part of the match.

Match is evaluated at query time (not a stored FK), so it stays valid as new runs are added.

---

### Reference Data API Endpoints

**Upload & management** under `/api/v1/reference-data/`:

| Method | Path | Description |
|--------|------|-------------|
| POST | `/upload` | Multipart: file + metadata + column mapping. Returns dataset + match summary. |
| GET | `/` | List all uploaded ReferenceDatasets (not workspace-filtered). |
| GET | `/{dataset_id}` | Dataset metadata + trait columns. |
| DELETE | `/{dataset_id}` | Delete dataset + all ReferencePlots (removes all workspace links). |

**Workspace association** under `/api/v1/workspaces/{workspace_id}/reference-data/`:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List ReferenceDatasets associated with this workspace, with per-dataset match report. |
| POST | `/{dataset_id}` | Associate a dataset with this workspace. |
| DELETE | `/{dataset_id}` | Remove association (does not delete the dataset). |
| GET | `/match` | Given `?experiment=&location=&population=&plot_id=`, return all matched reference trait values for that plot across all associated datasets. Used by plot viewers. |

---

### UI — Plot Viewers (Table, Query, Map)

All three plot viewers (TraitsTable inline viewer, QueryTab PlotImageViewer, TraitMap PlotImagePanel) get:

- A **"Reference Data" toggle button** in the viewer toolbar.
- When on, a panel shows matched reference trait values (matched by `experiment + location + population + plot_id` against workspace-associated datasets).
- **Reference trait values are displayed in orange text** under a "REF" section header.
- If no reference data matches → toggle is disabled with tooltip: "No reference data matched for this plot."
- Multiple datasets that match the same plot are shown grouped by dataset name.

```
┌─────────────────────────────────────────┐
│  [ Plot Image ]     │  Traits           │
│                     │  vf_avg: 0.412    │
│                     │  height: 0.318    │
│                     │                   │
│                     │  ── REF ──        │
│                     │  LAI Measurements │
│                     │  lai: 3.21        │  ← orange
│                     │  biomass: 412     │  ← orange
└─────────────────────────────────────────┘
```

---

### UI — Query Tab (Collapsed View)

In the Query tab collapsed list (pinned and unpinned rows):

- An orange **"REF" chip** on any row where matched reference data exists.
- Clicking the chip expands an **inline sub-row** with reference trait key-value pairs in **orange text**.
- The eye-icon plot viewer auto-opens the reference panel when opened after clicking the chip.

```
[ Plot 1 ]  ACC001  col:1  row:3   vf_avg: 0.41   [REF]  [👁]  [📌]
  └── REF: LAI Measurements — lai: 3.21   biomass: 412      ← orange text
```

---

### UI — Map Tab (Color By)

In the **"Color By"** dropdown (`MetricSelector`):

- Reference trait columns appear at the bottom under a **"Reference Data"** divider.
- Reference trait names use **standard text color** — the divider label already identifies the group.
- An **ⓘ tooltip** next to the divider reads: "These traits come from uploaded Reference Data, not extracted by a pipeline."
- When selected, map polygons are colored by that trait. Plots with no match are rendered in neutral grey.

---

### Warning / Error Notifications

If any reference plots are unmatched after associating a dataset with a workspace:

**In WorkspaceDetail** (persistent per dataset, dismissible):
```
⚠  "LAI Measurements": 12 of 48 plots unmatched  [View]
```

**In Analyze tab header** (on tab open, dismissible):
```
⚠  "LAI Measurements": 12 of 48 reference plots could not be matched to any
   plot in this workspace. Verify Experiment, Location, Population, and Plot ID
   match your pipeline runs.  [View unmatched rows]  [Dismiss]
```

- "View unmatched rows" → modal listing unmatched ReferencePlot rows (plot_id / col / row).
- Green toast on fully matched association.

---

## Master Table

### Merge Logic

The master table produces one row per unique **plot identity** `(experiment, location, population, plot_id)` across all `PlotRecord`s in the workspace.

**When a plot appears in multiple runs of the same pipeline**, use the most recent run by `PipelineRun.date` or `created_at`. (Future: user-selectable per pipeline.)

**Reference data** is merged into the same row as additional trait columns — no separate rows for reference data. The Master Table is the single unified view of all data sources per plot.

**Column groups per row:**

| Group | Contents |
|---|---|
| **Identity** | `experiment`, `location`, `population`, `plot_id`, `col`, `row`, `accession` |
| **Pipelines** | Separate column of colored pipeline tags for pipelines that contributed |
| **Per-pipeline traits** | One group per pipeline. Headers: `PipelineName · trait`. Header color = pipeline color. |
| **Reference traits** | One group per dataset at far right. Headers: `DatasetName · trait`. Orange "REF" group label. |

---

### Column Color Coding

Trait column headers in the master table are **colored by their source**:

- **Pipeline trait columns**: header text color (or thin top border) matches the pipeline's assigned color in the app.
- **Reference trait columns**: standard header text color, grouped under an orange **"REF"** label.
- **Identity columns** (`plot_id`, `col`, `row`, etc.): unstyled.

This makes the source of every trait immediately visible without reading column prefixes.

---

### Master Table API Endpoint

`GET /api/v1/workspaces/{workspace_id}/master-table`

Response shape:
```json
{
  "pipelines": [
    { "pipeline_id": "uuid-1", "name": "Aerial_1", "type": "aerial", "color": "#3B82F6" },
    { "pipeline_id": "uuid-2", "name": "Ground_1", "type": "ground", "color": "#10B981" }
  ],
  "reference_datasets": [
    { "dataset_id": "uuid-3", "name": "LAI Measurements", "trait_columns": ["lai", "biomass"] }
  ],
  "columns": [
    { "key": "plot_id",              "group": "identity" },
    { "key": "col",                  "group": "identity" },
    { "key": "row",                  "group": "identity" },
    { "key": "accession",            "group": "identity" },
    { "key": "pipeline_ids",         "group": "pipelines" },
    { "key": "Aerial_1·vf_avg",      "group": "pipeline",   "pipeline_id": "uuid-1" },
    { "key": "Aerial_1·height_avg",  "group": "pipeline",   "pipeline_id": "uuid-1" },
    { "key": "Ground_1·height_avg",  "group": "pipeline",   "pipeline_id": "uuid-2" },
    { "key": "LAI Measurements·lai", "group": "reference",  "dataset_id": "uuid-3" },
    { "key": "LAI Measurements·biomass", "group": "reference", "dataset_id": "uuid-3" }
  ],
  "rows": [
    {
      "experiment": "EXP1",
      "location": "LOC1",
      "population": "POP1",
      "plot_id": "1",
      "col": "1",
      "row": "1",
      "accession": "ACC001",
      "pipeline_ids": ["uuid-1", "uuid-2"],
      "Aerial_1·vf_avg": 0.412,
      "Aerial_1·height_avg": 0.231,
      "Ground_1·height_avg": 0.318,
      "LAI Measurements·lai": 3.21,
      "LAI Measurements·biomass": 412.0
    }
  ]
}
```

---

### UI — Master Table Component

Location: **Analyze → Table tab**, top section with a **"Master Table"** sub-header. No separate reference data section exists in the Table tab — all data is in this table.

Features:
- Column filtering / search / sort (same as per-pipeline tables).
- **Pipelines column**: colored tags, one per contributing pipeline. Separate from trait columns.
- **Trait column headers**: colored by pipeline (text or top border).
- **Reference column group**: orange "REF" group label; standard header text.
- Column visibility toggle: show/hide entire pipeline groups or the reference group.
- CSV export (all columns, prefixed names).
- Eye icon per row → opens Merged Plot Viewer.

---

### UI — Merged Plot Viewer

Opened from the Master Table row eye icon. Shows all plot images for a given plot identity.

**Layout:**
- Grid of pipeline image cells — **max 3 per row**, wraps to new row for more pipelines.
- Each cell: pipeline name header in pipeline color + type badge, plot image, detection overlay toggle, per-pipeline trait values.
- **Reference data panel** at full width below all image cells. Reference trait values in **orange text**.

```
┌─────────────────────────────────────────────────────────────┐
│  Plot 1 — EXP1 / LOC1 / POP1                               │
├─────────────────┬─────────────────┬────────────────────────┤
│  🔵 Aerial_1    │  🟢 Ground_1    │  🟢 Ground_2           │
│  [ Image ]      │  [ Image ]      │  [ Image ]              │
│  vf_avg: 0.41  │  height: 0.31  │  height: 0.29           │
├─────────────────┴─────────────────┴────────────────────────┤
│  REF — LAI Measurements                                      │
│  lai: 3.21   biomass: 412                                   │  ← orange text
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Task List

### Phase 1 — Reference Data: Backend Models & Parsing

- [ ] **1.1** Create `backend/app/models/reference_data.py` with `ReferenceDataset`, `ReferencePlot`, and `WorkspaceReferenceDataset` SQLModel tables
- [ ] **1.2** Register models in `backend/app/core/db.py` so `create_all()` picks them up
- [ ] **1.3** Write CSV/Excel parser utility (`openpyxl` for xlsx; stdlib `csv` for csv); validate required column mappings
- [ ] **1.4** Write plot match validation: query `PlotRecord` by `(experiment, location, population)` across the workspace and identify unmatched reference rows
- [ ] **1.5** Confirm `openpyxl` present or add via `uv add openpyxl`

### Phase 2 — Reference Data: API Endpoints

- [ ] **2.1** Implement upload endpoint: `POST /api/v1/reference-data/upload` (parse file, insert rows, return match summary)
- [ ] **2.2** Implement management endpoints: list, get, delete `ReferenceDataset`
- [ ] **2.3** Implement workspace association endpoints: list, add, remove under `/workspaces/{id}/reference-data/`
- [ ] **2.4** Implement plot match endpoint: `GET /workspaces/{id}/reference-data/match?experiment=&location=&population=&plot_id=`

### Phase 3 — Reference Data: Upload Tab

- [ ] **3.1** Add `reference_data` entry to `dataTypes.ts` (name, accepted extensions, metadata fields)
- [ ] **3.2** Build column mapping step component (post-file-selection modal, mirrors `MsgsSyncedUploadDialog` pattern)
- [ ] **3.3** Wire upload flow to `POST /api/v1/reference-data/upload`; show success toast with "Associate in Process tab" hint

### Phase 4 — Reference Data: Workspace Association

- [ ] **4.1** Add "Reference Data" section to `WorkspaceDetail` page below pipelines
- [ ] **4.2** Build dataset selector dialog: lists uploaded `ReferenceDataset`s, filterable by experiment/location/population; multi-select
- [ ] **4.3** Wire Add/Remove to workspace association endpoints
- [ ] **4.4** Show warning icon + unmatched count on dataset rows; "View unmatched rows" modal

### Phase 5 — Reference Data: Plot Viewers

- [ ] **5.1** Add reference data toggle to TraitsTable inline plot viewer; fetch matched traits via match endpoint; display in orange under "REF" header
- [ ] **5.2** Add same toggle to QueryTab PlotImageViewer
- [ ] **5.3** Add same toggle to TraitMap PlotImagePanel
- [ ] **5.4** Add orange "REF" chip to Query tab collapsed row list; click expands inline sub-row with orange text

### Phase 6 — Reference Data: Map Tab Color By

- [ ] **6.1** Fetch workspace reference trait column names and merge into `MetricSelector` props
- [ ] **6.2** Add "Reference Data" divider in Color By dropdown with ⓘ tooltip; standard text color for trait names
- [ ] **6.3** Support coloring polygons by reference trait; grey out unmatched plots

### Phase 7 — Reference Data: Analyze Tab Warning

- [ ] **7.1** On Analyze tab open, check for any workspace-associated datasets with unmatched rows
- [ ] **7.2** Show dismissible warning bar with "View unmatched rows" modal

### Phase 8 — Master Table: Backend

- [ ] **8.1** Implement `GET /api/v1/workspaces/{workspace_id}/master-table`
- [ ] **8.2** Query `PlotRecord` grouped by `(experiment, location, population, plot_id)`; pivot trait dicts by pipeline; use most recent run per pipeline per plot
- [ ] **8.3** Merge matched reference traits into response rows; include `group` + `pipeline_id`/`dataset_id` per column descriptor
- [ ] **8.4** Include pipeline metadata (id, name, type, color) and reference dataset metadata in response

### Phase 9 — Master Table: Frontend

- [ ] **9.1** Build `MasterTable` component (React Table, same pattern as existing analyze tables)
- [ ] **9.2** Render Pipelines column with colored pipeline tags
- [ ] **9.3** Color trait column headers by pipeline color (text or top border)
- [ ] **9.4** Render reference column group with orange "REF" group label; standard header text
- [ ] **9.5** Column visibility toggle (pipeline groups + reference group)
- [ ] **9.6** CSV export with prefixed column names
- [ ] **9.7** Eye icon per row → open Merged Plot Viewer

### Phase 10 — Merged Plot Viewer

- [ ] **10.1** Build `MergedPlotViewer` component: grid, max 3 images per row, wraps
- [ ] **10.2** Per-cell: pipeline name + color + type badge, plot image, detection overlay toggle, per-pipeline traits
- [ ] **10.3** Full-width reference panel at bottom; orange text values
- [ ] **10.4** Wire to Master Table eye icon

---

## Open Design Questions

1. **Multiple runs per pipeline in master table**: plan is most-recent run per pipeline per plot. User-selectable run deferred to future custom layout feature.
2. **Reference dataset shared across workspaces**: the `WorkspaceReferenceDataset` join table supports this. Edge case: if a dataset is deleted, all workspace links are removed too.
3. **Pipeline color assignment**: confirm the color source (where pipeline colors are stored/assigned in the existing app) during Phase 8–9 implementation.
