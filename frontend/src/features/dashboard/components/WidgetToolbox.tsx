/**
 * WidgetToolbox — left sidebar with draggable widget templates.
 *
 * Three display modes cycled by clicking the chevron button:
 *   collapsed  — icons only (w-12)
 *   normal     — icon + name (w-56)
 *   expanded   — icon + name + full description (w-72)
 */

import { useState } from "react"
import {
  Hash, TrendingUp, BarChart3, ScatterChart, Table2, Image,
  GripVertical, Activity, ChevronLeft, ChevronRight, LayoutDashboard,
} from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { WidgetTemplate } from "../types"

// ── Template registry ─────────────────────────────────────────────────────────

export const WIDGET_TEMPLATES: WidgetTemplate[] = [
  {
    templateId: "kpi",
    type: "kpi",
    name: "KPI Metric",
    description: "Single aggregated value — avg, min, max, or count — with optional % change vs a second run",
    iconName: "Hash",
    defaultSpan: "sm",
    category: "Metrics",
    defaultConfig: { aggregation: "avg", traitRecordId: null, metric: null, compareRecordId: null, filters: {} },
  },
  {
    templateId: "bar-chart",
    type: "chart",
    name: "Bar Chart",
    description: "Compare a metric across categories — accession, genotype, col, row — from a single pipeline run",
    iconName: "BarChart3",
    defaultSpan: "md",
    category: "Charts",
    defaultConfig: { mode: "spatial", chartType: "bar", traitRecordId: null, xAxis: null, yAxis: null, yAxes: [], dualAxis: false, yAxesAggregation: {}, showErrorBand: false, errorBandType: "std", groupBy: null, pipelineId: null, temporalRecordIds: [], filters: {} },
  },
  {
    templateId: "line-chart",
    type: "chart",
    name: "Growth Trajectory",
    description: "Track a trait's average value over time across multiple extractions from the same pipeline",
    iconName: "TrendingUp",
    defaultSpan: "lg",
    category: "Charts",
    defaultConfig: { mode: "temporal", chartType: "line", traitRecordId: null, xAxis: null, yAxis: null, yAxes: [], dualAxis: false, yAxesAggregation: {}, showErrorBand: false, errorBandType: "std", groupBy: null, pipelineId: null, temporalRecordIds: [], filters: {} },
  },
  {
    templateId: "area-chart",
    type: "chart",
    name: "Area Chart",
    description: "Filled area chart — same as Growth Trajectory but with shaded regions under each line",
    iconName: "Activity",
    defaultSpan: "lg",
    category: "Charts",
    defaultConfig: { mode: "temporal", chartType: "area", traitRecordId: null, xAxis: null, yAxis: null, yAxes: [], dualAxis: false, yAxesAggregation: {}, showErrorBand: false, errorBandType: "std", groupBy: null, pipelineId: null, temporalRecordIds: [], filters: {} },
  },
  {
    templateId: "scatter",
    type: "chart",
    name: "Trait Correlation",
    description: "Scatter plot with one trait on each axis — find relationships like height vs canopy cover",
    iconName: "ScatterChart",
    defaultSpan: "md",
    category: "Charts",
    defaultConfig: { mode: "correlation", chartType: "scatter", traitRecordId: null, xAxis: null, yAxis: null, yAxes: [], dualAxis: false, yAxesAggregation: {}, showErrorBand: false, errorBandType: "std", groupBy: null, pipelineId: null, temporalRecordIds: [], filters: {} },
  },
  {
    templateId: "histogram",
    type: "chart",
    name: "Histogram",
    description: "Distribution of a single trait across all plots — shows spread and outliers",
    iconName: "BarChart3",
    defaultSpan: "md",
    category: "Charts",
    defaultConfig: { mode: "spatial", chartType: "histogram", traitRecordId: null, xAxis: null, yAxis: null, yAxes: [], dualAxis: false, groupBy: null, pipelineId: null, temporalRecordIds: [], filters: {} },
  },
  {
    templateId: "table",
    type: "table",
    name: "Trait Table",
    description: "Sortable, searchable table of all plot traits with CSV export",
    iconName: "Table2",
    defaultSpan: "full",
    category: "Tables",
    defaultConfig: { traitRecordId: null, traitRecordIds: [], columns: [], filters: {}, maxRows: 200 },
  },
  {
    templateId: "plot-viewer",
    type: "plot-viewer",
    name: "Plot Viewer",
    description: "Browse plots by ID or accession, pin them side-by-side to compare images and trait values",
    iconName: "Image",
    defaultSpan: "full",
    category: "Visual",
    defaultConfig: { traitRecordId: null, traitRecordIds: [], pinnedPlotIds: [], filters: {} },
  },
]

const ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  Hash, TrendingUp, BarChart3, ScatterChart, Table2, Image, Activity,
}

const CATEGORY_ORDER = ["Metrics", "Charts", "Tables", "Visual"] as const

type SidebarMode = "collapsed" | "normal" | "expanded"

const SIDEBAR_WIDTHS: Record<SidebarMode, string> = {
  collapsed: "w-10",
  normal: "w-56",
  expanded: "w-72",
}

// ── Component ─────────────────────────────────────────────────────────────────

interface WidgetToolboxProps {
  onDragStart: (e: React.MouseEvent, templateId: string) => void
  draggingTemplateId: string | null
}

export function WidgetToolbox({ onDragStart, draggingTemplateId }: WidgetToolboxProps) {
  const [mode, setMode] = useState<SidebarMode>("normal")

  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    templates: WIDGET_TEMPLATES.filter((t) => t.category === cat),
  }))

  function cycleMode() {
    setMode((m) => m === "collapsed" ? "normal" : m === "normal" ? "expanded" : "collapsed")
  }

  const isCollapsed = mode === "collapsed"
  const isExpanded = mode === "expanded"

  return (
    <aside
      className={`${SIDEBAR_WIDTHS[mode]} bg-card border-r border-border flex flex-col z-10 transition-[width] duration-200 flex-shrink-0`}
    >
      {/* Header */}
      <div className={`h-16 border-b border-border flex items-center flex-shrink-0 ${isCollapsed ? "justify-center" : "justify-between px-3"}`}>
        {!isCollapsed && (
          <div className="flex items-center gap-2">
            <LayoutDashboard className="w-4.5 h-4.5 text-primary" />
            <span className="text-xl font-semibold">Widgets</span>
          </div>
        )}
        <button
          onClick={cycleMode}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title={isCollapsed ? "Expand sidebar" : isExpanded ? "Collapse sidebar" : "Expand descriptions"}
        >
          {isCollapsed
            ? <ChevronRight className="w-3.5 h-3.5" />
            : isExpanded
            ? <ChevronLeft className="w-3.5 h-3.5" />
            : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Widget list */}
      <div className={`flex-1 overflow-y-auto overscroll-contain ${isCollapsed ? "p-1 space-y-0.5" : "p-2 space-y-4"}`}>
        {grouped.map(({ category, templates }, groupIdx) => (
          <div key={category}>
            {!isCollapsed && (
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 px-1">
                {category}
              </p>
            )}
            {isCollapsed && groupIdx > 0 && <div className="h-px bg-border/50 my-1 mx-1" />}

            <div className="space-y-0.5">
              {templates.map((t) => {
                const Icon = ICON_MAP[t.iconName] ?? Hash
                const isBeingDragged = draggingTemplateId === t.templateId

                const item = (
                  <div
                    key={t.templateId}
                    onMouseDown={(e) => onDragStart(e, t.templateId)}
                    className={`flex items-center gap-2 rounded-md cursor-grab active:cursor-grabbing select-none transition-all border
                      ${isCollapsed ? "p-1.5 justify-center" : "p-2"}
                      ${isBeingDragged
                        ? "opacity-40 border-primary/40 bg-primary/5"
                        : "border-transparent hover:border-border hover:bg-muted/60 hover:shadow-sm"
                      }`}
                  >
                    {!isCollapsed && (
                      <GripVertical className="w-3 h-3 text-muted-foreground/50 flex-shrink-0" />
                    )}
                    <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${isBeingDragged ? "text-primary" : "text-muted-foreground"}`} />
                    {!isCollapsed && (
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-foreground leading-tight">{t.name}</p>
                        {isExpanded && (
                          <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">
                            {t.description}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )

                // In collapsed mode, wrap with tooltip to show name on hover
                return isCollapsed ? (
                  <Tooltip key={t.templateId} delayDuration={300}>
                    <TooltipTrigger asChild>{item}</TooltipTrigger>
                    <TooltipContent side="right" className="max-w-[200px]">
                      <p className="font-medium text-xs">{t.name}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{t.description}</p>
                    </TooltipContent>
                  </Tooltip>
                ) : item
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Footer hint */}
      {!isCollapsed && (
        <div className="px-3 py-2 border-t border-border flex-shrink-0">
          <p className="text-[10px] text-muted-foreground leading-tight">
            Drag a widget onto the canvas to add it to your dashboard.
          </p>
        </div>
      )}
    </aside>
  )
}
