/** All TypeScript types for the Dashboard feature. */

// ── Span ──────────────────────────────────────────────────────────────────────

export type WidgetSpan = "sm" | "md" | "lg" | "full"

export const SPAN_CLASSES: Record<WidgetSpan, string> = {
  sm: "col-span-12 md:col-span-6 lg:col-span-3",
  md: "col-span-12 md:col-span-6 lg:col-span-6",
  lg: "col-span-12 lg:col-span-8",
  full: "col-span-12",
}

// ── Widget configs ─────────────────────────────────────────────────────────────

export interface KpiConfig {
  traitRecordId: string | null
  metric: string | null
  aggregation: "avg" | "min" | "max" | "count"
  /** Optional second record to compute % change vs */
  compareRecordId: string | null
  /** field → selected values; empty array = show all for that field */
  filters: Record<string, string[]>
}

export type ChartMode = "spatial" | "temporal" | "correlation"
export type ChartType = "bar" | "line" | "area" | "scatter" | "histogram"
export type ChartAggregation = "avg" | "min" | "max" | "sum" | "median"
export type ErrorBandType = "std" | "minmax"

export interface ChartConfig {
  mode: ChartMode
  chartType: ChartType
  /** For spatial / correlation / histogram */
  traitRecordId: string | null
  /** X-axis: categorical field (spatial) or metric (correlation) */
  xAxis: string | null
  /** Y-axis: single metric — kept for backward compat with saved configs */
  yAxis: string | null
  /** Multi-trait Y-axes — takes precedence over yAxis when non-empty */
  yAxes: string[]
  /**
   * When true and yAxes.length > 1: first trait on left axis, rest on right axis
   * (use for mixed-scale traits like height + vegetation fraction).
   * When false: all traits share one scale (use for counts of the same unit).
   */
  dualAxis: boolean
  /** Per-metric aggregation for temporal charts (defaults to "avg" if absent) */
  yAxesAggregation: Record<string, ChartAggregation>
  /** Show ±std-dev or min/max band around the main line in temporal charts */
  showErrorBand: boolean
  /** Whether the band shows ±1 std dev or the full min/max range */
  errorBandType: ErrorBandType
  /** Group-by field (e.g. 'accession') — optional, produces multiple series */
  groupBy: string | null
  /** For temporal: which pipeline to pull records from */
  pipelineId: string | null
  /** For temporal: explicit record IDs in display order */
  temporalRecordIds: string[]
  /** field → selected values; empty array = show all for that field */
  filters: Record<string, string[]>
}

export interface TableConfig {
  /** Single source — kept for backward compat */
  traitRecordId: string | null
  /** Multi-source record IDs — takes precedence when non-empty */
  traitRecordIds: string[]
  /** Empty = show all columns */
  columns: string[]
  /** field → selected values; empty array = show all for that field */
  filters: Record<string, string[]>
  maxRows: number
}

export interface PlotViewerConfig {
  /** Single source — kept for backward compat */
  traitRecordId: string | null
  /** Multi-source record IDs — takes precedence when non-empty */
  traitRecordIds: string[]
  pinnedPlotIds: string[]
  /** field → selected values; empty array = show all for that field */
  filters: Record<string, string[]>
}

// ── Widget definitions ─────────────────────────────────────────────────────────

interface BaseWidget {
  instanceId: string
  title: string
  span: WidgetSpan
}

export interface KpiWidgetDef extends BaseWidget {
  type: "kpi"
  config: KpiConfig
}

export interface ChartWidgetDef extends BaseWidget {
  type: "chart"
  config: ChartConfig
}

export interface TableWidgetDef extends BaseWidget {
  type: "table"
  config: TableConfig
}

export interface PlotViewerWidgetDef extends BaseWidget {
  type: "plot-viewer"
  config: PlotViewerConfig
}

export type DashboardWidget =
  | KpiWidgetDef
  | ChartWidgetDef
  | TableWidgetDef
  | PlotViewerWidgetDef

// ── Tab & state ───────────────────────────────────────────────────────────────

export interface DashboardTab {
  id: string
  name: string
  widgets: DashboardWidget[]
}

export interface DashboardState {
  tabs: DashboardTab[]
  activeTabId: string
}

// ── Template (toolbox items) ───────────────────────────────────────────────────

export interface WidgetTemplate {
  templateId: string
  type: DashboardWidget["type"]
  name: string
  description: string
  /** Lucide icon name (string — imported separately in WidgetToolbox) */
  iconName: string
  defaultSpan: WidgetSpan
  category: "Metrics" | "Charts" | "Tables" | "Visual"
  defaultConfig: Partial<KpiConfig> | Partial<ChartConfig> | Partial<TableConfig> | Partial<PlotViewerConfig>
}
