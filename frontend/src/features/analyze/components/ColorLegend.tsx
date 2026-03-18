import { legendGradient } from "../utils/colorScale"

interface ColorLegendProps {
  min: number
  max: number
  column: string
}

function fmt(n: number): string {
  return Math.abs(n) >= 1000
    ? n.toFixed(0)
    : Math.abs(n) >= 10
      ? n.toFixed(1)
      : n.toFixed(2)
}

function formatLabel(col: string): string {
  return col.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function ColorLegend({ min, max, column }: ColorLegendProps) {
  return (
    <div className="absolute bottom-8 left-4 z-10 bg-background/90 backdrop-blur-sm rounded-lg border p-3 shadow-md min-w-[180px]">
      <p className="text-xs font-medium mb-1.5 text-foreground truncate max-w-[200px]">
        {formatLabel(column)}
      </p>
      <div
        className="h-3 rounded-sm mb-1"
        style={{ background: legendGradient(column) }}
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{fmt(min)}</span>
        <span>{fmt(max)}</span>
      </div>
    </div>
  )
}
