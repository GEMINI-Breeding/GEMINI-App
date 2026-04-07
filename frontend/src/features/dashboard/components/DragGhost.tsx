/**
 * DragGhost — floating widget card that follows the cursor during a drag.
 * Rendered via React portal into document.body so it always sits on top.
 */

import { createPortal } from "react-dom"
import {
  Hash, TrendingUp, BarChart3, ScatterChart, Table2, Image, Activity,
} from "lucide-react"
import { WIDGET_TEMPLATES } from "./WidgetToolbox"
import type { DragPos } from "../hooks/useDrag"

const ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  Hash, TrendingUp, BarChart3, ScatterChart, Table2, Image, Activity,
}

interface DragGhostProps {
  templateId: string
  pos: DragPos
  isOverCanvas: boolean
}

export function DragGhost({ templateId, pos, isOverCanvas }: DragGhostProps) {
  const template = WIDGET_TEMPLATES.find((t) => t.templateId === templateId)
  if (!template) return null

  const Icon = ICON_MAP[template.iconName] ?? Hash

  return createPortal(
    <div
      style={{
        position: "fixed",
        left: pos.x + 12,
        top: pos.y + 12,
        pointerEvents: "none",
        zIndex: 9999,
        transition: "opacity 0.1s",
      }}
    >
      <div
        className={`flex items-center gap-2 px-3 py-2 rounded-lg border shadow-lg text-sm font-medium
          ${isOverCanvas
            ? "bg-primary text-primary-foreground border-primary"
            : "bg-card text-foreground border-border opacity-80"
          }`}
      >
        <Icon className="w-4 h-4 flex-shrink-0" />
        <span>{template.name}</span>
      </div>
    </div>,
    document.body
  )
}
