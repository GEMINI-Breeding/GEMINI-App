/**
 * AnalysisWidget — one Analyze-tab view on the dashboard (summary, traits
 * over the season, trait correlations, heritability, field map), computed
 * from the experiment's current trait data each time it is shown.
 *
 * Every view leads with a sentence saying what it shows, then the detail.
 */
import { useQuery } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import type { TraitRecord } from "@/features/analyze/api"
import { CorrelationHeatmap } from "@/features/analyze/components/CorrelationHeatmap"
import { HeritabilityPanel } from "@/features/analyze/components/HeritabilityPanel"
import { SpatialHeatmap } from "@/features/analyze/components/SpatialHeatmap"
import {
  type CorrelationResponse,
  fetchCorrelation,
  fetchHeritability,
  fetchMatrix,
  fetchSpatial,
  type MultivariateRequest,
} from "@/features/analyze/lib/multivariate"
import { useTraitRecords } from "../hooks/useTraitData"
import type { AnalysisConfig } from "../types"

/** The experiment's trait records (one per site, population and date). */
export function experimentRecords(
  records: TraitRecord[] | undefined,
  experiment: string,
): TraitRecord[] {
  return (records ?? []).filter((r) => r.experiment === experiment)
}

export function traitsOf(records: TraitRecord[]): string[] {
  return [...new Set(records.flatMap((r) => r.trait_columns))].sort()
}

export function datesOf(records: TraitRecord[]): string[] {
  return [...new Set(records.map((r) => r.date))].sort()
}

async function inBatches<T, R>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size)
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))))
  return out
}

function request(
  config: AnalysisConfig,
  traits: string[],
  extra: Partial<MultivariateRequest> = {},
): MultivariateRequest {
  return {
    trait_names: traits,
    experiment_names: [config.experiment],
    aggregation: "mean",
    ...extra,
  }
}

function strength(r: number): string {
  const a = Math.abs(r)
  const word = a >= 0.6 ? "strongly" : a >= 0.3 ? "moderately" : "weakly"
  return r > 0 ? `${word} rise together` : `${word} move in opposite directions`
}

/** The strongest trait pairs, in words. */
export function correlationSentence(c: CorrelationResponse): string {
  const p = c.pearson
  if (!p) return "Not enough plots with two traits measured to compare them."
  const pairs: { a: string; b: string; r: number; n: number }[] = []
  for (let i = 0; i < p.trait_names.length; i++)
    for (let j = i + 1; j < p.trait_names.length; j++) {
      const r = p.matrix[i][j]
      if (r != null)
        pairs.push({
          a: p.trait_names[i],
          b: p.trait_names[j],
          r,
          n: p.n?.[i]?.[j] ?? 0,
        })
    }
  pairs.sort((x, y) => Math.abs(y.r) - Math.abs(x.r))
  if (pairs.length === 0)
    return "Not enough plots with two traits measured to compare them."
  return pairs
    .slice(0, 3)
    .map(
      (x) =>
        `${x.a} and ${x.b} ${strength(x.r)} (r = ${x.r.toFixed(2)}${x.n ? `, ${x.n} plots` : ""})`,
    )
    .join("; ")
    .concat(".")
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-sm">{children}</p>
}

function Waiting() {
  return (
    <div className="flex h-24 items-center justify-center text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
    </div>
  )
}

function Failed({ error }: { error: unknown }) {
  return (
    <p className="text-sm text-muted-foreground">
      Could not compute this view:{" "}
      {error instanceof Error ? error.message : String(error)}
    </p>
  )
}

// ── views ───────────────────────────────────────────────────────────────────

