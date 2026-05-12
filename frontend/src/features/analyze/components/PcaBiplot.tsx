import { useMemo, useState } from "react"

import type { PCAResponse } from "../lib/multivariate"
import { linearScale } from "../lib/svg"

interface Props {
  response: PCAResponse
}

const WIDTH = 640
const HEIGHT = 480
// Right pad has to accommodate the longest trait-name label that ends up
// at the right edge of the plot (arrows pointing east). Loading arrows
// already shrink to ~85% of the score range, so the label sits 6px past
// that — but with long trait names this still overflows the 16px we used
// to reserve.
const PAD = { left: 64, right: 140, top: 24, bottom: 56 }

// Soft palette for the categorical color encoding (population).
const PALETTE = [
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#65a30d",
  "#ea580c",
  "#6366f1",
]

export function PcaBiplot({ response }: Props) {
  if (response.status !== "ok" || response.scores.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="mv-pca-empty">
        {response.message ?? "No PCA results available."}
      </p>
    )
  }

  const k = response.n_components
  const [xPc, setXPc] = useState(0)
  const [yPc, setYPc] = useState(Math.min(1, k - 1))

  // Color rows by population when available; otherwise single color.
  const populations = useMemo(
    () => [
      ...new Set(
        response.scores
          .map((s) => s.population)
          .filter((p): p is string => !!p),
      ),
    ],
    [response.scores],
  )
  const colorOf = (pop: string | null | undefined): string => {
    if (!pop) return "#475569"
    const idx = populations.indexOf(pop)
    return idx < 0 ? "#475569" : PALETTE[idx % PALETTE.length]
  }

  const xs = response.scores.map((s) => s.components[xPc] ?? 0)
  const ys = response.scores.map((s) => s.components[yPc] ?? 0)
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const yMin = Math.min(...ys)
  const yMax = Math.max(...ys)
  const xPad = (xMax - xMin) * 0.08 || 1
  const yPad = (yMax - yMin) * 0.08 || 1

  const xScale = linearScale({
    domain: [xMin - xPad, xMax + xPad],
    range: [PAD.left, WIDTH - PAD.right],
  })
  const yScale = linearScale({
    domain: [yMin - yPad, yMax + yPad],
    range: [HEIGHT - PAD.bottom, PAD.top],
  })

  // Loading arrows need to share visual scale with the score cloud. Compute
  // a multiplier that brings the longest loading roughly into score-extent
  // territory so users can read both at once.
  const scoreMax = Math.max(
    Math.abs(xMin),
    Math.abs(xMax),
    Math.abs(yMin),
    Math.abs(yMax),
  )
  const loadingMax = Math.max(
    ...response.loadings.map((l) =>
      Math.hypot(l.components[xPc] ?? 0, l.components[yPc] ?? 0),
    ),
  )
  const arrowScale =
    loadingMax > 0 && scoreMax > 0 ? (scoreMax * 0.85) / loadingMax : 1

  return (
    <section className="flex flex-col gap-3" data-testid="mv-pca">
      <div className="flex flex-wrap items-end gap-3">
        <PCAxisSelect
          label="X axis"
          value={xPc}
          onChange={setXPc}
          k={k}
          evr={response.explained_variance_ratio}
          testId="mv-pca-x"
        />
        <PCAxisSelect
          label="Y axis"
          value={yPc}
          onChange={setYPc}
          k={k}
          evr={response.explained_variance_ratio}
          testId="mv-pca-y"
        />
        <span className="text-xs text-muted-foreground">
          {response.row_kind === "accession"
            ? `${response.scores.length} accessions`
            : `${response.scores.length} plots`}{" "}
          · {response.loadings.length} traits
        </span>
      </div>

      <svg
        width={WIDTH}
        height={HEIGHT}
        className="rounded-md border bg-background"
        data-testid="mv-pca-svg"
      >
        {/* Axes through origin */}
        <line
          x1={xScale(0)}
          y1={PAD.top}
          x2={xScale(0)}
          y2={HEIGHT - PAD.bottom}
          stroke="currentColor"
          strokeOpacity={0.15}
        />
        <line
          x1={PAD.left}
          y1={yScale(0)}
          x2={WIDTH - PAD.right}
          y2={yScale(0)}
          stroke="currentColor"
          strokeOpacity={0.15}
        />
        {/* Frame */}
        <line
          x1={PAD.left}
          x2={WIDTH - PAD.right}
          y1={HEIGHT - PAD.bottom}
          y2={HEIGHT - PAD.bottom}
          stroke="currentColor"
          strokeOpacity={0.4}
        />
        <line
          x1={PAD.left}
          x2={PAD.left}
          y1={PAD.top}
          y2={HEIGHT - PAD.bottom}
          stroke="currentColor"
          strokeOpacity={0.4}
        />

        {/* Score points */}
        {response.scores.map((s) => {
          const x = s.components[xPc] ?? 0
          const y = s.components[yPc] ?? 0
          return (
            <circle
              key={s.id}
              cx={xScale(x)}
              cy={yScale(y)}
              r={3.5}
              fill={colorOf(s.population)}
              fillOpacity={0.7}
              stroke="white"
              strokeWidth={0.5}
              data-testid={`mv-pca-point-${s.id}`}
            >
              <title>
                {`${s.label ?? s.id}\nPC${xPc + 1} = ${x.toFixed(2)}, PC${yPc + 1} = ${y.toFixed(2)}` +
                  (s.population ? `\nPopulation: ${s.population}` : "") +
                  (s.experiment_name
                    ? `\nExperiment: ${s.experiment_name}`
                    : "") +
                  (s.site_name ? `\nSite: ${s.site_name}` : "")}
              </title>
            </circle>
          )
        })}

        {/* Loading arrows — drawn on top of score points so they stay
            visible against a dense cloud. */}
        {response.loadings.map((l) => {
          const lx = (l.components[xPc] ?? 0) * arrowScale
          const ly = (l.components[yPc] ?? 0) * arrowScale
          const x0 = xScale(0)
          const y0 = yScale(0)
          const x1 = xScale(lx)
          const y1 = yScale(ly)
          return (
            <g key={l.trait_name} data-testid={`mv-pca-loading-${l.trait_name}`}>
              <line
                x1={x0}
                y1={y0}
                x2={x1}
                y2={y1}
                stroke="#b91c1c"
                strokeWidth={2}
                strokeLinecap="round"
                markerEnd="url(#mv-pca-arrow)"
              />
              <text
                x={x1 + (x1 >= x0 ? 6 : -6)}
                y={y1 + (y1 >= y0 ? 14 : -6)}
                textAnchor={x1 >= x0 ? "start" : "end"}
                className="fill-foreground text-[11px] font-medium"
              >
                {l.trait_name}
              </text>
            </g>
          )
        })}

        {/* Axis tick labels (corners only) */}
        <text
          x={WIDTH / 2}
          y={HEIGHT - 18}
          textAnchor="middle"
          className="fill-foreground text-xs"
        >
          {axisLabel(xPc, response.explained_variance_ratio)}
        </text>
        <text
          x={14}
          y={HEIGHT / 2}
          textAnchor="middle"
          transform={`rotate(-90, 14, ${HEIGHT / 2})`}
          className="fill-foreground text-xs"
        >
          {axisLabel(yPc, response.explained_variance_ratio)}
        </text>

        {/* Arrowhead marker for loading lines */}
        <defs>
          <marker
            id="mv-pca-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="#b91c1c" />
          </marker>
        </defs>
      </svg>

      {populations.length > 0 && <Legend populations={populations} />}

      <Scree evr={response.explained_variance_ratio} />
    </section>
  )
}

