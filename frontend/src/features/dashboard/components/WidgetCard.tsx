/**
 * WidgetCard — frame for every widget on the canvas.
 *
 * Provides: title, always-visible action buttons (settings, fullscreen, delete),
 * an "unconfigured" badge when no data source is set, and fullscreen expand.
 */

import { useState } from "react"
import { Settings2, Trash2, Maximize2, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FullscreenModal, useExpandable } from "@/components/Common/ExpandableSection"
import { WidgetConfigDialog } from "./WidgetConfigDialog"
import { KpiWidget } from "../widgets/KpiWidget"
import { ChartWidget } from "../widgets/ChartWidget"
import { TableWidget } from "../widgets/TableWidget"
import { PlotViewerWidget } from "../widgets/PlotViewerWidget"
import type { DashboardWidget, PlotViewerConfig } from "../types"

function isUnconfigured(widget: DashboardWidget): boolean {
  if (widget.type === "kpi") return !widget.config.traitRecordId || !widget.config.metric
  if (widget.type === "chart") {
    if (widget.config.mode === "temporal") return !widget.config.pipelineId || !widget.config.yAxis
    return !widget.config.traitRecordId || !widget.config.yAxis
  }
  if (widget.type === "table") return !widget.config.traitRecordId
  if (widget.type === "plot-viewer") return !widget.config.traitRecordId
  return false
}

interface WidgetCardProps {
  widget: DashboardWidget
  onUpdate: (updated: DashboardWidget) => void
  onRemove: () => void
}

export function WidgetCard({ widget, onUpdate, onRemove }: WidgetCardProps) {
  const [configOpen, setConfigOpen] = useState(false)
  const { isExpanded, open: openExpand, close: closeExpand } = useExpandable()

  const isKpi = widget.type === "kpi"
  const minH = isKpi ? "min-h-[110px]" : "min-h-[260px]"
  const needsConfig = isUnconfigured(widget)

  function handlePlotViewerConfigUpdate(patch: Partial<PlotViewerConfig>) {
    if (widget.type !== "plot-viewer") return
    onUpdate({ ...widget, config: { ...widget.config, ...patch } })
  }

  const content = (
    <>
      {widget.type === "kpi" && <KpiWidget config={widget.config} />}
      {widget.type === "chart" && <ChartWidget config={widget.config} />}
      {widget.type === "table" && <TableWidget config={widget.config} />}
      {widget.type === "plot-viewer" && (
        <PlotViewerWidget
          config={widget.config}
          onUpdateConfig={handlePlotViewerConfigUpdate}
        />
      )}
    </>
  )

  return (
    <>
      <div className="bg-card border border-border rounded-lg shadow-sm flex flex-col group h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            {needsConfig && (
              <button
                onClick={() => setConfigOpen(true)}
                title="Click to configure"
                className="flex-shrink-0"
              >
                <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
              </button>
            )}
            <h3 className="text-xs font-semibold text-foreground truncate">{widget.title}</h3>
          </div>

          {/* Action buttons — dimmed at rest, full opacity on group hover */}
          <div className="flex items-center gap-0.5 opacity-30 group-hover:opacity-100 transition-opacity flex-shrink-0">
            {!isKpi && (
              <Button
                variant="ghost"
                size="icon"
                className="w-6 h-6"
                onClick={openExpand}
                title="Fullscreen"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="w-6 h-6"
              onClick={() => setConfigOpen(true)}
              title="Configure widget"
            >
              <Settings2 className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="w-6 h-6 hover:text-destructive"
              onClick={onRemove}
              title="Remove widget"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className={`p-4 flex-1 overflow-auto ${minH}`}>{content}</div>
      </div>

      {/* Fullscreen modal */}
      <FullscreenModal open={isExpanded} onClose={closeExpand} title={widget.title}>
        <div className="p-6 h-full">{content}</div>
      </FullscreenModal>

      {/* Config dialog */}
      {configOpen && (
        <WidgetConfigDialog
          widget={widget}
          open={configOpen}
          onClose={() => setConfigOpen(false)}
          onSave={(updated) => {
            onUpdate(updated)
            setConfigOpen(false)
          }}
        />
      )}
    </>
  )
}
