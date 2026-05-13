import { useMemo, useState } from "react"

import type {
  HeritabilityPanel as HPanel,
  HeritabilityResponse,
} from "../lib/multivariate"

interface Props {
  response: HeritabilityResponse
}

const STATUS_COLOR: Record<HPanel["convergence_status"], string> = {
  ok: "border-green-500 text-green-900 bg-green-50",
  warning: "border-amber-500 text-amber-900 bg-amber-50",
  failed: "border-destructive text-destructive bg-destructive/5",
  unreplicated: "border-amber-500 text-amber-900 bg-amber-50",
  insufficient_data: "border-muted text-muted-foreground bg-muted/40",
}

export function HeritabilityPanel({ response }: Props) {
  if (response.status !== "ok" || response.panels.length === 0) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="mv-heritability-empty"
      >
        {response.message ?? "No heritability results available."}
      </p>
    )
  }

  // Group cards by trait.
  const byTrait = useMemo(() => {
    const m = new Map<string, HPanel[]>()
    for (const p of response.panels) {
      const list = m.get(p.trait_name) ?? []
      list.push(p)
      m.set(p.trait_name, list)
    }
    return m
  }, [response.panels])

  return (
    <section className="flex flex-col gap-6" data-testid="mv-heritability">
      <p className="text-xs text-muted-foreground">
        Broad-sense H² per (trait, env) via REML. H² = σ²_g / (σ²_g + σ²_e /
        mean reps). Per-env only — across-env decomposition is not produced
        from this fit.
      </p>
      {[...byTrait.entries()].map(([trait, panels]) => (
        <div key={trait} className="flex flex-col gap-3">
          <h3 className="text-base font-semibold">{trait}</h3>
          <div className="flex flex-wrap gap-3">
            {panels.map((panel, i) => (
              <Card key={`${trait}-${i}`} panel={panel} />
            ))}
          </div>
        </div>
      ))}
      <BlupsTable panels={response.panels} />
    </section>
  )
}

function Card({ panel }: { panel: HPanel }) {
  // H² is renderable whenever the math actually produced a number — both
  // the REML path and the moment-estimator fallback set panel.h2 when
  // they succeed. Hide the headline number only when the fit truly
  // produced no result (failed / insufficient_data with no h2).
  const hasH2 = panel.h2 != null
  return (
    <div
      className={`flex w-[280px] flex-col gap-1 rounded-md border p-3 ${STATUS_COLOR[panel.convergence_status]}`}
      data-testid={`mv-h2-card-${panel.env_label}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-medium">{panel.env_label}</h4>
        <span className="text-xs whitespace-nowrap">
          n={panel.n_obs} · g={panel.n_groups} · reps≈
          {panel.mean_reps.toFixed(1)}
        </span>
      </div>
      {hasH2 && (
        <>
          <div className="text-2xl font-semibold tabular-nums">
            H² = {(panel.h2 as number).toFixed(3)}
          </div>
          <div className="text-xs">
            σ²_g = {fmt(panel.var_g)} · σ²_e = {fmt(panel.var_e)}
          </div>
        </>
      )}
      {panel.message && (
        <div
          className="text-xs whitespace-pre-line break-words"
          data-testid="mv-h2-card-warning"
        >
          {panel.message}
        </div>
      )}
    </div>
  )
}

function fmt(v: number | null): string {
  if (v == null) return "—"
  if (Math.abs(v) >= 100 || Math.abs(v) < 0.01) return v.toExponential(2)
  return v.toFixed(3)
}

type SortKey = { trait: string; env: string } | null

function BlupsTable({ panels }: { panels: HPanel[] }) {
  const [sortBy, setSortBy] = useState<SortKey>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  // Build a (trait, env) → (accession → blup) lookup, and a stable column
  // ordering (panels with H² estimates first).
  const cols = useMemo(
    () =>
      panels
        .filter((p) => p.blups.length > 0)
        .map((p) => ({
          trait: p.trait_name,
          env: p.env_label,
          key: `${p.trait_name}::${p.env_label}`,
          map: new Map(p.blups.map((b) => [b.accession_name, b.blup])),
        })),
    [panels],
  )
  const accessions = useMemo(() => {
    const s = new Set<string>()
    for (const c of cols) for (const acc of c.map.keys()) s.add(acc)
    return [...s].sort()
  }, [cols])

  if (cols.length === 0 || accessions.length === 0) return null

  const sortedAccessions = (() => {
    if (!sortBy) return accessions
    const col = cols.find((c) => c.trait === sortBy.trait && c.env === sortBy.env)
    if (!col) return accessions
    return [...accessions].sort((a, b) => {
      const va = col.map.get(a)
      const vb = col.map.get(b)
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      return sortDir === "desc" ? vb - va : va - vb
    })
  })()

  function onHeaderClick(trait: string, env: string) {
    if (sortBy && sortBy.trait === trait && sortBy.env === env) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"))
    } else {
      setSortBy({ trait, env })
      setSortDir("desc")
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid="mv-blups-table">
      <h3 className="text-base font-semibold">BLUPs</h3>
      <div className="overflow-auto rounded-md border">
        <table className="text-xs">
          <thead className="bg-muted/40">
            <tr>
              <th className="sticky left-0 bg-muted/40 px-3 py-2 text-left font-medium">
                Accession
              </th>
              {cols.map((c) => {
                const active = sortBy && sortBy.trait === c.trait && sortBy.env === c.env
                return (
                  <th
                    key={c.key}
                    className="cursor-pointer px-3 py-2 text-right font-medium hover:bg-muted"
                    onClick={() => onHeaderClick(c.trait, c.env)}
                    data-testid={`mv-blup-col-${c.trait}`}
                  >
                    <div className="flex flex-col items-end">
                      <span>{c.trait}</span>
                      <span className="text-muted-foreground">{c.env}</span>
                      {active && (
                        <span className="text-[10px] text-muted-foreground">
                          {sortDir === "desc" ? "▼" : "▲"}
                        </span>
                      )}
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sortedAccessions.map((acc) => (
              <tr key={acc} className="odd:bg-background even:bg-muted/20">
                <td className="sticky left-0 bg-inherit px-3 py-1.5 font-medium">
                  {acc}
                </td>
                {cols.map((c) => {
                  const v = c.map.get(acc)
                  return (
                    <td
                      key={c.key}
                      className="px-3 py-1.5 text-right tabular-nums"
                    >
                      {v == null ? "—" : v.toFixed(3)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
