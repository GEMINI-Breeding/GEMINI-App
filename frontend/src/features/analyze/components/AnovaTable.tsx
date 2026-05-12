import { useMemo } from "react"

import type { AnovaPanel, AnovaResponse } from "../lib/multivariate"

interface Props {
  response: AnovaResponse
}

export function AnovaTable({ response }: Props) {
  const byTrait = useMemo(() => {
    const m = new Map<string, AnovaPanel[]>()
    for (const p of response.panels) {
      const list = m.get(p.trait_name) ?? []
      list.push(p)
      m.set(p.trait_name, list)
    }
    return m
  }, [response.panels])

  if (response.status !== "ok" || response.panels.length === 0) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="mv-anova-empty"
      >
        {response.message ?? "No ANOVA results available."}
      </p>
    )
  }

  return (
    <section className="flex flex-col gap-6" data-testid="mv-anova">
      <p className="text-xs text-muted-foreground">
        F-statistics are computed on per-plot aggregated values, not on raw
        timestamps. Type II SS used for two-way models.
      </p>
      {[...byTrait.entries()].map(([trait, panels]) => (
        <div key={trait} className="flex flex-col gap-3">
          <h3 className="text-base font-semibold">{trait}</h3>
          {panels.map((panel, i) => (
            <Panel key={`${trait}-${i}`} panel={panel} />
          ))}
        </div>
      ))}
    </section>
  )
}

function Panel({ panel }: { panel: AnovaPanel }) {
  return (
    <div
      className="flex flex-col gap-2 rounded-md border p-3"
      data-testid={`mv-anova-panel-${panel.kind}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-medium">
          {panel.kind === "two_way" ? "Two-way (accession × env)" : panel.env_label}
        </h4>
        <span className="text-xs text-muted-foreground">
          n = {panel.n_obs} · {panel.n_groups} accessions
        </span>
      </div>
      {panel.replication_status !== "replicated" && (
        <div
          className="rounded-md border border-amber-500 bg-amber-50 p-2 text-xs text-amber-900"
          data-testid="mv-anova-replication-warning"
        >
          {panel.message ??
            (panel.replication_status === "unreplicated"
              ? "No replicates — F undefined."
              : "Not enough data.")}
        </div>
      )}
      {panel.terms.length > 0 && (
        <table className="text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="pr-4 font-normal">Term</th>
              <th className="pr-4 font-normal">df</th>
              <th className="pr-4 font-normal">Sum Sq</th>
              <th className="pr-4 font-normal">Mean Sq</th>
              <th className="pr-4 font-normal">F</th>
              <th className="pr-4 font-normal">p</th>
              <th className="pr-4 font-normal">η²</th>
            </tr>
          </thead>
          <tbody>
            {panel.terms.map((t) => (
              <tr key={t.term} data-testid={`mv-anova-row-${t.term}`}>
                <td className="pr-4">{t.term}</td>
                <td className="pr-4">{t.df.toFixed(0)}</td>
                <td className="pr-4">{t.sum_sq.toFixed(3)}</td>
                <td className="pr-4">{t.mean_sq.toFixed(3)}</td>
                <td className="pr-4">{t.F == null ? "—" : t.F.toFixed(3)}</td>
                <td className="pr-4">{t.p == null ? "—" : formatP(t.p)}</td>
                <td className="pr-4">
                  {t.eta_sq == null ? "—" : t.eta_sq.toFixed(3)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function formatP(p: number): string {
  if (p < 1e-4) return p.toExponential(2)
  return p.toFixed(4)
}
