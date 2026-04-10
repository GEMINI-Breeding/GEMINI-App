/**
 * WidgetConfigDialog — per-widget settings dialog.
 *
 * Renders different configuration sections based on widget type.
 * Adapts fields for KPI, Chart (spatial/temporal/correlation), Table, and Plot Viewer.
 * Each form includes a FiltersSection for row-level filtering by categorical values.
 */

import { useState, useMemo } from "react"
import { Plus, X, ChevronUp, SlidersHorizontal } from "lucide-react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { useTraitRecords, useTraitRecordGeojson, useMultiTraitGeojson } from "../hooks/useTraitData"
import { useReferenceDatasets, useReferencePlots } from "../hooks/useReferenceData"
import type { DataSource } from "../types"
import { deduplicateKeys } from "@/features/analyze/utils/traitAliases"
import type {
  DashboardWidget, KpiConfig, ChartConfig, TableConfig, PlotViewerConfig,
  WidgetSpan, ChartMode, ChartType,
} from "../types"

const SPAN_OPTIONS: { value: WidgetSpan; label: string }[] = [
  { value: "sm", label: "Small (1/4)" },
  { value: "md", label: "Medium (1/2)" },
  { value: "lg", label: "Large (2/3)" },
  { value: "full", label: "Full width" },
]

// ── Shared selectors ──────────────────────────────────────────────────────────

