// Shared helpers for rendering ANOVA / MANOVA results with visual cues:
// significance chips on p-values, Cohen-style shading on effect sizes,
// and a one-line verdict per panel. Pure functions — tested in
// significance.test.ts.

export type SigLevel = "highly" | "very" | "sig" | "marginal" | "ns" | "na"

export function pSigLevel(p: number | null | undefined): SigLevel {
  if (p == null || Number.isNaN(p)) return "na"
  if (p < 0.001) return "highly"
  if (p < 0.01) return "very"
  if (p < 0.05) return "sig"
  if (p < 0.1) return "marginal"
  return "ns"
}

export function pStars(p: number | null | undefined): string {
  switch (pSigLevel(p)) {
    case "highly":
      return "***"
    case "very":
      return "**"
    case "sig":
      return "*"
    case "marginal":
      return "."
    default:
      return ""
  }
}

// Green ramp for significance ("more colour = stronger signal"); gray for
// non-significant; muted slate for missing/undefined. Class strings are
// Tailwind utilities, used as a self-contained chip.
const P_CHIP: Record<SigLevel, string> = {
  highly: "bg-emerald-200 text-emerald-900 border-emerald-400",
  very: "bg-emerald-100 text-emerald-900 border-emerald-300",
  sig: "bg-emerald-50 text-emerald-800 border-emerald-200",
  marginal: "bg-slate-100 text-slate-700 border-slate-300",
  ns: "bg-slate-100 text-slate-500 border-slate-200",
  na: "bg-muted text-muted-foreground border-muted",
}

export function pChipClass(p: number | null | undefined): string {
  return P_CHIP[pSigLevel(p)]
}

export function pChipClassFromLevel(level: SigLevel): string {
  return P_CHIP[level]
}

export type EffectSize = "trivial" | "small" | "medium" | "large" | "na"

// Cohen-style thresholds for η² (and partial η²). Pillai's trace on a
// 1-df term shares the same 0..1 scale, so we reuse these for the
// multivariate verdict when n_groups==2 (df_num==1); for higher-df terms
// we leave the value un-shaded since Pillai is no longer bounded at 1.
export function effectSizeLevel(eta: number | null | undefined): EffectSize {
  if (eta == null || Number.isNaN(eta)) return "na"
  if (eta < 0.01) return "trivial"
  if (eta < 0.06) return "small"
  if (eta < 0.14) return "medium"
  return "large"
}

// Pin a dark text color so the light sky background stays readable when
// the surrounding theme is dark (table cells otherwise inherit the
// page's light foreground).
const ETA_SHADE: Record<EffectSize, string> = {
  trivial: "",
  small: "bg-sky-50 text-sky-900",
  medium: "bg-sky-100 text-sky-900",
  large: "bg-sky-200 text-sky-900",
  na: "",
}

export function etaShadeClass(eta: number | null | undefined): string {
  return ETA_SHADE[effectSizeLevel(eta)]
}

// Plain-English label for a statsmodels formula term, used in verdict
// chips ("Accession × Env: *** large"). Anything we don't recognise is
// passed through with C(...) and colons stripped.
export function prettyTerm(term: string): string {
  if (term === "Residual") return "Residual"
  if (term === "C(accession_name)") return "Accession"
  if (term === "C(_env)") return "Env"
  if (term === "C(accession_name):C(_env)") return "Accession × Env"
  return term
    .replace(/C\(([^)]+)\)/g, "$1")
    .replace(/:/g, " × ")
    .replace(/_env/g, "Env")
}

export interface VerdictChip {
  term: string
  label: string
  stars: string
  sigLevel: SigLevel
  effect: EffectSize
  /** Optional numeric to display after stars; null = none. */
  effectValue: number | null
  effectKind: "eta" | "pillai" | null
}

export function buildAnovaVerdict(
  terms: { term: string; p: number | null; eta_sq: number | null }[],
): VerdictChip[] {
  return terms
    .filter((t) => t.term !== "Residual")
    .map((t) => {
      const sigLevel = pSigLevel(t.p)
      const effect = effectSizeLevel(t.eta_sq)
      return {
        term: t.term,
        label: prettyTerm(t.term),
        stars: pStars(t.p),
        sigLevel,
        effect,
        effectValue: t.eta_sq,
        effectKind: t.eta_sq == null ? null : "eta",
      }
    })
}

export function buildManovaVerdict(
  terms: Record<string, { name: string; value: number; p: number | null }[]>,
): VerdictChip[] {
  // We summarise with Pillai's trace — it's the most robust of the four
  // and is the conventional default in stats packages.
  const out: VerdictChip[] = []
  for (const [term, stats] of Object.entries(terms)) {
    const pillai =
      stats.find((s) => s.name.toLowerCase().includes("pillai")) ?? stats[0]
    if (!pillai) continue
    out.push({
      term,
      label: prettyTerm(term),
      stars: pStars(pillai.p),
      sigLevel: pSigLevel(pillai.p),
      // Pillai's trace is bounded 0..1 only when the term has 1 df; we
      // still display the raw value for transparency, but only shade
      // when reusing the η² thresholds makes sense.
      effect: effectSizeLevel(pillai.value),
      effectValue: pillai.value,
      effectKind: "pillai",
    })
  }
  return out
}