function PCAxisSelect({
  label,
  value,
  onChange,
  k,
  evr,
  testId,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  k: number
  evr: number[]
  testId: string
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <select
        className="h-9 w-32 rounded-md border bg-background px-3 text-sm"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        data-testid={testId}
      >
        {Array.from({ length: k }, (_, i) => (
          <option key={i} value={i}>
            PC{i + 1} ({(evr[i] * 100).toFixed(1)}%)
          </option>
        ))}
      </select>
    </div>
  )
}

function axisLabel(pc: number, evr: number[]): string {
  const pct = evr[pc] == null ? 0 : evr[pc] * 100
  return `PC${pc + 1} (${pct.toFixed(1)}% var.)`
}

function Legend({ populations }: { populations: string[] }) {
  return (
    <div className="flex flex-wrap gap-3 text-xs">
      {populations.map((pop, i) => (
        <div key={pop} className="flex items-center gap-1">
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ background: PALETTE[i % PALETTE.length] }}
          />
          <span>{pop}</span>
        </div>
      ))}
    </div>
  )
}

function Scree({ evr }: { evr: number[] }) {
  const w = 320
  const h = 80
  const pad = 18
  const max = Math.max(...evr, 0.001)
  const barW = (w - pad * 2) / evr.length
  return (
    <div className="flex flex-col gap-1" data-testid="mv-pca-scree">
      <span className="text-xs text-muted-foreground">Scree (explained variance)</span>
      <svg width={w} height={h} className="rounded-md border bg-background">
        {evr.map((v, i) => {
          const bh = ((h - pad * 2) * v) / max
          const x = pad + i * barW
          const y = h - pad - bh
          return (
            <g key={i}>
              <rect
                x={x + 2}
                y={y}
                width={barW - 4}
                height={bh}
                fill="#475569"
                fillOpacity={0.7}
              />
              <text
                x={x + barW / 2}
                y={h - pad + 12}
                textAnchor="middle"
                className="fill-foreground text-[10px]"
              >
                PC{i + 1}
              </text>
              <text
                x={x + barW / 2}
                y={y - 2}
                textAnchor="middle"
                className="fill-foreground text-[10px]"
              >
                {(v * 100).toFixed(0)}%
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