function RecordSelector({
  value, onChange, label = "Data Source",
}: {
  value: string | null
  onChange: (id: string | null) => void
  label?: string
}) {
  const { data: records } = useTraitRecords()

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Select value={value || "__none__"} onValueChange={(v) => onChange(v === "__none__" ? null : v)}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Select a pipeline run…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">— None —</SelectItem>
          {(records ?? []).filter((r) => r.id).map((r) => (
            <SelectItem key={r.id} value={r.id}>
              {r.pipeline_name} · {r.date} · v{r.version}
              {r.ortho_name ? ` (${r.ortho_name})` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/** Multi-select for picking several trait records as sources. */
function MultiRecordSelector({
  values, onChange, label = "Data Sources",
}: {
  values: string[]
  onChange: (ids: string[]) => void
  label?: string
}) {
  const { data: records } = useTraitRecords()
  const [addKey, setAddKey] = useState(0)

  const available = (records ?? []).filter((r) => r.id && !values.includes(r.id))

  function remove(id: string) { onChange(values.filter((v) => v !== id)) }
  function add(id: string) { onChange([...values, id]); setAddKey((k) => k + 1) }

  const selectedRecords = values.map((id) => (records ?? []).find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r)

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {selectedRecords.length > 0 && (
        <div className="space-y-1">
          {selectedRecords.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-1 rounded border px-2 py-1 text-xs bg-muted/40">
              <span className="truncate">{r.pipeline_name} · {r.date} · v{r.version}{r.ortho_name ? ` (${r.ortho_name})` : ""}</span>
              <button onClick={() => remove(r.id)} className="flex-shrink-0 text-muted-foreground hover:text-destructive">
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      {available.length > 0 && (
        <Select key={addKey} onValueChange={add}>
          <SelectTrigger className="h-7 text-xs border-dashed">
            <span className="flex items-center gap-1 text-muted-foreground">
              <Plus className="w-3 h-3" /> Add source…
            </span>
          </SelectTrigger>
          <SelectContent>
            {available.filter((r) => r.id).map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.pipeline_name} · {r.date} · v{r.version}{r.ortho_name ? ` (${r.ortho_name})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}

const AGG_OPTIONS = [
  { value: "avg", label: "Average" },
  { value: "min", label: "Minimum" },
  { value: "max", label: "Maximum" },
  { value: "sum", label: "Sum" },
  { value: "median", label: "Median" },
] as const

/** Multi-select for picking several metric columns as Y-axes, with per-metric aggregation. */
function MultiMetricSelector({
  recordId, fallbackRecordIds, values, aggregations, onChange, onAggChange, label = "Y-Axis Metrics",
}: {
  recordId: string | null
  fallbackRecordIds?: string[]
  values: string[]
  aggregations: Record<string, string>
  onChange: (metrics: string[]) => void
  onAggChange: (metric: string, agg: string) => void
  label?: string
}) {
  const { data: primaryData, isLoading, isError } = useTraitRecordGeojson(recordId)
  // If the primary record 404s, fall back to the first successful record in the pipeline
  const { firstValid } = useMultiTraitGeojson(isError && fallbackRecordIds?.length ? fallbackRecordIds : [])
  const geoData = primaryData ?? firstValid
  const cols = geoData?.metric_columns ?? []
  const [addKey, setAddKey] = useState(0)

  const available = cols.filter((c) => c && !values.includes(c))

  function remove(m: string) { onChange(values.filter((v) => v !== m)) }
  function add(m: string) { onChange([...values, m]); setAddKey((k) => k + 1) }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {isLoading && !geoData && <p className="text-xs text-muted-foreground">Loading metrics…</p>}
      {isError && !geoData && <p className="text-xs text-destructive">Could not load metrics — re-run extraction</p>}
      {values.length > 0 && (
        <div className="space-y-1">
          {values.map((m, i) => (
            <div key={m} className="flex items-center gap-1.5">
              {/* Axis indicator */}
              <span className={`text-[9px] font-bold w-3 flex-shrink-0 ${i === 0 ? "text-primary" : "text-muted-foreground"}`}>
                {values.length > 1 ? (i === 0 ? "L" : "R") : ""}
              </span>
              {/* Metric name */}
              <span className="text-xs flex-1 truncate">{m.replace(/_/g, " ")}</span>
              {/* Aggregation picker */}
              <Select
                value={aggregations[m] ?? "avg"}
                onValueChange={(v) => onAggChange(m, v)}
              >
                <SelectTrigger className="h-6 w-24 text-[11px] px-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AGG_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button onClick={() => remove(m)} className="text-muted-foreground hover:text-destructive flex-shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      {available.length > 0 && (
        <Select key={addKey} onValueChange={add}>
          <SelectTrigger className="h-7 text-xs border-dashed">
            <span className="flex items-center gap-1 text-muted-foreground">
              <Plus className="w-3 h-3" /> Add metric…
            </span>
          </SelectTrigger>
          <SelectContent>
            {available.map((c) => (
              <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {values.length > 1 && (
        <p className="text-[10px] text-muted-foreground">
          <span className="font-medium text-primary">L</span> = left axis · <span className="font-medium">R</span> = right axis (when dual-axis is on)
        </p>
      )}
    </div>
  )
}

function MetricSelect({
  recordId, value, onChange, label = "Metric",
}: {
  recordId: string | null
  value: string | null
  onChange: (v: string) => void
  label?: string
}) {
  const { data: geoData, isLoading, isError } = useTraitRecordGeojson(recordId)
  const cols = geoData?.metric_columns ?? []

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {isLoading && <p className="text-xs text-muted-foreground">Loading metrics…</p>}
      {isError && <p className="text-xs text-destructive">Could not load metrics — re-run extraction</p>}
      {!isLoading && !isError && (
        <Select value={value || "__none__"} onValueChange={(v) => onChange(v === "__none__" ? "" : v)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Select metric…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">— None —</SelectItem>
            {cols.filter((c) => c).map((c) => (
              <SelectItem key={c} value={c}>
                {c.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}

function FieldSelect({
  recordId, value, onChange, label, includeMetrics = false,
}: {
  recordId: string | null
  value: string | null
  onChange: (v: string) => void
  label: string
  includeMetrics?: boolean
}) {
  const { data: geoData, isLoading, isError } = useTraitRecordGeojson(recordId)

  const fields = useMemo(() => {
    if (!geoData) return []
    const allKeys = deduplicateKeys(
      geoData.geojson.features.flatMap((feat) => Object.keys(feat.properties ?? {}))
    )
    if (includeMetrics) return allKeys
    return allKeys.filter((col) => !geoData.metric_columns.includes(col))
  }, [geoData, includeMetrics])

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {isLoading && <p className="text-xs text-muted-foreground">Loading fields…</p>}
      {isError && <p className="text-xs text-destructive">Could not load fields — re-run extraction</p>}
      {!isLoading && !isError && (
      <Select value={value || "__none__"} onValueChange={(v) => onChange(v === "__none__" ? "" : v)}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Select field…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">— None —</SelectItem>
          {fields.filter((f) => f).map((field) => (
            <SelectItem key={field} value={field}>
              {field.replace(/_/g, " ")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      )}
    </div>
  )
}

function PipelineSelect({
  value, onChange,
}: {
  value: string | null
  onChange: (pipelineId: string, records: string[]) => void
}) {
  const { data: records } = useTraitRecords()

  const pipelines = useMemo(() => {
    if (!records) return []
    const map = new Map<string, { id: string; name: string; records: string[] }>()
    records.forEach((r) => {
      if (!map.has(r.pipeline_id)) {
        map.set(r.pipeline_id, { id: r.pipeline_id, name: r.pipeline_name, records: [] })
      }
      map.get(r.pipeline_id)!.records.push(r.id)
    })
    return [...map.values()]
  }, [records])

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Pipeline (temporal series)</Label>
      <Select
        value={value || "__none__"}
        onValueChange={(v) => {
          const p = pipelines.find((p) => p.id === v)
          if (p) onChange(p.id, p.records)
        }}
      >
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Select pipeline…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">— None —</SelectItem>
          {pipelines.filter((p) => p.id).map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name} ({p.records.length} extractions)
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

// ── Filters section ───────────────────────────────────────────────────────────

/**
 * Lets users narrow a widget's data by categorical values (accession, col, row, etc.).
 *
 * - Derives available categorical fields from the selected record's GeoJSON
 * - "Add filter" dropdown to add a field
 * - Each active filter shows value pills — click to toggle inclusion
 * - Empty selection = no filter for that field (show all)
 */
function FiltersSection({
  recordId,
  filters,
  onChange,
}: {
  recordId: string | null
  filters: Record<string, string[]>
  onChange: (f: Record<string, string[]>) => void
}) {
  const { data: geoData } = useTraitRecordGeojson(recordId)
  // Key trick: increment to force-reset the "Add filter" Select after selection
  const [selectKey, setSelectKey] = useState(0)

  const { catFields, valuesByField } = useMemo(() => {
    if (!geoData) return { catFields: [] as string[], valuesByField: {} as Record<string, string[]> }
    const metrics = new Set(geoData.metric_columns)
    const allKeys = deduplicateKeys(
      geoData.geojson.features.flatMap((f) => Object.keys(f.properties ?? {}))
    )
    const vbf: Record<string, string[]> = {}
    for (const k of allKeys) {
      if (metrics.has(k)) continue
      const unique = [
        ...new Set(
          geoData.geojson.features
            .map((f) => String(f.properties?.[k] ?? ""))
            .filter(Boolean)
        ),
      ].sort((a, b) => {
        const na = Number(a), nb = Number(b)
        return isNaN(na) || isNaN(nb) ? a.localeCompare(b) : na - nb
      })
      // Identity fields (plot_id, accession, col, row, etc.) allow up to 2000 values;
      // all other categorical fields are capped at 200 to keep the UI manageable.
      const IDENTITY_FIELDS = new Set(["plot_id", "plot", "accession", "col", "row", "column"])
      const limit = IDENTITY_FIELDS.has(k) ? 2000 : 200
      if (unique.length > 0 && unique.length <= limit) vbf[k] = unique
    }
    return { catFields: Object.keys(vbf), valuesByField: vbf }
  }, [geoData])

  if (!recordId || catFields.length === 0) return null

  const activeFields = Object.keys(filters).filter((f) => catFields.includes(f))
  const availableToAdd = catFields.filter((f) => !Object.keys(filters).includes(f))

  function addFilter(field: string) {
    onChange({ ...filters, [field]: [] })
    setSelectKey((k) => k + 1)
  }

  function removeFilter(field: string) {
    const next = { ...filters }
    delete next[field]
    onChange(next)
  }

  function toggleValue(field: string, value: string) {
    const current = filters[field] ?? []
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value]
    onChange({ ...filters, [field]: next })
  }

  const totalActive = activeFields.reduce((n, f) => n + (filters[f]?.length ?? 0), 0)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Filters{totalActive > 0 && <span className="ml-1 text-primary normal-case">({totalActive} active)</span>}
        </Label>
        {availableToAdd.length > 0 && (
          <Select key={selectKey} onValueChange={addFilter}>
            <SelectTrigger className="h-6 w-auto border-dashed px-2 gap-1 text-[11px]">
              <Plus className="w-3 h-3" />
              <span>Add</span>
            </SelectTrigger>
            <SelectContent>
              {availableToAdd.map((f) => (
                <SelectItem key={f} value={f}>
                  {f.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {activeFields.length === 0 ? (
        <p className="text-[10px] text-muted-foreground">No filters — all rows shown.</p>
      ) : (
        <div className="space-y-2">
          {activeFields.map((field) => {
            const vals = valuesByField[field] ?? []
            const selected = filters[field] ?? []
            return (
              <div key={field} className="rounded-md bg-muted/50 border p-2 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium">{field.replace(/_/g, " ")}</span>
                  <div className="flex items-center gap-2">
                    {selected.length > 0 && (
                      <button
                        onClick={() => onChange({ ...filters, [field]: [] })}
                        className="text-[10px] text-muted-foreground hover:text-foreground"
                      >
                        Clear
                      </button>
                    )}
                    <button
                      onClick={() => removeFilter(field)}
                      className="text-muted-foreground hover:text-destructive"
                      title="Remove filter"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto pr-0.5">
                  {vals.map((v) => {
                    const isSelected = selected.includes(v)
                    const noneSelected = selected.length === 0
                    return (
                      <button
                        key={v}
                        onClick={() => toggleValue(field, v)}
                        className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
                          isSelected
                            ? "bg-primary text-primary-foreground border-primary"
                            : noneSelected
                            ? "bg-background text-muted-foreground border-border hover:border-primary/60 hover:text-foreground"
                            : "bg-background text-muted-foreground/40 border-border/40 line-through hover:no-underline hover:opacity-70"
                        }`}
                      >
                        {v}
                      </button>
                    )
                  })}
                </div>

                <p className="text-[10px] text-muted-foreground">
                  {selected.length === 0
                    ? "All values included — click to restrict"
                    : `${selected.length} / ${vals.length} selected`}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Per-type config forms ─────────────────────────────────────────────────────

function KpiForm({ config, onChange }: { config: KpiConfig; onChange: (c: KpiConfig) => void }) {
  return (
    <div className="space-y-3">
      <RecordSelector value={config.traitRecordId} onChange={(id) => onChange({ ...config, traitRecordId: id })} />
      <MetricSelect recordId={config.traitRecordId} value={config.metric} onChange={(v) => onChange({ ...config, metric: v || null })} />
      <div className="space-y-1.5">
        <Label className="text-xs">Aggregation</Label>
        <Select
          value={config.aggregation}
          onValueChange={(v) => onChange({ ...config, aggregation: v as KpiConfig["aggregation"] })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="avg">Average</SelectItem>
            <SelectItem value="min">Minimum</SelectItem>
            <SelectItem value="max">Maximum</SelectItem>
            <SelectItem value="count">Count</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <RecordSelector
        value={config.compareRecordId}
        onChange={(id) => onChange({ ...config, compareRecordId: id })}
        label="Compare To (optional — for % change)"
      />
      <hr />
      <FiltersSection
        recordId={config.traitRecordId}
        filters={config.filters ?? {}}
        onChange={(f) => onChange({ ...config, filters: f })}
      />
    </div>
  )
}

// ── Multi-source components ───────────────────────────────────────────────────

const AGG_OPTS: { value: string; label: string }[] = [
  { value: "avg", label: "Avg" },
  { value: "min", label: "Min" },
  { value: "max", label: "Max" },
  { value: "sum", label: "Sum" },
  { value: "median", label: "Median" },
]

function ReferenceDatasetSelector({
  value, onChange,
}: {
  value: string | null
  onChange: (id: string) => void
}) {
  const { data: datasets = [], isLoading, isError, error } = useReferenceDatasets()
  return (
    <div className="space-y-1.5">
      {isLoading && <p className="text-xs text-muted-foreground">Loading datasets…</p>}
      {isError && (
        <p className="text-xs text-destructive">
          Could not load datasets — {(error as any)?.message ?? "check server connection"}
        </p>
      )}
      {!isLoading && !isError && datasets.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No reference datasets found. Upload one in the Files tab first.
        </p>
      )}
      {!isLoading && !isError && datasets.length > 0 && (
        <Select value={value || "__none__"} onValueChange={(v) => v !== "__none__" && onChange(v)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Select dataset…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">— None —</SelectItem>
            {datasets.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name}{d.date ? ` (${d.date})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}

function ReferenceMetricSelect({
  datasetId, value, onChange,
}: {
  datasetId: string | null
  value: string | null
  onChange: (v: string) => void
}) {
  const { data: datasets = [] } = useReferenceDatasets()
  const cols = datasets.find((d) => d.id === datasetId)?.trait_columns ?? []
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Metric</Label>
      <Select value={value || "__none__"} onValueChange={(v) => v !== "__none__" && onChange(v)}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Select metric…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">— None —</SelectItem>
          {cols.map((c) => (
            <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

type AddSourceStep = "type" | "pipeline-run" | "pipeline-avg" | "reference"

function AddSourcePanel({
  onAdd,
  onCancel,
}: {
  onAdd: (srcs: DataSource[]) => void
  onCancel: () => void
}) {
  const [step, setStep] = useState<AddSourceStep>("type")
  // pipeline-run state
  const [prRecordId, setPrRecordId] = useState<string | null>(null)
  const [prMetrics, setPrMetrics] = useState<string[]>([])
  const [prAggs, setPrAggs] = useState<Record<string, string>>({})
  const [prLabel, setPrLabel] = useState("")
  // pipeline-avg state
  const [paId, setPaId] = useState<string | null>(null)
  const [paPipelineRecordIds, setPaPipelineRecordIds] = useState<string[]>([])
  const [paMetrics, setPaMetrics] = useState<string[]>([])
  const [paAggs, setPaAggs] = useState<Record<string, string>>({})
  const [paLabel, setPaLabel] = useState("")
  // reference state
  const [refDatasetId, setRefDatasetId] = useState<string | null>(null)
  const [refMetric, setRefMetric] = useState<string | null>(null)
  const [refAgg, setRefAgg] = useState("avg")
  const [refLabel, setRefLabel] = useState("")

  const newId = () => crypto.randomUUID()

  if (step === "type") {
    return (
      <div className="rounded-md border border-dashed p-3 space-y-2 bg-muted/30">
        <p className="text-xs font-medium">Add a data source</p>
        <div className="grid grid-cols-1 gap-1.5">
          {([
            { key: "pipeline-run", label: "Pipeline Run", desc: "Single extraction date" },
            { key: "pipeline-avg", label: "Pipeline Average", desc: "All dates for a pipeline" },
            { key: "reference",    label: "Reference Dataset", desc: "Uploaded field design / reference traits" },
          ] as const).map((opt) => (
            <button
              key={opt.key}
              onClick={() => setStep(opt.key)}
              className="text-left rounded px-2.5 py-2 text-xs border hover:bg-muted transition-colors"
            >
              <span className="font-medium">{opt.label}</span>
              <span className="text-muted-foreground ml-1.5">{opt.desc}</span>
            </button>
          ))}
        </div>
        <button onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
      </div>
    )
  }

  if (step === "pipeline-run") {
    const canAdd = !!prRecordId && prMetrics.length > 0
    return (
      <div className="rounded-md border border-dashed p-3 space-y-2 bg-muted/30">
        <p className="text-xs font-medium">Pipeline Run</p>
        <RecordSelector value={prRecordId} onChange={setPrRecordId} />
        <MultiMetricSelector
          recordId={prRecordId}
          values={prMetrics}
          aggregations={prAggs}
          onChange={setPrMetrics}
          onAggChange={(m, a) => setPrAggs((prev) => ({ ...prev, [m]: a }))}
          label="Metrics (one source per metric)"
        />
        <div className="space-y-1.5">
          <Label className="text-xs">Label prefix (optional)</Label>
          <input
            className="w-full h-7 rounded border bg-background px-2 text-xs"
            placeholder="e.g. Apr Run"
            value={prLabel}
            onChange={(e) => setPrLabel(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Button size="sm" className="h-7 text-xs" disabled={!canAdd} onClick={() => {
            onAdd(prMetrics.map((m) => ({ id: newId(), type: "pipeline-run" as const, recordId: prRecordId!, metric: m, aggregation: (prAggs[m] ?? "avg") as any, label: prLabel ? `${prLabel} · ${m}` : undefined })))
          }}>Add {prMetrics.length > 1 ? `${prMetrics.length} sources` : "source"}</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setStep("type")}>Back</Button>
        </div>
      </div>
    )
  }

  if (step === "pipeline-avg") {
    const canAdd = !!paId && paMetrics.length > 0
    return (
      <div className="rounded-md border border-dashed p-3 space-y-2 bg-muted/30">
        <p className="text-xs font-medium">Pipeline Average (all runs)</p>
        <PipelineSelect
          value={paId}
          onChange={(id, records) => { setPaId(id); setPaPipelineRecordIds(records) }}
        />
        <MultiMetricSelector
          recordId={paPipelineRecordIds[0] ?? null}
          fallbackRecordIds={paPipelineRecordIds}
          values={paMetrics}
          aggregations={paAggs}
          onChange={setPaMetrics}
          onAggChange={(m, a) => setPaAggs((prev) => ({ ...prev, [m]: a }))}
          label="Metrics (one source per metric)"
        />
        <div className="space-y-1.5">
          <Label className="text-xs">Label prefix (optional)</Label>
          <input
            className="w-full h-7 rounded border bg-background px-2 text-xs"
            placeholder="e.g. Aerial (avg)"
            value={paLabel}
            onChange={(e) => setPaLabel(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Button size="sm" className="h-7 text-xs" disabled={!canAdd} onClick={() => {
            onAdd(paMetrics.map((m) => ({ id: newId(), type: "pipeline-avg" as const, pipelineId: paId!, metric: m, aggregation: (paAggs[m] ?? "avg") as any, label: paLabel ? `${paLabel} · ${m}` : undefined })))
          }}>Add {paMetrics.length > 1 ? `${paMetrics.length} sources` : "source"}</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setStep("type")}>Back</Button>
        </div>
      </div>
    )
  }

  if (step === "reference") {
    const canAdd = !!refDatasetId && !!refMetric
    return (
      <div className="rounded-md border border-dashed p-3 space-y-2 bg-muted/30">
        <p className="text-xs font-medium">Reference Dataset</p>
        <ReferenceDatasetSelector value={refDatasetId} onChange={setRefDatasetId} />
        <ReferenceMetricSelect datasetId={refDatasetId} value={refMetric} onChange={setRefMetric} />
        <div className="space-y-1.5">
          <Label className="text-xs">Aggregation</Label>
          <Select value={refAgg} onValueChange={setRefAgg}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {AGG_OPTS.slice(0, 3).map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Label (optional)</Label>
          <input
            className="w-full h-7 rounded border bg-background px-2 text-xs"
            placeholder="e.g. Reference LAI"
            value={refLabel}
            onChange={(e) => setRefLabel(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Button size="sm" className="h-7 text-xs" disabled={!canAdd} onClick={() => {
            onAdd([{ id: newId(), type: "reference", datasetId: refDatasetId!, metric: refMetric!, aggregation: refAgg as any, label: refLabel || undefined }])
          }}>Add</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setStep("type")}>Back</Button>
        </div>
      </div>
    )
  }

  return null
}

/**
 * GroupBy field selector for multi-source mode.
 * Derives available categorical fields from the first pipeline source's GeoJSON.
 */
function MultiSourceGroupBySelector({
  sources, value, onChange,
}: {
  sources: DataSource[]
  value: string | null
  onChange: (v: string | null) => void
}) {
  // Find the first pipeline-run or pipeline-avg source to load fields from
  const firstPipelineSource = sources.find((s) => s.type === "pipeline-run" || s.type === "pipeline-avg")
  const { data: allRecords = [] } = useTraitRecords()

  const recordId = useMemo(() => {
    if (!firstPipelineSource) return null
    if (firstPipelineSource.type === "pipeline-run") return firstPipelineSource.recordId
    return allRecords.find((r) => r.pipeline_id === (firstPipelineSource as any).pipelineId)?.id ?? null
  }, [firstPipelineSource, allRecords])

  const { data: geoData } = useTraitRecordGeojson(recordId)

  const fields = useMemo(() => {
    if (!geoData) return [] as string[]
    const metrics = new Set(geoData.metric_columns)
    return deduplicateKeys(
      geoData.geojson.features.flatMap((f) => Object.keys(f.properties ?? {}))
    ).filter((k) => !metrics.has(k))
  }, [geoData])

  if (!firstPipelineSource || fields.length === 0) return null

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Group By Field (optional)</Label>
      <Select value={value || "__none__"} onValueChange={(v) => onChange(v === "__none__" ? null : v)}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="No grouping — use date axis" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">None — use date / aggregate axis</SelectItem>
          {fields.map((f) => (
            <SelectItem key={f} value={f}>{f.replace(/_/g, " ")}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value && (
        <p className="text-[10px] text-muted-foreground">
          X-axis will show unique values of <strong>{value}</strong>. For temporal sources, each value becomes its own line.
        </p>
      )}
    </div>
  )
}

/**
 * Filter panel for a reference dataset source.
 * Shows unique values for accession / col / row derived from the dataset's plots.
 */
function ReferenceFiltersSection({
  datasetId,
  filters,
  onChange,
}: {
  datasetId: string
  filters: Record<string, string[]>
  onChange: (f: Record<string, string[]>) => void
}) {
  const { data: plots = [], isLoading } = useReferencePlots(datasetId)

  const uniqueByField = useMemo(() => {
    const out: Record<string, string[]> = {}
    const fields = ["accession", "col", "row", "plot_id"] as const
    fields.forEach((f) => {
      const vals = [...new Set(plots.map((p) => String(p[f] ?? "")).filter(Boolean))].sort()
      if (vals.length > 0 && vals.length <= 300) out[f] = vals
    })
    return out
  }, [plots])

  if (isLoading) return <p className="text-[10px] text-muted-foreground">Loading filter options…</p>
  if (Object.keys(uniqueByField).length === 0) return <p className="text-[10px] text-muted-foreground">No filterable fields found.</p>

  return (
    <div className="space-y-2">
      {Object.entries(uniqueByField).map(([field, vals]) => {
        const selected = filters[field] ?? []
        return (
          <div key={field} className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium text-muted-foreground capitalize">{field.replace(/_/g, " ")}</span>
              {selected.length > 0 && (
                <button className="text-[10px] text-muted-foreground hover:text-foreground"
                  onClick={() => onChange({ ...filters, [field]: [] })}>Clear</button>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {vals.map((v) => (
                <button
                  key={v}
                  onClick={() => {
                    const next = selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]
                    onChange({ ...filters, [field]: next })
                  }}
                  className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
                    selected.includes(v)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SourceList({
  sources,
  onChange,
}: {
  sources: DataSource[]
  onChange: (sources: DataSource[]) => void
}) {
  const [adding, setAdding] = useState(false)
  const [expandedFilters, setExpandedFilters] = useState<Set<string>>(new Set())
  const { data: allRecords = [] } = useTraitRecords()

  function remove(id: string) {
    onChange(sources.filter((s) => s.id !== id))
  }

  function updateLabel(id: string, label: string) {
    onChange(sources.map((s) => s.id === id ? { ...s, label: label || undefined } : s))
  }

  function updateYAxis(id: string, yAxis: "left" | "right") {
    onChange(sources.map((s) => s.id === id ? { ...s, yAxis } : s))
  }

  function updateSourceFilters(id: string, filters: Record<string, string[]>) {
    onChange(sources.map((s) => s.id === id ? { ...s, filters } : s))
  }

  function toggleFilters(id: string) {
    setExpandedFilters((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function handleAdd(srcs: DataSource[]) {
    onChange([...sources, ...srcs])
    setAdding(false)
  }

  // Resolve a recordId for the FiltersSection given a source
  function sourceRecordId(src: DataSource): string | null {
    if (src.type === "pipeline-run") return src.recordId
    if (src.type === "pipeline-avg") {
      return allRecords.find((r) => r.pipeline_id === src.pipelineId)?.id ?? null
    }
    return null
  }

  const sourceTypeLabel = (src: DataSource) => {
    if (src.type === "pipeline-run") return "Run"
    if (src.type === "pipeline-avg") return "Avg"
    return "Ref"
  }

  const defaultLabelHint = (src: DataSource) => {
    if (src.type === "reference") return (src as any).datasetId?.slice(0, 6) + "… · " + src.metric
    if (src.type === "pipeline-run") return (src as any).recordId?.slice(0, 6) + "… · " + src.metric
    return (src as any).pipelineId?.slice(0, 6) + "… · " + src.metric
  }

  const activeFiltersCount = (src: DataSource) =>
    Object.values(src.filters ?? {}).filter((v) => v.length > 0).length

  return (
    <div className="space-y-2">
      <Label className="text-xs">Data Sources</Label>

      {sources.length === 0 && !adding && (
        <p className="text-xs text-muted-foreground">No sources added yet — add at least one to render the chart.</p>
      )}

      {sources.map((src, i) => {
        const filterCount = activeFiltersCount(src)
        const filtersExpanded = expandedFilters.has(src.id)
        const recordIdForFilter = sourceRecordId(src)

        return (
          <div key={src.id} className="rounded-md border bg-card">
            {/* Header row */}
            <div className="flex items-center gap-1.5 p-2.5">
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${
                src.type === "reference"
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
                  : "bg-primary/10 text-primary"
              }`}>
                {sourceTypeLabel(src)}
              </span>
              <span className="text-xs flex-1 truncate text-muted-foreground min-w-0">
                {src.label || defaultLabelHint(src)}
              </span>
              <span className={`text-[9px] font-bold flex-shrink-0 ${i === 0 ? "text-primary" : "text-muted-foreground"}`}>
                {sources.length > 1 ? (i === 0 ? "L" : "R") : ""}
              </span>
              {/* Filter toggle (pipeline sources + reference sources) */}
              {(recordIdForFilter || src.type === "reference") && (
                <button
                  onClick={() => toggleFilters(src.id)}
                  title="Toggle filters"
                  className={`flex-shrink-0 transition-colors ${filterCount > 0 ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <SlidersHorizontal className="w-3 h-3" />
                  {filterCount > 0 && <span className="text-[9px] ml-0.5">{filterCount}</span>}
                </button>
              )}
              <button onClick={() => remove(src.id)} className="text-muted-foreground hover:text-destructive flex-shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Label + Y-axis row */}
            <div className="grid grid-cols-2 gap-1.5 px-2.5 pb-2.5">
              <div className="space-y-1">
                <Label className="text-[10px]">Label</Label>
                <input
                  className="w-full h-6 rounded border bg-background px-1.5 text-xs"
                  placeholder="Auto"
                  value={src.label ?? ""}
                  onChange={(e) => updateLabel(src.id, e.target.value)}
                />
              </div>
              {sources.length > 1 && (
                <div className="space-y-1">
                  <Label className="text-[10px]">Y-axis</Label>
                  <Select value={src.yAxis ?? "left"} onValueChange={(v) => updateYAxis(src.id, v as "left" | "right")}>
                    <SelectTrigger className="h-6 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="left" className="text-xs">Left</SelectItem>
                      <SelectItem value="right" className="text-xs">Right</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* Collapsible filter section */}
            {filtersExpanded && (recordIdForFilter || src.type === "reference") && (
              <div className="border-t px-2.5 pb-2.5 pt-2 space-y-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Filters</span>
                  <button onClick={() => toggleFilters(src.id)} className="text-muted-foreground hover:text-foreground">
                    <ChevronUp className="w-3 h-3" />
                  </button>
                </div>
                {src.type === "reference" ? (
                  <ReferenceFiltersSection
                    datasetId={(src as any).datasetId}
                    filters={src.filters ?? {}}
                    onChange={(f) => updateSourceFilters(src.id, f)}
                  />
                ) : recordIdForFilter ? (
                  <FiltersSection
                    recordId={recordIdForFilter}
                    filters={src.filters ?? {}}
                    onChange={(f) => updateSourceFilters(src.id, f)}
                  />
                ) : null}
              </div>
            )}
          </div>
        )
      })}

      {adding
        ? <AddSourcePanel onAdd={handleAdd} onCancel={() => setAdding(false)} />
        : (
          <button
            onClick={() => setAdding(true)}
            className="w-full flex items-center justify-center gap-1.5 h-8 rounded border border-dashed text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add source
          </button>
        )
      }
    </div>
  )
}

// ── Chart form ────────────────────────────────────────────────────────────────

function ChartForm({ config, onChange }: { config: ChartConfig; onChange: (c: ChartConfig) => void }) {
  // For temporal mode, derive categorical fields from the first record in the pipeline
  const filterRecordId = config.mode === "temporal"
    ? (config.temporalRecordIds[0] ?? null)
    : config.traitRecordId

  return (
    <div className="space-y-3">
      {/* Mode */}
      <div className="space-y-1.5">
        <Label className="text-xs">Chart Mode</Label>
        <Select
          value={config.mode}
          onValueChange={(v) => onChange({ ...config, mode: v as ChartMode })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="spatial">Spatial — compare by category (single run)</SelectItem>
            <SelectItem value="temporal">Temporal — track change over dates</SelectItem>
            <SelectItem value="correlation">Correlation — metric vs metric</SelectItem>
            <SelectItem value="multi-source">Multi-source — compare across pipelines &amp; reference data</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Chart type */}
      <div className="space-y-1.5">
        <Label className="text-xs">Chart Type</Label>
        <Select
          value={config.chartType}
          onValueChange={(v) => onChange({ ...config, chartType: v as ChartType })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {config.mode === "spatial" && (
              <>
                <SelectItem value="bar">Bar Chart</SelectItem>
                <SelectItem value="histogram">Histogram (distribution)</SelectItem>
              </>
            )}
            {config.mode === "temporal" && (
              <>
                <SelectItem value="line">Line Chart</SelectItem>
                <SelectItem value="area">Area Chart</SelectItem>
              </>
            )}
            {config.mode === "correlation" && (
              <SelectItem value="scatter">Scatter Plot</SelectItem>
            )}
            {config.mode === "multi-source" && (
              <>
                <SelectItem value="line">Line Chart</SelectItem>
                <SelectItem value="area">Area Chart</SelectItem>
                <SelectItem value="bar">Bar Chart</SelectItem>
              </>
            )}
          </SelectContent>
        </Select>
      </div>

      {/* Multi-source fields */}
      {config.mode === "multi-source" && (
        <>
          <SourceList
            sources={config.sources ?? []}
            onChange={(sources) => onChange({ ...config, sources })}
          />

          {/* Group-by field selector */}
          <MultiSourceGroupBySelector
            sources={config.sources ?? []}
            value={config.groupByField ?? null}
            onChange={(v) => onChange({ ...config, groupByField: v })}
          />

          {/* Bar layout toggle — only relevant for bar chart + categorical groupBy */}
          {config.chartType === "bar" && (config.groupByField || (config.sources ?? []).length > 1) && (
            <div className="space-y-1.5">
              <Label className="text-xs">Bar Layout</Label>
              <div className="flex gap-2">
                {(["grouped", "stacked"] as const).map((opt) => (
                  <button
                    key={opt}
                    onClick={() => onChange({ ...config, barLayout: opt })}
                    className={`flex-1 h-7 rounded border text-xs transition-colors ${
                      (config.barLayout ?? "grouped") === opt
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    {opt === "grouped" ? "Side by side" : "Stacked"}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Spatial fields */}
      {config.mode === "spatial" && (
        <>
          <RecordSelector
            value={config.traitRecordId}
            onChange={(id) => onChange({ ...config, traitRecordId: id })}
          />
              {config.chartType !== "histogram" && (
            <FieldSelect
              recordId={config.traitRecordId}
              value={config.xAxis}
              onChange={(v) => onChange({ ...config, xAxis: v || null })}
              label="X-Axis (categorical field)"
            />
          )}
          <MultiMetricSelector
            recordId={config.traitRecordId}
            values={config.yAxes?.length > 0 ? config.yAxes : (config.yAxis ? [config.yAxis] : [])}
            aggregations={config.yAxesAggregation ?? {}}
            onChange={(metrics) => onChange({ ...config, yAxes: metrics, yAxis: metrics[0] ?? null })}
            onAggChange={(metric, agg) => onChange({ ...config, yAxesAggregation: { ...(config.yAxesAggregation ?? {}), [metric]: agg as any } })}
            label="Y-Axis Metrics"
          />
          {(config.yAxes?.length ?? 0) > 1 && (
            <label className="flex items-center gap-2 cursor-pointer">
              <div
                className={`relative w-8 h-4 rounded-full transition-colors ${config.dualAxis ? "bg-primary" : "bg-muted-foreground/30"}`}
                onClick={() => onChange({ ...config, dualAxis: !config.dualAxis })}
              >
                <div className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${config.dualAxis ? "translate-x-4" : ""}`} />
              </div>
              <span className="text-xs">Dual Y-axis (separate scales)</span>
            </label>
          )}
        </>
      )}

      {/* Temporal fields */}
      {config.mode === "temporal" && (
        <>
          <PipelineSelect
            value={config.pipelineId}
            onChange={(id, records) =>
              onChange({ ...config, pipelineId: id, temporalRecordIds: records })
            }
          />
          <MultiMetricSelector
            recordId={config.temporalRecordIds[0] ?? null}
            fallbackRecordIds={config.temporalRecordIds}
            values={config.yAxes?.length > 0 ? config.yAxes : (config.yAxis ? [config.yAxis] : [])}
            aggregations={config.yAxesAggregation ?? {}}
            onChange={(metrics) => onChange({ ...config, yAxes: metrics, yAxis: metrics[0] ?? null })}
            onAggChange={(metric, agg) => onChange({ ...config, yAxesAggregation: { ...(config.yAxesAggregation ?? {}), [metric]: agg as any } })}
            label="Metrics (Y-axis)"
          />
          {(config.yAxes?.length ?? 0) > 1 && (
            <label className="flex items-center gap-2 cursor-pointer">
              <div
                className={`relative w-8 h-4 rounded-full transition-colors ${config.dualAxis ? "bg-primary" : "bg-muted-foreground/30"}`}
                onClick={() => onChange({ ...config, dualAxis: !config.dualAxis })}
              >
                <div className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${config.dualAxis ? "translate-x-4" : ""}`} />
              </div>
              <span className="text-xs">Dual Y-axis (separate scales)</span>
            </label>
          )}
          {(config.yAxes?.length ?? 0) <= 1 && (
            <FieldSelect
              recordId={config.temporalRecordIds[0] ?? null}
              value={config.groupBy}
              onChange={(v) => onChange({ ...config, groupBy: v || null })}
              label="Group By (optional — separate series per value)"
            />
          )}
          {/* Error band controls — only shown when not grouped */}
          {!config.groupBy && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <div
                  className={`relative w-8 h-4 rounded-full transition-colors ${config.showErrorBand ? "bg-primary" : "bg-muted-foreground/30"}`}
                  onClick={() => onChange({ ...config, showErrorBand: !config.showErrorBand })}
                >
                  <div className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${config.showErrorBand ? "translate-x-4" : ""}`} />
                </div>
                <span className="text-xs">Show error band</span>
              </label>
              {config.showErrorBand && (
                <Select
                  value={config.errorBandType ?? "std"}
                  onValueChange={(v) => onChange({ ...config, errorBandType: v as any })}
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="std">±1 Std Dev</SelectItem>
                    <SelectItem value="minmax">Min / Max range</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
        </>
      )}

      {/* Correlation fields */}
      {config.mode === "correlation" && (
        <>
          <RecordSelector
            value={config.traitRecordId}
            onChange={(id) => onChange({ ...config, traitRecordId: id })}
          />
          <MetricSelect
            recordId={config.traitRecordId}
            value={config.xAxis}
            onChange={(v) => onChange({ ...config, xAxis: v || null })}
            label="X-Axis (metric)"
          />
          <MetricSelect
            recordId={config.traitRecordId}
            value={config.yAxis}
            onChange={(v) => onChange({ ...config, yAxis: v || null })}
            label="Y-Axis (metric)"
          />
        </>
      )}

      {config.mode !== "multi-source" && (
        <>
          <hr />
          <FiltersSection
            recordId={filterRecordId}
            filters={config.filters ?? {}}
            onChange={(f) => onChange({ ...config, filters: f })}
          />
        </>
      )}
    </div>
  )
}

function TableForm({ config, onChange }: { config: TableConfig; onChange: (c: TableConfig) => void }) {
  // Resolve effective IDs for single-record filter preview
  const activeIds = (config.traitRecordIds?.length ?? 0) > 0 ? config.traitRecordIds : (config.traitRecordId ? [config.traitRecordId] : [])
  const isMulti = activeIds.length > 1

  return (
    <div className="space-y-3">
      <MultiRecordSelector
        values={activeIds}
        onChange={(ids) => onChange({ ...config, traitRecordIds: ids, traitRecordId: ids[0] ?? null })}
      />
      <div className="space-y-1.5">
        <Label className="text-xs">Max Rows</Label>
        <Input
          type="number"
          className="h-8 text-xs"
          value={config.maxRows}
          min={1}
          max={10000}
          onChange={(e) => onChange({ ...config, maxRows: parseInt(e.target.value) || 100 })}
        />
      </div>
      {!isMulti && (
        <>
          <hr />
          <FiltersSection
            recordId={activeIds[0] ?? null}
            filters={config.filters ?? {}}
            onChange={(f) => onChange({ ...config, filters: f })}
          />
        </>
      )}
    </div>
  )
}

function PlotViewerForm({
  config,
  onChange,
}: {
  config: PlotViewerConfig
  onChange: (c: PlotViewerConfig) => void
}) {
  const activeIds = (config.traitRecordIds?.length ?? 0) > 0 ? config.traitRecordIds : (config.traitRecordId ? [config.traitRecordId] : [])
  const isMulti = activeIds.length > 1

  return (
    <div className="space-y-3">
      <MultiRecordSelector
        values={activeIds}
        onChange={(ids) => onChange({ ...config, traitRecordIds: ids, traitRecordId: ids[0] ?? null, pinnedPlotIds: [] })}
      />
      <p className="text-xs text-muted-foreground">
        After selecting sources, search and pin plots directly in the widget.
      </p>
      {!isMulti && (
        <>
          <hr />
          <FiltersSection
            recordId={activeIds[0] ?? null}
            filters={config.filters ?? {}}
            onChange={(f) => onChange({ ...config, filters: f })}
          />
        </>
      )}
    </div>
  )
}

// ── Main dialog ───────────────────────────────────────────────────────────────

interface WidgetConfigDialogProps {
  widget: DashboardWidget
  open: boolean
  onClose: () => void
  onSave: (updated: DashboardWidget) => void
}

export function WidgetConfigDialog({ widget, open, onClose, onSave }: WidgetConfigDialogProps) {
  const [draft, setDraft] = useState<DashboardWidget>(widget)

  function handleSave() {
    onSave(draft)
    onClose()
  }

  function updateConfig(config: DashboardWidget["config"]) {
    setDraft((d) => ({ ...d, config } as DashboardWidget))
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">Configure Widget</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Title */}
          <div className="space-y-1.5">
            <Label className="text-xs">Widget Title</Label>
            <Input
              className="h-8 text-xs"
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            />
          </div>

          {/* Span */}
          <div className="space-y-1.5">
            <Label className="text-xs">Size</Label>
            <Select
              value={draft.span}
              onValueChange={(v) => setDraft((d) => ({ ...d, span: v as WidgetSpan }))}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SPAN_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <hr />

          {/* Type-specific config */}
          {draft.type === "kpi" && (
            <KpiForm config={draft.config} onChange={updateConfig as any} />
          )}
          {draft.type === "chart" && (
            <ChartForm config={draft.config} onChange={updateConfig as any} />
          )}
          {draft.type === "table" && (
            <TableForm config={draft.config} onChange={updateConfig as any} />
          )}
          {draft.type === "plot-viewer" && (
            <PlotViewerForm config={draft.config} onChange={updateConfig as any} />
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
