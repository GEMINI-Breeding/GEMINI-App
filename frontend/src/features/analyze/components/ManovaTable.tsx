import type { ManovaPanel, ManovaResponse } from "../lib/multivariate"
import {
  buildManovaVerdict,
  etaShadeClass,
  pChipClass,
  pChipClassFromLevel,
  prettyTerm,
  pStars,
  type VerdictChip,
} from "../lib/significance"

interface Props {
  response: ManovaResponse
}

export function ManovaTable({ response }: Props) {
  if (response.status !== "ok" || response.panels.length === 0) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="mv-manova-empty"
      >
        {response.message ?? "No MANOVA results available."}
      </p>
    )
  }

  return (
    <section className="flex flex-col gap-4" data-testid="mv-manova">
      <p className="text-xs text-muted-foreground">
        MANOVA tests whether group means differ on the trait vector
        simultaneously. Computed on raw per-plot values — replicate collapsing
        would erase within-group variance. Verdict chips use Pillai's trace; all
        four statistics shown in the table below.
      </p>
      <p className="text-xs text-muted-foreground">
        Traits: {response.trait_names.join(", ")}
      </p>
      {response.panels.map((panel, i) => (
        <Panel key={i} panel={panel} />
      ))}
    </section>
  )
}

function Panel({ panel }: { panel: ManovaPanel }) {
  const verdict = buildManovaVerdict(panel.terms)
  return (
    <div
      className="flex flex-col gap-2 rounded-md border p-3"
      data-testid={`mv-manova-panel-${panel.kind}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-medium">
          {panel.kind === "two_way"
            ? "Two-way (accession × env)"
            : panel.env_label}
        </h4>
        <span className="text-xs text-muted-foreground">
          n = {panel.n_obs} · {panel.n_groups} accessions · {panel.n_traits}{" "}
          traits
        </span>
      </div>
      {verdict.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="mv-manova-verdict">
          {verdict.map((chip) => (
            <VerdictChipView key={chip.term} chip={chip} />
          ))}
        </div>
      )}
      {panel.replication_status !== "replicated" && (
        <div
          className="rounded-md border border-amber-500 bg-amber-50 p-2 text-xs text-amber-900"
          data-testid="mv-manova-warning"
        >
          {panel.message ??
            (panel.replication_status === "unreplicated"
              ? "No replicates — MANOVA undefined."
              : "Not enough data.")}
        </div>
      )}
      {Object.entries(panel.terms).map(([term, stats]) => (
        <div key={term} className="flex flex-col gap-1">
          <div className="text-xs font-medium">{prettyTerm(term)}</div>
          <table className="text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="pr-4 font-normal">Test</th>
                <th className="pr-4 font-normal">Value</th>
                <th className="pr-4 font-normal">df num</th>
                <th className="pr-4 font-normal">df denom</th>
                <th className="pr-4 font-normal">F</th>
                <th className="pr-4 font-normal">p</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => {
                const isPillai = s.name.toLowerCase().includes("pillai")
                return (
                  <tr key={s.name} data-testid={`mv-manova-row-${s.name}`}>
                    <td className="pr-4">{s.name}</td>
                    <td
                      className={`pr-4 tabular-nums ${
                        isPillai ? etaShadeClass(s.value) : ""
                      }`}
                    >
                      {fmt(s.value)}
                    </td>
                    <td className="pr-4 tabular-nums">{s.df_num.toFixed(0)}</td>
                    <td className="pr-4 tabular-nums">
                      {s.df_denom.toFixed(1)}
                    </td>
                    <td className="pr-4 tabular-nums">
                      {s.F == null ? "—" : s.F.toFixed(3)}
                    </td>
                    <td className="pr-4">
                      {s.p == null ? (
                        "—"
                      ) : (
                        <span
                          className={`inline-flex items-center gap-1 rounded border px-1.5 py-[1px] tabular-nums ${pChipClass(s.p)}`}
                          data-testid={`mv-manova-p-${term}-${s.name}`}
                        >
                          {formatP(s.p)}
                          {pStars(s.p) && (
                            <span className="text-[10px] font-semibold">
                              {pStars(s.p)}
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

function VerdictChipView({ chip }: { chip: VerdictChip }) {
  const effectLabel =
    chip.effectValue == null ? null : `Pillai=${chip.effectValue.toFixed(2)}`
  const statusLabel =
    chip.stars ||
    (chip.sigLevel === "ns" ? "ns" : chip.sigLevel === "na" ? "—" : "")
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-[2px] text-xs ${pChipClassFromLevel(chip.sigLevel)}`}
      data-testid={`mv-manova-verdict-${chip.term}`}
    >
      <span className="font-medium">{chip.label}</span>
      {statusLabel && (
        <span className="text-[10px] font-semibold">{statusLabel}</span>
      )}
      {effectLabel && (
        <span
          className={`rounded px-1 text-[10px] tabular-nums ${etaShadeClass(chip.effectValue)}`}
        >
          {effectLabel}
        </span>
      )}
    </span>
  )
}

function fmt(v: number): string {
  if (Math.abs(v) >= 100 || (Math.abs(v) > 0 && Math.abs(v) < 0.01)) {
    return v.toExponential(2)
  }
  return v.toFixed(4)
}

function formatP(p: number): string {
  if (p < 1e-4) return p.toExponential(2)
  return p.toFixed(4)
}
