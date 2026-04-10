# GEMINI Dashboard

## Overview

The Dashboard is the Home page of the GEMINI App. It gives users a **flexible, widget-based workspace** to visualize and summarize data already processed in the Analyze tab — without re-running pipelines.

Users build dashboards by dragging widgets from a left-side toolbox onto a 12-column grid canvas. Multiple named tabs allow organizing different views of the same data (e.g., "Canopy Cover Summary", "Temporal Growth", "Biomass vs Height").

---

## Architecture

### State Management

Dashboard state (tabs, widgets, configurations) is persisted to `localStorage` under the key `gemini-dashboard`. This means:

- Dashboards survive page refreshes
- Each user's browser has its own dashboard layout
- No backend changes required for layout persistence

State is managed via a lightweight `useDashboardStore()` hook (not Redux/Zustand) that wraps `localStorage` reads/writes with a React `useState` layer.

### Data Layer

The Dashboard **does not re-process** any data. It reads from the same `TraitRecord` + `PlotRecord` data already stored by the Analyze pipeline.

**Key API calls (reused from `features/analyze/api.ts`):**

| Call | Usage |
|------|-------|
| `analyzeApi.listTraitRecords()` | Populate data source selectors |
| `analyzeApi.getTraitRecordGeojson(id)` | Fetch plot features + metrics per record |
| `analyzeApi.getTraitRecordImagePlotIds(id)` | Know which plots have images |

All data fetching uses **TanStack React Query** with the same query keys as the Analyze tab, so the dashboard benefits from shared caching — selecting the same trait record in both Analyze and Dashboard incurs only one network request.

### File Structure

```
frontend/src/features/dashboard/
├── types.ts                         # All TypeScript types
├── store.ts                         # localStorage persistence hook
├── hooks/
│   ├── useDrag.ts                  # Native HTML5 drag-and-drop state
│   ├── useMultiSourceData.ts       # Multi-pipeline / multi-record data fetching
│   ├── useReferenceData.ts         # Reference dataset fetching for widgets
│   └── useTraitData.ts             # React Query wrappers for trait data
├── widgets/
│   ├── KpiWidget.tsx               # Single-stat highlight card
│   ├── ChartWidget.tsx             # Bar / Line / Area / Scatter / Histogram
│   ├── TableWidget.tsx             # Configurable trait table
│   └── PlotViewerWidget.tsx        # Pinned plot image viewer
└── components/
    ├── DashboardBuilder.tsx         # Top-level layout (sidebar + canvas)
    ├── DashboardCanvas.tsx          # Drop zone + 12-col grid renderer
    ├── DragGhost.tsx                # Custom drag preview element
    ├── WidgetCard.tsx               # Widget frame (header, resize, delete)
    ├── WidgetConfigDialog.tsx       # Per-widget settings dialog
    └── WidgetToolbox.tsx            # Left sidebar with draggable templates
```

---

## Widget Types

### 1. KPI Widget (`type: 'kpi'`)

Displays a single aggregated metric as a prominent number with trend direction.

**Configuration:**
- **Data source**: Select a TraitRecord (pipeline run extraction)
- **Metric**: Any numeric trait column (e.g., `vf`, `height_cm`, `lai`)
- **Aggregation**: `avg`, `min`, `max`, or `count`
- **Compare to**: Optional second TraitRecord to compute `+/- %` change

**Examples:**
- Average Vegetation Fraction: `0.68 (+4.2%)`
- Total Plots Scanned: `1,248`
- Max Canopy Height: `182 cm`

**Grid span**: Small (1/4 width) or Medium (1/2 width)

---

### 2. Chart Widget (`type: 'chart'`)

A unified chart component supporting multiple modes:

#### Mode A — Spatial Bar Chart
Compares a metric across a categorical dimension from a **single** TraitRecord.

- **X-axis**: Categorical field (`accession`, `col`, `row`, `plot_id`, `treatment`)
- **Y-axis**: Numeric trait column
- **Chart types**: Bar (grouped or stacked), Scatter (per-plot dots)
- **Use case**: "Average canopy cover by accession across all plots in run v3"

#### Mode B — Temporal Line / Area Chart
Shows trait evolution over time using **multiple** TraitRecords from the same pipeline.

- **Data sources**: User selects a pipeline; all extraction versions from that pipeline are available
- **X-axis**: `date` field from TraitRecord metadata
- **Y-axis**: Average metric value across all plots per date
- **Group-by**: Optional field (e.g., `accession`) → renders one line per group
- **Chart types**: Line, Area
- **Use case**: "Weekly canopy cover growth — Control vs Drought treatment"

#### Mode C — Correlation Scatter
Plots one trait against another to find relationships.

- **X-axis**: Numeric metric (e.g., `height_cm`)
- **Y-axis**: Another numeric metric (e.g., `lai`)
- **Color-by**: Optional categorical field
- **Data source**: Single TraitRecord
- **Use case**: "LAI vs height — is taller always leafier?"

#### Mode D — Histogram
Distribution of a single metric.

- Reuses `buildHistogram()` logic from `TraitHistogram.tsx`
- Optional filter by accession
- **Use case**: "Distribution of vegetation fraction across all plots"

**Grid span**: Medium (1/2) or Large (2/3) or Full (12 cols)

---

### 3. Table Widget (`type: 'table'`)

