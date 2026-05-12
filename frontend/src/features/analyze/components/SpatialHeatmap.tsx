import { useMemo } from "react"

import type { SpatialResponse, SpatialSite } from "../lib/multivariate"
import { sequentialColor, textOn } from "../lib/svg"

interface Props {
  response: SpatialResponse
}

const CELL = 36
const LABEL_PAD = 36
const TOP_PAD = 24
const SITE_GAP = 32

export function SpatialHeatmap({ response }: Props) {
  if (response.status !== "ok" || response.sites.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="mv-spatial-empty">
        {response.message ?? "No spatial data available."}
      </p>
    )
  }

  return (
    <section className="flex flex-col gap-6" data-testid="mv-spatial">
      <header className="flex items-end gap-3">
        <h3 className="text-base font-semibold">
          Field layout · {response.trait_name}
        </h3>
        <span className="text-xs text-muted-foreground">
          {response.sites.length} site{response.sites.length === 1 ? "" : "s"} ·{" "}
          {response.sites.reduce((s, x) => s + x.n_cells, 0)} plots
        </span>
      </header>
      {response.sites.map((site, idx) => (
        <SiteGrid
          key={site.site_name ?? `site-${idx}`}
          site={site}
          traitName={response.trait_name}
        />
      ))}
    </section>
  )
}

interface SiteProps {
  site: SpatialSite
  traitName: string
}

function SiteGrid({ site, traitName }: SiteProps) {
  const nCols = site.max_col - site.min_col + 1
  const nRows = site.max_row - site.min_row + 1
  const width = LABEL_PAD + nCols * CELL + 8
  const height = TOP_PAD + LABEL_PAD + nRows * CELL + 8

  // Map cells into a row→col→cell lookup for stable rendering.
  const byKey = useMemo(() => {
    const m = new Map<string, (typeof site.cells)[number]>()
    for (const c of site.cells) {
      m.set(`${c.plot_row_number}:${c.plot_column_number}`, c)
    }
    return m
  }, [site.cells])

  const span = site.value_max - site.value_min
  function normalize(v: number) {
    if (span <= 0) return 0.5
    return (v - site.value_min) / span
  }

  return (
    <div
      className="flex flex-col gap-2"
      style={{ marginBottom: SITE_GAP }}
      data-testid={`mv-spatial-site-${site.site_name ?? "unknown"}`}
    >
      <div className="flex items-center gap-3">
        <h4 className="text-sm font-medium">{site.site_name ?? "(no site)"}</h4>
        <span className="text-xs text-muted-foreground">
          {site.n_cells} plots · {site.value_min.toFixed(2)} –{" "}
          {site.value_max.toFixed(2)}
        </span>
      </div>
      <div className="overflow-auto rounded-md border">
        <svg width={width} height={height}>
          {Array.from({ length: nCols }, (_, ci) => {
            const colNum = site.min_col + ci
            return (
              <text
                key={`col-${colNum}`}
                x={LABEL_PAD + ci * CELL + CELL / 2}
                y={TOP_PAD + LABEL_PAD - 8}
                textAnchor="middle"
                className="fill-foreground text-[10px]"
              >
                {colNum}
              </text>
            )
          })}
          {Array.from({ length: nRows }, (_, ri) => {
            const rowNum = site.min_row + ri
            return (
              <text
                key={`row-${rowNum}`}
                x={LABEL_PAD - 6}
                y={TOP_PAD + LABEL_PAD + ri * CELL + CELL / 2 + 3}
                textAnchor="end"
                className="fill-foreground text-[10px]"
              >
                {rowNum}
              </text>
            )
          })}
          {Array.from({ length: nRows }, (_, ri) =>
            Array.from({ length: nCols }, (_, ci) => {
              const rowNum = site.min_row + ri
              const colNum = site.min_col + ci
              const cell = byKey.get(`${rowNum}:${colNum}`)
              const cx = LABEL_PAD + ci * CELL
              const cy = TOP_PAD + LABEL_PAD + ri * CELL
              if (!cell) {
                return (
                  <rect
                    key={`empty-${ri}-${ci}`}
                    x={cx}
                    y={cy}
                    width={CELL}
                    height={CELL}
                    fill="#f5f5f5"
                    stroke="#fff"
                    strokeWidth={1}
                  />
                )
              }
              const bg = sequentialColor(normalize(cell.value))
              const fg = textOn(bg)
              return (
                <g key={`cell-${ri}-${ci}`}>
                  <rect
                    x={cx}
                    y={cy}
                    width={CELL}
                    height={CELL}
                    fill={bg}
                    stroke="#fff"
                    strokeWidth={1}
                    data-testid={`mv-spatial-cell-${rowNum}-${colNum}`}
                  >
                    <title>
                      {`${traitName}: ${cell.value.toFixed(3)}\n` +
                        `Row ${rowNum}, Col ${colNum}` +
                        (cell.accession_name ? `\n${cell.accession_name}` : "") +
                        (cell.plot_number != null ? `\nPlot ${cell.plot_number}` : "")}
                    </title>
                  </rect>
                  <text
                    x={cx + CELL / 2}
                    y={cy + CELL / 2 + 3}
                    textAnchor="middle"
                    fill={fg}
                    className="pointer-events-none text-[10px]"
                  >
                    {cell.value.toFixed(1)}
                  </text>
                </g>
              )
            }),
          )}
        </svg>
      </div>
      <Legend min={site.value_min} max={site.value_max} />
    </div>
  )
}

function Legend({ min, max }: { min: number; max: number }) {
  const stops = useMemo(
    () =>
      Array.from({ length: 6 }, (_, i) => i / 5).map((t) => ({
        t,
        color: sequentialColor(t),
      })),
    [],
  )
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{min.toFixed(2)}</span>
      <div className="flex h-3 w-40 overflow-hidden rounded">
        {stops.map((s) => (
          <div key={s.t} className="flex-1" style={{ background: s.color }} />
        ))}
      </div>
      <span className="text-xs text-muted-foreground">{max.toFixed(2)}</span>
    </div>
  )
}
