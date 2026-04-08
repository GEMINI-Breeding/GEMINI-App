/**
 * DashboardCanvas — the main drop zone and widget grid.
 *
 * Uses pointer events (not HTML5 DnD) for Tauri WebKit compatibility.
 * The parent DashboardBuilder tracks dragging state and passes isOver + canvasRef.
 */

import { forwardRef } from "react"
import {
  Hash, TrendingUp, BarChart3, ScatterChart, Table2, Image, Activity, Plus,
} from "lucide-react"
import { WidgetCard } from "./WidgetCard"
import { SPAN_CLASSES } from "../types"
import { WIDGET_TEMPLATES } from "./WidgetToolbox"
import type { DashboardWidget, DashboardTab, WidgetSpan } from "../types"

// ── Ghost widget preview ──────────────────────────────────────────────────────

const ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  Hash, TrendingUp, BarChart3, ScatterChart, Table2, Image, Activity,
}

function GhostWidget({ templateId }: { templateId: string }) {
  const template = WIDGET_TEMPLATES.find((t) => t.templateId === templateId)
  if (!template) return null
  const Icon = ICON_MAP[template.iconName] ?? Hash
  const spanClass = SPAN_CLASSES[template.defaultSpan as WidgetSpan]
  const isKpi = template.type === "kpi"

  return (
    <div className={spanClass}>
      <div
        className={`border-2 border-dashed border-primary/70 rounded-lg bg-primary/8
          flex flex-col items-center justify-center gap-2 animate-pulse pointer-events-none
          ${isKpi ? "min-h-[110px]" : "min-h-[260px]"}`}
      >
        <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center">
          <Icon className="w-4 h-4 text-primary" />
        </div>
        <div className="text-center">
          <p className="text-xs font-semibold text-primary">{template.name}</p>
          <p className="text-[10px] text-primary/70 mt-0.5">Release to add</p>
        </div>
      </div>
    </div>
  )
}

// ── Canvas ────────────────────────────────────────────────────────────────────

interface DashboardCanvasProps {
  tab: DashboardTab
  draggingTemplateId: string | null
  isOver: boolean
  onUpdateWidget: (instanceId: string, updated: DashboardWidget) => void
  onRemoveWidget: (instanceId: string) => void
  onReorderWidget: (instanceId: string, direction: "left" | "right") => void
}

export const DashboardCanvas = forwardRef<HTMLDivElement, DashboardCanvasProps>(
  function DashboardCanvas(
    { tab, draggingTemplateId, isOver, onUpdateWidget, onRemoveWidget, onReorderWidget },
    ref
  ) {
    const isDragging = draggingTemplateId !== null
    const showGhost = isDragging && isOver

    return (
      <div
        ref={ref}
        className={`flex-1 min-h-0 relative transition-colors duration-100 overscroll-contain
          ${isDragging ? "overflow-hidden" : "overflow-y-auto"}
          ${isOver ? "bg-primary/[0.03]" : ""}`}
        style={{
          backgroundImage: isDragging
            ? "url(\"data:image/svg+xml,%3Csvg width='28' height='28' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='2' cy='2' r='1.5' fill='%234f46e5' fill-opacity='0.3'/%3E%3C/svg%3E\")"
            : "url(\"data:image/svg+xml,%3Csvg width='28' height='28' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='2' cy='2' r='1.5' fill='%23888' fill-opacity='0.18'/%3E%3C/svg%3E\")",
          backgroundSize: "28px 28px",
        }}
      >
        {/* Drop ring overlay */}
        {isOver && (
          <div className="absolute inset-2 border-2 border-dashed border-primary/50 rounded-lg pointer-events-none z-10" />
        )}

        <div className="max-w-[1800px] mx-auto p-5 min-h-full">
          {tab.widgets.length === 0 && !showGhost ? (
            <div
              className={`min-h-[400px] border-2 border-dashed rounded-xl flex flex-col items-center justify-center transition-all
                ${isOver ? "border-primary/60 bg-primary/5" : "border-border/60"}`}
            >
              <div className="w-14 h-14 bg-card rounded-full border border-border flex items-center justify-center mb-4 text-muted-foreground">
                <Plus className="w-7 h-7" />
              </div>
              <h3 className="text-base font-semibold text-foreground mb-1">Canvas is empty</h3>
              <p className="text-sm text-muted-foreground max-w-xs text-center">
                Drag a widget from the sidebar and drop it here.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-12 gap-4">
              {tab.widgets.map((widget, idx) => (
                <div
                  key={widget.instanceId}
                  className={`${SPAN_CLASSES[widget.span]} transition-opacity duration-150 ${isDragging ? "opacity-50" : "opacity-100"}`}
                >
                  <WidgetCard
                    widget={widget}
                    onUpdate={(updated) => onUpdateWidget(widget.instanceId, updated)}
                    onRemove={() => onRemoveWidget(widget.instanceId)}
                    onMoveLeft={idx > 0 ? () => onReorderWidget(widget.instanceId, "left") : undefined}
                    onMoveRight={idx < tab.widgets.length - 1 ? () => onReorderWidget(widget.instanceId, "right") : undefined}
                  />
                </div>
              ))}
              {showGhost && <GhostWidget templateId={draggingTemplateId!} />}
            </div>
          )}

          {tab.widgets.length === 0 && showGhost && (
            <div className="grid grid-cols-12 gap-4 mt-4">
              <GhostWidget templateId={draggingTemplateId!} />
            </div>
          )}
        </div>
      </div>
    )
  }
)