A configurable sortable data table of plot traits.

**Configuration:**
- **Data source**: Select TraitRecord
- **Columns**: Multi-select from available trait columns + metadata fields
- **Filter by accession**: Optional
- **Max rows**: Optional limit (default 100)

Features:
- Sortable columns (click header)
- Exports to CSV
- Compact row height to show more data

**Grid span**: Full width recommended

---

### 4. Plot Viewer Widget (`type: 'plot-viewer'`)

Shows cropped plot images with their extracted trait values side-by-side.

**Configuration:**
- **Data source**: Select TraitRecord
- Search plots by ID, accession, col/row
- Click to pin plots into the comparison view
- Shows trait values below each image

Reuses the plot image fetching from `analyzeApi` and the same overlay logic as the Query tab.

**Grid span**: Full width recommended

---

## Dashboard Layout

### Grid System

The canvas uses a **12-column Tailwind grid** (`grid-cols-12 gap-4`). Each widget occupies a fixed column span:

| Span | Tailwind Class | Use case |
|------|---------------|----------|
| Small (`sm`) | `col-span-12 md:col-span-6 lg:col-span-3` | KPI cards |
| Medium (`md`) | `col-span-12 md:col-span-6 lg:col-span-6` | Small charts |
| Large (`lg`) | `col-span-12 lg:col-span-8` | Main charts |
| Full (`full`) | `col-span-12` | Tables, wide charts |

Users can change a widget's span via its settings dialog.

### Drag & Drop

Uses native HTML5 drag-and-drop:
1. User drags a template from the toolbox sidebar
2. `onDragStart` stores the `templateId` in `dataTransfer`
3. `onDrop` on the canvas creates a new widget instance with default config
4. Widget config dialog opens automatically on first drop (so user can set data source)

---

## Tabs

Each dashboard tab has:
- `id`: Unique string
- `name`: Display name (editable via double-click or rename dialog)
- `widgets`: Array of widget instances

**Tab operations:**
- Add new tab (+ button)
- Rename (double-click tab label)
- Delete (× button, with confirmation if widgets present)
- Reorder (drag tabs — future enhancement)

---

## Data Sync

The Dashboard reads data already in the database. There is **no re-processing**.

To pick up new pipeline extractions:
- React Query automatically refetches `listTraitRecords` every 30 seconds (stale time)
- Users can also click the **Refresh** button (↺ icon in the Analyze section header) to force a refetch
- This calls `refetch()` on the runs query and spins the icon while `isFetching` is true

The geojson for each TraitRecord is cached for 5 minutes by React Query. Large datasets (>5,000 plots) may take a moment to load on first access.

---

## Planned Enhancements

### Backend Aggregation Endpoint (Performance)

For large datasets, client-side aggregation can be slow. A future `/api/v1/analyze/trait-records/{id}/aggregate` endpoint would:

```json
GET /api/v1/analyze/trait-records/{id}/aggregate
  ?group_by=accession
  &metrics=vf,height_cm,lai
  &agg=avg,min,max

Response: {
  "groups": [
    { "accession": "GEM-01", "vf_avg": 0.72, "height_cm_avg": 145.3 },
    ...
  ]
}
```

This would let KPI and Bar Chart widgets load instantly without fetching full GeoJSON.

### SQLite Indexing

The `plotrecord` table's `traits` column is a JSON blob. For faster filtering and aggregation, add:
- Index on `plotrecord.trait_record_id` (already likely present via FK)
- Index on `plotrecord.accession`
- Consider a generated column for frequently-queried trait keys if SQLite version supports it

### Dashboard Export

- Export dashboard to PNG (html2canvas)
- Export tab as a PDF report
- Share dashboard config (JSON export/import)

### Additional Widget Ideas (Databricks-inspired)

| Widget | Description |
|--------|-------------|
| **Heatmap** | Grid of col × row colored by metric — visualize spatial patterns across the field |
| **Correlation Matrix** | Pairwise correlations between all numeric traits |
| **Box Plot** | Trait distribution per accession with quartiles |
| **Trend KPI** | Sparkline mini-chart inside a KPI card |
| **Map Thumbnail** | Miniature trait map (deck.gl) embedded in dashboard |
| **Detection Summary** | Donut chart of detection class counts from inference |
| **Pipeline Status** | Live status of currently running pipelines (from ProcessContext) |
| **Reference vs Measured** | Side-by-side comparison of extracted traits vs reference data |

---

## Component Reuse

The Dashboard deliberately reuses existing Analyze infrastructure:

| Dashboard need | Reused from |
|---------------|-------------|
| Fetch trait records | `analyzeApi.listTraitRecords()` |
| Fetch plot data | `analyzeApi.getTraitRecordGeojson()` |
| Metric selector dropdown | `MetricSelector` component |
| Histogram logic | `buildHistogram()` from `TraitHistogram.tsx` |
| Column alias handling | `lookupProperty()`, `deduplicateKeys()` from `traitAliases.ts` |
| Fullscreen expand | `useExpandable()`, `FullscreenModal` from `ExpandableSection.tsx` |
| Chart rendering | Recharts (already installed, used in `TraitHistogram`) |
| UI components | All shadcn/ui components |
| Authenticated image loading | `plotImageUrl()` + `authHeaders()` from `PlotImage.tsx` |
