/**
 * Chart colours that follow the app's light/dark theme.
 *
 * The theme's tokens are `oklch(...)` values, so they are used as
 * `var(--token)` directly — wrapping them as `hsl(var(--token))` (the old
 * shadcn convention) yields an invalid colour, which left lines and hover
 * dots unpainted. Recharts' default tooltip is a fixed white box with
 * inherited text, unreadable in dark mode; these props give it the theme's
 * popover colours instead.
 */
import type { CSSProperties } from "react"

export const CHART_PRIMARY = "var(--primary)"

const tooltipBox: CSSProperties = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--popover-foreground)",
  fontSize: 12,
}

/** Spread onto a recharts <Tooltip>; override `cursor` for bar charts. */
export const chartTooltip = {
  contentStyle: tooltipBox,
  labelStyle: { color: "var(--popover-foreground)", fontWeight: 500 },
  itemStyle: { color: "var(--popover-foreground)" },
  cursor: { stroke: "var(--muted-foreground)", strokeDasharray: "3 3" },
}

/** The dot drawn on the hovered point of a line. */
export const chartActiveDot = {
  r: 5,
  fill: "var(--primary)",
  stroke: "var(--background)",
  strokeWidth: 2,
}
