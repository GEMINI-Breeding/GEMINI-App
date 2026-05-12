import { useMemo, useState } from "react"

import type { GGEResponse } from "../lib/multivariate"
import { linearScale } from "../lib/svg"

interface Props {
  response: GGEResponse
}

const WIDTH = 640
const HEIGHT = 480
const PAD = { left: 64, right: 16, top: 16, bottom: 56 }

export function GgeBiplot({ response }: Props) {
  const [showPolygon, setShowPolygon] = useState(true)

  if (response.status !== "ok") {
    return (
      <p className="text-sm text-muted-foreground" data-testid="mv-gge-empty">
        {response.message ?? "No GGE results available."}
      </p>
    )
  }

  // Joint extent across genotype + env scores so both fit the frame.
  const allX = [
    ...response.accession_scores.map((s) => s.pc1),
    ...response.env_scores.map((s) => s.pc1),
    0,
  ]
  const allY = [
    ...response.accession_scores.map((s) => s.pc2),
    ...response.env_scores.map((s) => s.pc2),
    0,
  ]
  const xMin = Math.min(...allX)
  const xMax = Math.max(...allX)
  const yMin = Math.min(...allY)
  const yMax = Math.max(...allY)
  const xPad = (xMax - xMin) * 0.1 || 1
  const yPad = (yMax - yMin) * 0.1 || 1
  const xScale = linearScale({
    domain: [xMin - xPad, xMax + xPad],
    range: [PAD.left, WIDTH - PAD.right],
  })
  const yScale = linearScale({
    domain: [yMin - yPad, yMax + yPad],
    range: [HEIGHT - PAD.bottom, PAD.top],
  })

  const polygonPath = useMemo(() => {
    if (!showPolygon || response.polygon.length < 3) return null
    const byName = new Map(
      response.accession_scores.map((s) => [s.name, s]),
    )
    const pts = response.polygon
      .map((n) => byName.get(n))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
    if (pts.length < 3) return null
    return (
      pts
        .map((p, i) => {
          const cmd = i === 0 ? "M" : "L"
          return `${cmd}${xScale(p.pc1).toFixed(2)},${yScale(p.pc2).toFixed(2)}`
        })
        .join(" ") + " Z"
    )
  }, [response.polygon, response.accession_scores, showPolygon, xScale, yScale])

  const evr = response.explained_variance_ratio
  const pc1Pct = evr[0] != null ? (evr[0] * 100).toFixed(1) : "—"
  const pc2Pct = evr[1] != null ? (evr[1] * 100).toFixed(1) : "—"

  return (
    <section className="flex flex-col gap-3" data-testid="mv-gge">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted-foreground">
          {response.trait_name} · {response.n_accessions} accessions ×{" "}
          {response.n_envs} envs · PC1 {pc1Pct}% · PC2 {pc2Pct}%
        </span>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            className="accent-primary h-4 w-4"
            checked={showPolygon}
            onChange={(e) => setShowPolygon(e.target.checked)}
            data-testid="mv-gge-polygon-toggle"
          />
          Show which-won-where polygon
        </label>
      </div>
      <svg
        width={WIDTH}
        height={HEIGHT}
        className="rounded-md border bg-background"
        data-testid="mv-gge-svg"
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

        {/* Which-won-where polygon */}
        {polygonPath && (
          <path
            d={polygonPath}
            fill="none"
            stroke="#0f172a"
            strokeOpacity={0.5}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            data-testid="mv-gge-polygon"
          />
        )}

        {/* Env vectors (arrows from origin) */}
        {response.env_scores.map((e) => {
          const x1 = xScale(e.pc1)
          const y1 = yScale(e.pc2)
          const x0 = xScale(0)
          const y0 = yScale(0)
          return (
            <g key={`env-${e.name}`} data-testid={`mv-gge-env-${e.name}`}>
              <line
                x1={x0}
                y1={y0}
                x2={x1}
                y2={y1}
                stroke="#2563eb"
                strokeOpacity={0.85}
                strokeWidth={1.4}
                markerEnd="url(#mv-gge-arrow)"
              />
              <text
                x={x1 + (x1 >= x0 ? 4 : -4)}
                y={y1 + (y1 >= y0 ? 12 : -4)}
                textAnchor={x1 >= x0 ? "start" : "end"}
                className="fill-foreground text-[10px] font-medium"
              >
                {e.name}
              </text>
            </g>
          )
        })}

        {/* Accession points */}
        {response.accession_scores.map((s) => (
          <g
            key={`acc-${s.name}`}
            data-testid={`mv-gge-acc-${s.name}`}
          >
            <circle
              cx={xScale(s.pc1)}
              cy={yScale(s.pc2)}
              r={4}
              fill="#dc2626"
              fillOpacity={0.7}
              stroke="white"
              strokeWidth={0.5}
            >
              <title>
                {`${s.name}\nPC1 = ${s.pc1.toFixed(2)}, PC2 = ${s.pc2.toFixed(2)}`}
              </title>
            </circle>
            <text
              x={xScale(s.pc1) + 6}
              y={yScale(s.pc2) - 5}
              className="fill-foreground text-[10px]"
            >
              {s.name}
            </text>
          </g>
        ))}

        {/* Axis labels */}
        <text
          x={WIDTH / 2}
          y={HEIGHT - 18}
          textAnchor="middle"
          className="fill-foreground text-xs"
        >
          PC1 ({pc1Pct}% var.)
        </text>
        <text
          x={14}
          y={HEIGHT / 2}
          textAnchor="middle"
          transform={`rotate(-90, 14, ${HEIGHT / 2})`}
          className="fill-foreground text-xs"
        >
          PC2 ({pc2Pct}% var.)
        </text>

        <defs>
          <marker
            id="mv-gge-arrow"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M0,0 L8,4 L0,8 z" fill="#2563eb" fillOpacity={0.85} />
          </marker>
        </defs>
      </svg>
      <div className="flex gap-4 text-xs">
        <div className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-full bg-[#dc2626] opacity-70" />
          <span>Accession (genotype score)</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm bg-[#2563eb] opacity-85" />
          <span>Environment vector</span>
        </div>
      </div>
    </section>
  )
}
