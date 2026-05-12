import { useMemo, useState } from "react"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import type {
  CorrelationMatrix,
  CorrelationResponse,
  MatrixResponse,
} from "../lib/multivariate"
import { divergingColor, linearScale, textOn } from "../lib/svg"

interface Props {
  matrix: MatrixResponse
  correlation: CorrelationResponse
}

type Method = "pearson" | "spearman"

const CELL = 56
const LABEL_PAD = 140
const TOP_PAD = 28

export function CorrelationHeatmap({ matrix, correlation }: Props) {
  const [method, setMethod] = useState<Method>("pearson")
  const [drill, setDrill] = useState<{ i: number; j: number } | null>(null)

  const m: CorrelationMatrix | null | undefined =
    method === "pearson" ? correlation.pearson : correlation.spearman

  if (!m) {
    return (
      <p className="text-sm text-muted-foreground">
        No {method} matrix available.
      </p>
    )
  }

  const n = m.trait_names.length
  const width = LABEL_PAD + n * CELL + 16
  const height = TOP_PAD + LABEL_PAD + n * CELL + 16

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium">Correlation method</label>
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={method}
          onChange={(e) => setMethod(e.target.value as Method)}
          data-testid="mv-correlation-method"
        >
          <option value="pearson">Pearson</option>
          <option value="spearman">Spearman</option>
        </select>
        <span className="text-xs text-muted-foreground">
          {correlation.n_rows} plot{correlation.n_rows === 1 ? "" : "s"} after
          aggregation
        </span>
      </div>

      <div className="overflow-auto rounded-md border" data-testid="mv-heatmap">
        <svg width={width} height={height}>
          {m.trait_names.map((name, j) => {
            // Pivot at the top-left of each column's cell strip; text starts
            // at pivot and rotates -45° so labels read up-and-to-the-right.
            const px = LABEL_PAD + j * CELL + CELL / 2
            const py = TOP_PAD + LABEL_PAD - 4
            return (
              <text
                key={`col-${name}`}
                x={px}
                y={py}
                textAnchor="start"
                transform={`rotate(-45, ${px}, ${py})`}
                className="fill-foreground text-xs"
              >
                {name}
              </text>
            )
          })}
          {m.trait_names.map((name, i) => (
            <text
              key={`row-${name}`}
              x={LABEL_PAD - 6}
              y={TOP_PAD + LABEL_PAD + i * CELL + CELL / 2 + 4}
              textAnchor="end"
              className="fill-foreground text-xs"
            >
              {name}
            </text>
          ))}
          {m.matrix.flatMap((row, i) =>
            row.map((value, j) => {
              const cx = LABEL_PAD + j * CELL
              const cy = TOP_PAD + LABEL_PAD + i * CELL
              const bg = value == null ? "#eee" : divergingColor(value)
              const fg = value == null ? "#666" : textOn(bg)
              return (
                <g key={`${i}-${j}`}>
                  <rect
                    x={cx}
                    y={cy}
                    width={CELL}
                    height={CELL}
                    fill={bg}
                    stroke="#fff"
                    strokeWidth={1}
                    onClick={() => {
                      if (i !== j && value != null) setDrill({ i, j })
                    }}
                    style={{
                      cursor: i !== j && value != null ? "pointer" : "default",
                    }}
                    data-testid={`mv-cell-${i}-${j}`}
                  >
                    <title>
                      {`${m.trait_names[i]} × ${m.trait_names[j]}\n` +
                        (value == null
                          ? "n/a"
                          : `${method === "pearson" ? "r" : "ρ"} = ${value.toFixed(3)}, n = ${m.n[i][j]}`)}
                    </title>
                  </rect>
                  <text
                    x={cx + CELL / 2}
                    y={cy + CELL / 2 + 4}
                    textAnchor="middle"
                    fill={fg}
                    className="pointer-events-none text-xs"
                  >
                    {value == null ? "" : value.toFixed(2)}
                  </text>
                </g>
              )
            }),
          )}
        </svg>
      </div>

      <Legend />

      <Dialog
        open={drill !== null}
        onOpenChange={(open) => !open && setDrill(null)}
      >
        <DialogContent className="max-w-2xl">
          {drill && (
            <ScatterDrill
              matrix={matrix}
              traitX={m.trait_names[drill.j]}
              traitY={m.trait_names[drill.i]}
              corr={m.matrix[drill.i][drill.j]}
              method={method}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}

function Legend() {
  const stops = useMemo(
    () => [-1, -0.5, 0, 0.5, 1].map((v) => ({ v, color: divergingColor(v) })),
    [],
  )
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">−1</span>
      <div className="flex h-3 w-48 overflow-hidden rounded">
        {stops.map((s) => (
          <div
            key={s.v}
            className="flex-1"
            style={{ background: s.color }}
            title={s.v.toString()}
          />
        ))}
      </div>
      <span className="text-xs text-muted-foreground">+1</span>
    </div>
  )
}

interface ScatterProps {
  matrix: MatrixResponse
  traitX: string
  traitY: string
  corr: number | null
  method: Method
}

function ScatterDrill({ matrix, traitX, traitY, corr, method }: ScatterProps) {
  const pairs: { x: number; y: number; label: string | null }[] = []
  for (const row of matrix.rows) {
    const xv = row.values[traitX]
    const yv = row.values[traitY]
    if (xv == null || yv == null) continue
    pairs.push({
      x: xv,
      y: yv,
      label: row.accession_name ?? row.plot_id ?? null,
    })
  }

  const width = 560
  const height = 420
  const pad = { left: 56, right: 16, top: 16, bottom: 48 }

  if (pairs.length < 2) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>
            {traitY} vs {traitX}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Not enough complete pairs to plot.
        </p>
      </>
    )
  }

  const xMin = Math.min(...pairs.map((p) => p.x))
  const xMax = Math.max(...pairs.map((p) => p.x))
  const yMin = Math.min(...pairs.map((p) => p.y))
  const yMax = Math.max(...pairs.map((p) => p.y))
  const xPad = (xMax - xMin) * 0.05 || 1
  const yPad = (yMax - yMin) * 0.05 || 1
  const xScale = linearScale({
    domain: [xMin - xPad, xMax + xPad],
    range: [pad.left, width - pad.right],
  })
  const yScale = linearScale({
    domain: [yMin - yPad, yMax + yPad],
    range: [height - pad.bottom, pad.top],
  })

  // OLS regression for the fitted line
  const n = pairs.length
  const meanX = pairs.reduce((s, p) => s + p.x, 0) / n
  const meanY = pairs.reduce((s, p) => s + p.y, 0) / n
  const sxx = pairs.reduce((s, p) => s + (p.x - meanX) ** 2, 0)
  const sxy = pairs.reduce((s, p) => s + (p.x - meanX) * (p.y - meanY), 0)
  const slope = sxx === 0 ? 0 : sxy / sxx
  const intercept = meanY - slope * meanX
  const lineX0 = xMin - xPad
  const lineX1 = xMax + xPad
  const r2 = corr == null ? null : corr * corr

  return (
    <>
      <DialogHeader>
        <DialogTitle data-testid="mv-scatter-title">
          {traitY} vs {traitX}
        </DialogTitle>
      </DialogHeader>
      <div className="flex flex-col gap-2">
        <div className="text-sm text-muted-foreground">
          n = {n}
          {corr != null && (
            <>
              {" · "}
              {method === "pearson" ? "r" : "ρ"} = {corr.toFixed(3)}
              {r2 != null && method === "pearson" && (
                <> · r² = {r2.toFixed(3)}</>
              )}
            </>
          )}
        </div>
        <svg
          width={width}
          height={height}
          className="rounded-md border bg-background"
          data-testid="mv-scatter-svg"
        >
          {/* axes */}
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={height - pad.bottom}
            y2={height - pad.bottom}
            stroke="currentColor"
            strokeOpacity={0.4}
          />
          <line
            x1={pad.left}
            x2={pad.left}
            y1={pad.top}
            y2={height - pad.bottom}
            stroke="currentColor"
            strokeOpacity={0.4}
          />
          {/* fitted line */}
          <line
            x1={xScale(lineX0)}
            y1={yScale(intercept + slope * lineX0)}
            x2={xScale(lineX1)}
            y2={yScale(intercept + slope * lineX1)}
            stroke="#2563eb"
            strokeWidth={2}
          />
          {pairs.map((p, i) => (
            <circle
              key={i}
              cx={xScale(p.x)}
              cy={yScale(p.y)}
              r={3}
              fill="#1d4ed8"
              fillOpacity={0.6}
            >
              {p.label && <title>{`${p.label}: (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`}</title>}
            </circle>
          ))}
          {/* axis labels */}
          <text
            x={width / 2}
            y={height - 12}
            textAnchor="middle"
            className="fill-foreground text-xs"
          >
            {traitX}
          </text>
          <text
            x={14}
            y={height / 2}
            textAnchor="middle"
            transform={`rotate(-90, 14, ${height / 2})`}
            className="fill-foreground text-xs"
          >
            {traitY}
          </text>
          {/* tick numbers (corners only — keeps it lightweight) */}
          <text
            x={pad.left}
            y={height - pad.bottom + 14}
            textAnchor="start"
            className="fill-foreground text-[10px]"
          >
            {xMin.toFixed(2)}
          </text>
          <text
            x={width - pad.right}
            y={height - pad.bottom + 14}
            textAnchor="end"
            className="fill-foreground text-[10px]"
          >
            {xMax.toFixed(2)}
          </text>
          <text
            x={pad.left - 4}
            y={height - pad.bottom}
            textAnchor="end"
            className="fill-foreground text-[10px]"
          >
            {yMin.toFixed(2)}
          </text>
          <text
            x={pad.left - 4}
            y={pad.top + 8}
            textAnchor="end"
            className="fill-foreground text-[10px]"
          >
            {yMax.toFixed(2)}
          </text>
        </svg>
      </div>
    </>
  )
}
