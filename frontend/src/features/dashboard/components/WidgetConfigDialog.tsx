/**
 * WidgetConfigDialog — per-widget settings dialog.
 *
 * Renders different configuration sections based on widget type.
 * Adapts fields for KPI, Chart (spatial/temporal/correlation), Table, and Plot Viewer.
 * Each form includes a FiltersSection for row-level filtering by categorical values.
 */

import { useState, useMemo } from "react"
import { Plus, X } from "lucide-react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { useTraitRecords, useTraitRecordGeojson } from "../hooks/useTraitData"
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

function MetricSelect({
  recordId, value, onChange, label = "Metric",
}: {
  recordId: string | null
  value: string | null
  onChange: (v: string) => void
  label?: string
}) {
  const { data: geoData } = useTraitRecordGeojson(recordId)
  const cols = geoData?.metric_columns ?? []

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
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
  const { data: geoData } = useTraitRecordGeojson(recordId)

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
      // Only offer fields with a manageable number of unique values
      if (unique.length > 0 && unique.length <= 200) vbf[k] = unique
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
          </SelectContent>
        </Select>
      </div>

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
          <MetricSelect
            recordId={config.traitRecordId}
            value={config.yAxis}
            onChange={(v) => onChange({ ...config, yAxis: v || null })}
            label="Y-Axis (metric)"
          />
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
          <MetricSelect
            recordId={config.temporalRecordIds[0] ?? null}
            value={config.yAxis}
            onChange={(v) => onChange({ ...config, yAxis: v || null })}
            label="Metric (Y-axis)"
          />
          <FieldSelect
            recordId={config.temporalRecordIds[0] ?? null}
            value={config.groupBy}
            onChange={(v) => onChange({ ...config, groupBy: v || null })}
            label="Group By (optional — separate series per value)"
          />
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

      <hr />
      <FiltersSection
        recordId={filterRecordId}
        filters={config.filters ?? {}}
        onChange={(f) => onChange({ ...config, filters: f })}
      />
    </div>
  )
}

function TableForm({ config, onChange }: { config: TableConfig; onChange: (c: TableConfig) => void }) {
  return (
    <div className="space-y-3">
      <RecordSelector
        value={config.traitRecordId}
        onChange={(id) => onChange({ ...config, traitRecordId: id })}
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
      <hr />
      <FiltersSection
        recordId={config.traitRecordId}
        filters={config.filters ?? {}}
        onChange={(f) => onChange({ ...config, filters: f })}
      />
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
  return (
    <div className="space-y-3">
      <RecordSelector
        value={config.traitRecordId}
        onChange={(id) => onChange({ ...config, traitRecordId: id, pinnedPlotIds: [] })}
      />
      <p className="text-xs text-muted-foreground">
        After selecting a data source, use the widget to search and pin specific plots.
      </p>
      <hr />
      <FiltersSection
        recordId={config.traitRecordId}
        filters={config.filters ?? {}}
        onChange={(f) => onChange({ ...config, filters: f })}
      />
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
