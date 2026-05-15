import { useMemo } from "react"

import type { AnovaPanel, AnovaResponse } from "../lib/multivariate"
import {
  buildAnovaVerdict,
  etaShadeClass,
  pChipClass,
  pChipClassFromLevel,
  prettyTerm,
  pStars,
  type VerdictChip,
} from "../lib/significance"

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
      <p className="text-sm text-muted-foreground" data-testid="mv-anova-empty">
        {response.message ?? "No ANOVA results available."}
      </p>
    )
  }

  return (
    <section className="flex flex-col gap-6" data-testid="mv-anova">
      <p className="text-xs text-muted-foreground">
        F-statistics are computed on per-plot aggregated values, not on raw
        timestamps. Type II SS used for two-way models. Significance: ***
        p&lt;0.001, ** p&lt;0.01, * p&lt;0.05, . p&lt;0.1. Effect size (η²)
        shaded by Cohen thresholds: small ≥ 0.01, medium ≥ 0.06, large ≥ 0.14.
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
  const verdict = buildAnovaVerdict(panel.terms)
  return (
    <div
      className="flex flex-col gap-2 rounded-md border p-3"
      data-testid={`mv-anova-panel-${panel.kind}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-medium">
          {panel.kind === "two_way"
            ? "Two-way (accession × env)"
            : panel.env_label}
        </h4>
        <span className="text-xs text-muted-foreground">
          n = {panel.n_obs} · {panel.n_groups} accessions
        </span>
      </div>
      {verdict.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="mv-anova-verdict">
          {verdict.map((chip) => (
            <VerdictChipView key={chip.term} chip={chip} />
          ))}
        </div>
      )}
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
                <td className="pr-4">{prettyTerm(t.term)}</td>
                <td className="pr-4 tabular-nums">{t.df.toFixed(0)}</td>
                <td className="pr-4 tabular-nums">{t.sum_sq.toFixed(3)}</td>
                <td className="pr-4 tabular-nums">{t.mean_sq.toFixed(3)}</td>
                <td className="pr-4 tabular-nums">
                  {t.F == null ? "—" : t.F.toFixed(3)}
                </td>
                <td className="pr-4">
                  {t.p == null ? (
                    "—"
                  ) : (
                    <span
                      className={`inline-flex items-center gap-1 rounded border px-1.5 py-[1px] tabular-nums ${pChipClass(t.p)}`}
                      data-testid={`mv-anova-p-${t.term}`}
                    >
                      {formatP(t.p)}
                      {pStars(t.p) && (
                        <span className="text-[10px] font-semibold">
                          {pStars(t.p)}
                        </span>
                      )}
                    </span>
                  )}
                </td>
                <td
                  className={`pr-4 tabular-nums ${
                    t.term === "Residual" ? "" : etaShadeClass(t.eta_sq)
                  }`}
                  data-testid={`mv-anova-eta-${t.term}`}
                >
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

function VerdictChipView({ chip }: { chip: VerdictChip }) {
  const effectLabel =
    chip.effectValue == null
      ? null
      : chip.effectKind === "eta"
        ? `η²=${chip.effectValue.toFixed(2)}`
        : `Pillai=${chip.effectValue.toFixed(2)}`
  const statusLabel =
    chip.stars ||
    (chip.sigLevel === "ns" ? "ns" : chip.sigLevel === "na" ? "—" : "")
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-[2px] text-xs ${pChipClassFromLevel(chip.sigLevel)}`}
      data-testid={`mv-anova-verdict-${chip.term}`}
    >
      <span className="font-medium">{chip.label}</span>
      {statusLabel && (
        <span className="text-[10px] font-semibold">{statusLabel}</span>
      )}
      {effectLabel && (
        <span
          className={`rounded px-1 text-[10px] tabular-nums ${
            chip.effectKind === "eta" ? etaShadeClass(chip.effectValue) : ""
          }`}
        >
          {effectLabel}
        </span>
      )}
    </span>
  )
}

function formatP(p: number): string {
  if (p < 1e-4) return p.toExponential(2)
  return p.toFixed(4)
}