function Summary({ records }: { records: TraitRecord[] }) {
  const dates = datesOf(records)
  const traits = traitsOf(records)
  const plots = Math.max(0, ...records.map((r) => r.plot_count))
  const sites = new Set(records.map((r) => r.location).filter(Boolean))
  const items: [string, string | number][] = [
    ["Plots", plots],
    ["Collection dates", dates.length],
    ["Traits", traits.length],
    ["Sites", sites.size || 1],
  ]
  return (
    <div>
      <Note>
        {dates.length > 0
          ? `Measured on ${dates.length} date${dates.length === 1 ? "" : "s"}, ${dates[0]}${dates.length > 1 ? ` to ${dates[dates.length - 1]}` : ""}.`
          : "No trait data yet."}
      </Note>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {items.map(([label, value]) => (
          <div key={label} className="rounded-md border p-3">
            <div className="text-2xl font-semibold">{value}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Trend({
  config,
  records,
}: {
  config: AnalysisConfig
  records: TraitRecord[]
}) {
  const dates = datesOf(records).slice(-12)
  const traits = (
    config.traits.length ? config.traits : traitsOf(records)
  ).slice(0, 6)
  const q = useQuery({
    queryKey: ["dash-trend", config.experiment, traits, dates],
    enabled: dates.length > 0 && traits.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      // Two dates at a time: a dozen at once would fill the browser's few
      // connections to the server and hold up everything else on the page.
      const rows = await inBatches(dates, 2, async (d) => {
        const m = await fetchMatrix(
          request(config, traits, {
            aggregation: "date",
            aggregation_date: d,
          }),
        )
        const point: Record<string, number | string | null> = { date: d }
        for (const t of traits) {
          const v = m.rows
            .map((r) => r.values[t])
            .filter((x): x is number => typeof x === "number")
          point[t] = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
        }
        return point
      })
      return rows
    },
  })
  if (dates.length < 2)
    return (
      <Note>
        One collection date so far; the season's trend appears after the next.
      </Note>
    )
  if (q.isLoading) return <Waiting />
  if (q.error) return <Failed error={q.error} />
  const data = q.data ?? []
  const change = (t: string) => {
    const vals = data
      .map((p) => p[t])
      .filter((x): x is number => typeof x === "number")
    if (vals.length < 2 || vals[0] === 0) return null
    return ((vals[vals.length - 1] - vals[0]) / Math.abs(vals[0])) * 100
  }
  const moves = traits
    .map((t) => ({ t, c: change(t) }))
    .filter((x): x is { t: string; c: number } => x.c != null)
    .sort((a, b) => Math.abs(b.c) - Math.abs(a.c))
  return (
    <div>
      <Note>
        {moves.length
          ? `Plot means from ${dates[0]} to ${dates[dates.length - 1]}: ` +
            moves
              .slice(0, 3)
              .map(
                (m) =>
                  `${m.t} ${m.c >= 0 ? "up" : "down"} ${Math.abs(m.c).toFixed(0)}%`,
              )
              .join(", ") +
            "."
          : "Plot means per collection date."}
      </Note>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {traits.map((t) => (
          <div key={t} className="rounded-md border p-2">
            <div className="mb-1 truncate text-xs font-medium">{t}</div>
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} width={40} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey={t}
                  stroke="hsl(var(--primary))"
                  dot
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>
    </div>
  )
}

function Correlation({
  config,
  records,
}: {
  config: AnalysisConfig
  records: TraitRecord[]
}) {
  const traits = config.traits.length ? config.traits : traitsOf(records)
  const q = useQuery({
    queryKey: ["dash-corr", config.experiment, traits],
    enabled: traits.length >= 2,
    staleTime: 60_000,
    queryFn: async () => {
      const req = request(config, traits, { collapse_replicates: true })
      const [matrix, correlation] = await Promise.all([
        fetchMatrix(req),
        fetchCorrelation(req),
      ])
      return { matrix, correlation }
    },
  })
  if (traits.length < 2)
    return <Note>Correlations need two or more traits; this has one.</Note>
  if (q.isLoading) return <Waiting />
  if (q.error) return <Failed error={q.error} />
  if (!q.data || q.data.matrix.status !== "ok")
    return <Note>{q.data?.matrix.message || "Not enough data yet."}</Note>
  return (
    <div>
      <Note>{correlationSentence(q.data.correlation)}</Note>
      <CorrelationHeatmap
        matrix={q.data.matrix}
        correlation={q.data.correlation}
      />
    </div>
  )
}

function Heritability({
  config,
  records,
}: {
  config: AnalysisConfig
  records: TraitRecord[]
}) {
  const traits = config.traits.length ? config.traits : traitsOf(records)
  const q = useQuery({
    queryKey: ["dash-h2", config.experiment, traits],
    enabled: traits.length > 0,
    staleTime: 60_000,
    queryFn: () => fetchHeritability(request(config, traits)),
  })
  if (q.isLoading) return <Waiting />
  if (q.error) return <Failed error={q.error} />
  if (!q.data) return null
  const ok = q.data.panels
    .filter((p) => p.h2 != null)
    .sort((a, b) => (b.h2 ?? 0) - (a.h2 ?? 0))
  return (
    <div>
      <Note>
        {ok.length
          ? `Most genetic: ${ok
              .slice(0, 3)
              .map((p) => `${p.trait_name} (${(p.h2 ?? 0).toFixed(2)})`)
              .join(
                ", ",
              )}. Traits near 0 mostly reflect field or measurement noise.`
          : "Heritability needs replicated genotypes; none could be estimated here."}
      </Note>
      <HeritabilityPanel response={q.data} />
    </div>
  )
}

function Field({
  config,
  records,
}: {
  config: AnalysisConfig
  records: TraitRecord[]
}) {
  const trait = config.traits[0] ?? traitsOf(records)[0]
  const date = config.date ?? datesOf(records).slice(-1)[0]
  const q = useQuery({
    queryKey: ["dash-field", config.experiment, trait, date],
    enabled: Boolean(trait && date),
    staleTime: 60_000,
    queryFn: () =>
      fetchSpatial(
        request(config, [trait], {
          aggregation: "date",
          aggregation_date: date,
        }),
      ),
  })
  if (!trait) return <Note>No traits yet.</Note>
  if (q.isLoading) return <Waiting />
  if (q.error) return <Failed error={q.error} />
  if (!q.data) return null
  return (
    <div>
      <Note>
        {trait} across the field on {date}. Patches of one colour that follow
        rows or columns rather than genotypes point to field effects.
      </Note>
      <SpatialHeatmap response={q.data} />
    </div>
  )
}

export function AnalysisWidget({ config }: { config: AnalysisConfig }) {
  const all = useTraitRecords()
  const records = experimentRecords(all.data, config.experiment)
  if (all.isLoading) return <Waiting />
  if (records.length === 0)
    return <Note>No trait data for {config.experiment} yet.</Note>
  switch (config.kind) {
    case "summary":
      return <Summary records={records} />
    case "trend":
      return <Trend config={config} records={records} />
    case "correlation":
      return <Correlation config={config} records={records} />
    case "heritability":
      return <Heritability config={config} records={records} />
    case "field":
      return <Field config={config} records={records} />
  }
}
