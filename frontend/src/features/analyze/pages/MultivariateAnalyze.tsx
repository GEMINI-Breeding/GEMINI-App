import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import {
  ExperimentsService,
  SeasonsService,
  SitesService,
  PopulationsService,
  type ExperimentOutput,
  type SeasonOutput,
  type SiteOutput,
  type PopulationOutput,
  type TraitOutput,
} from "@/client"
import { MultiSelectFilter } from "@/components/Common/MultiSelectFilter"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { AggregationControl } from "../components/AggregationControl"
import { CorrelationHeatmap } from "../components/CorrelationHeatmap"
import { GgeBiplot } from "../components/GgeBiplot"
import { PcaBiplot } from "../components/PcaBiplot"
import {
  fetchCorrelation,
  fetchGGE,
  fetchMatrix,
  fetchPCA,
  type Aggregation,
  type CorrelationResponse,
  type GGEResponse,
  type MatrixResponse,
  type MultivariateRequest,
  type PCAResponse,
} from "../lib/multivariate"

interface Props {
  traits: TraitOutput[]
  traitsLoading: boolean
}

export function MultivariateAnalyze({ traits, traitsLoading }: Props) {
  // Shared filters + aggregation across all sub-tabs
  const [experiments, setExperiments] = useState<Set<string>>(new Set())
  const [seasons, setSeasons] = useState<Set<string>>(new Set())
  const [sites, setSites] = useState<Set<string>>(new Set())
  const [populations, setPopulations] = useState<Set<string>>(new Set())
  // Time-aggregation defaults to "mean" — it's a no-op when each plot has
  // one record, and Mean is the right answer when there are several.
  // (Surfacing the dropdown only when needed is a follow-up.)
  const [aggregation, setAggregation] = useState<Aggregation>("mean")
  const [aggregationDate, setAggregationDate] = useState<string | null>(null)
  const [showTimeAgg, setShowTimeAgg] = useState(false)

  // Per-sub-tab state
  const [corrTraits, setCorrTraits] = useState<Set<string>>(new Set())
  // Default on: correlating genotype means is the conventional breeding view.
  // For pre-aggregated CSVs this is a no-op (each accession is already a
  // single row), and for replicated field data it removes within-genotype
  // noise from the off-diagonal cells.
  const [corrCollapseReps, setCorrCollapseReps] = useState(true)
  const [pcaTraits, setPcaTraits] = useState<Set<string>>(new Set())
  // PCA defaults on for collapse: typically you want a genotype-level
  // ordination, not a per-plot point cloud (which mostly shows noise).
  const [pcaCollapseReps, setPcaCollapseReps] = useState(true)
  // GGE is single-trait by nature — pick exactly one.
  const [ggeTrait, setGgeTrait] = useState<string>("")

  const [corrResults, setCorrResults] = useState<{
    matrix: MatrixResponse
    correlation: CorrelationResponse
  } | null>(null)
  const [pcaResult, setPcaResult] = useState<PCAResponse | null>(null)
  const [ggeResult, setGgeResult] = useState<GGEResponse | null>(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const traitOptions = useMemo(
    () => traits.map((t) => t.trait_name).filter((n): n is string => !!n),
    [traits],
  )

  // *GetAll* endpoints return the full set without a search predicate. The
  // *Get* variants 400 when no filter param is supplied.
  const experimentsQuery = useQuery({
    queryKey: ["mv", "experiments"],
    queryFn: () =>
      ExperimentsService.apiExperimentsAllGetAllExperiments({ limit: 500 }),
  })
  const seasonsQuery = useQuery({
    queryKey: ["mv", "seasons"],
    queryFn: () => SeasonsService.apiSeasonsAllGetAllSeasons({ limit: 500 }),
  })
  const sitesQuery = useQuery({
    queryKey: ["mv", "sites"],
    queryFn: () => SitesService.apiSitesAllGetAllSites({ limit: 500 }),
  })
  const populationsQuery = useQuery({
    queryKey: ["mv", "populations"],
    queryFn: () =>
      PopulationsService.apiPopulationsAllGetAllPopulations({ limit: 500 }),
  })

  const experimentOptions = useMemo(
    () =>
      ((experimentsQuery.data as ExperimentOutput[] | null) ?? [])
        .map((e) => e.experiment_name)
        .filter((s): s is string => !!s),
    [experimentsQuery.data],
  )
  const seasonOptions = useMemo(
    () =>
      ((seasonsQuery.data as SeasonOutput[] | null) ?? [])
        .map((s) => s.season_name)
        .filter((s): s is string => !!s),
    [seasonsQuery.data],
  )
  const siteOptions = useMemo(
    () =>
      ((sitesQuery.data as SiteOutput[] | null) ?? [])
        .map((s) => s.site_name)
        .filter((s): s is string => !!s),
    [sitesQuery.data],
  )
  const populationOptions = useMemo(
    () =>
      ((populationsQuery.data as PopulationOutput[] | null) ?? [])
        .map((p) => p.population_name)
        .filter((s): s is string => !!s),
    [populationsQuery.data],
  )

  const aggOk = aggregation !== "date" || !!aggregationDate

  // MultiSelectFilter's convention: empty Set = "All". Resolve to the full
  // trait list so the Run button can enable and the request payload is
  // explicit about which traits to compute over.
  const effectiveCorrTraits =
    corrTraits.size === 0 ? traitOptions : [...corrTraits]
  const effectivePcaTraits =
    pcaTraits.size === 0 ? traitOptions : [...pcaTraits]

  function baseRequest(
    traitNames: string[],
    collapseReplicates: boolean,
  ): MultivariateRequest {
    return {
      trait_names: traitNames,
      experiment_names: experiments.size ? [...experiments] : undefined,
      season_names: seasons.size ? [...seasons] : undefined,
      site_names: sites.size ? [...sites] : undefined,
      populations: populations.size ? [...populations] : undefined,
      aggregation,
      aggregation_date:
        aggregation === "date" ? aggregationDate ?? undefined : undefined,
      collapse_replicates: collapseReplicates,
    }
  }

  async function runCorrelation() {
    const req = baseRequest(effectiveCorrTraits, corrCollapseReps)
    setLoading(true)
    setError(null)
    setCorrResults(null)
    try {
      const [matrix, correlation] = await Promise.all([
        fetchMatrix(req),
        fetchCorrelation(req),
      ])
      setCorrResults({ matrix, correlation })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  async function runPCA() {
    const req = baseRequest(effectivePcaTraits, pcaCollapseReps)
    setLoading(true)
    setError(null)
    setPcaResult(null)
    try {
      const r = await fetchPCA(req)
      setPcaResult(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  async function runGGE() {
    // GGE always works on genotype × env means — collapse_replicates is
    // forced on by the backend regardless of the flag here.
    const req = baseRequest([ggeTrait], true)
    setLoading(true)
    setError(null)
    setGgeResult(null)
    try {
      const r = await fetchGGE(req)
      setGgeResult(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <MultiSelectFilter
            label="Experiment"
            options={experimentOptions}
            selected={experiments}
            onChange={setExperiments}
            width="w-56"
            testId="mv-experiment"
          />
          <MultiSelectFilter
            label="Season"
            options={seasonOptions}
            selected={seasons}
            onChange={setSeasons}
            width="w-44"
            testId="mv-season"
          />
          <MultiSelectFilter
            label="Site"
            options={siteOptions}
            selected={sites}
            onChange={setSites}
            width="w-44"
            testId="mv-site"
          />
          <MultiSelectFilter
            label="Population"
            options={populationOptions}
            selected={populations}
            onChange={setPopulations}
            width="w-44"
            testId="mv-population"
          />
        </div>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className="self-start text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setShowTimeAgg((v) => !v)}
            data-testid="mv-show-time-agg"
          >
            {showTimeAgg ? "Hide" : "Show"} time-aggregation options
          </button>
          {showTimeAgg && (
            <div className="rounded-md border bg-muted/40 p-3">
              <p className="mb-2 text-xs text-muted-foreground">
                How to collapse multiple measurements of the same plot across
                different dates. Defaults to Mean. Has no effect when each plot
                has one measurement.
              </p>
              <AggregationControl
                value={aggregation}
                onChange={setAggregation}
                date={aggregationDate}
                onDateChange={setAggregationDate}
              />
            </div>
          )}
        </div>
      </section>

      {error && (
        <div
          className="rounded-md border border-destructive bg-destructive/5 p-3 text-sm text-destructive"
          data-testid="mv-error"
        >
          {error}
        </div>
      )}

      <Tabs defaultValue="correlation">
        <TabsList>
          <TabsTrigger value="correlation" data-testid="mv-subtab-correlation">
            Correlation
          </TabsTrigger>
          <TabsTrigger value="pca" data-testid="mv-subtab-pca">
            PCA
          </TabsTrigger>
          <TabsTrigger value="gge" data-testid="mv-subtab-gge">
            GGE biplot
          </TabsTrigger>
        </TabsList>

        <TabsContent value="correlation" className="mt-4 flex flex-col gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-primary h-4 w-4"
              checked={corrCollapseReps}
              onChange={(e) => setCorrCollapseReps(e.target.checked)}
              data-testid="mv-corr-collapse-replicates"
            />
            Average replicates by genotype
            <span className="text-xs text-muted-foreground">
              — correlate genotype means instead of raw per-plot values
            </span>
          </label>
          <div className="flex flex-wrap items-end gap-3">
            <MultiSelectFilter
              label="Traits"
              options={traitOptions}
              selected={corrTraits}
              onChange={setCorrTraits}
              width="w-72"
              testId="mv-trait-picker"
            />
            <button
              type="button"
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
              disabled={
                effectiveCorrTraits.length < 2 ||
                !aggOk ||
                loading ||
                traitsLoading
              }
              onClick={runCorrelation}
              data-testid="mv-run"
            >
              {loading ? "Running…" : "Run analysis"}
            </button>
            {(effectiveCorrTraits.length < 2 || !aggOk) && (
              <span className="text-xs text-muted-foreground">
                {effectiveCorrTraits.length < 2
                  ? "Need at least 2 traits"
                  : !aggregation
                    ? "Pick an aggregation"
                    : "Pick a collection date"}
              </span>
            )}
          </div>

          {corrResults && corrResults.matrix.status !== "ok" && (
            <div
              className="rounded-md border border-amber-500 bg-amber-50 p-3 text-sm text-amber-900"
              data-testid="mv-warning"
            >
              {corrResults.matrix.message || corrResults.matrix.status}
            </div>
          )}
          {corrResults && corrResults.matrix.status === "ok" && (
            <CorrelationHeatmap
              matrix={corrResults.matrix}
              correlation={corrResults.correlation}
            />
          )}
        </TabsContent>

        <TabsContent value="pca" className="mt-4 flex flex-col gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-primary h-4 w-4"
              checked={pcaCollapseReps}
              onChange={(e) => setPcaCollapseReps(e.target.checked)}
              data-testid="mv-pca-collapse-replicates"
            />
            Average replicates by genotype
            <span className="text-xs text-muted-foreground">
              — ordinate genotype means instead of raw per-plot values
            </span>
          </label>
          <div className="flex flex-wrap items-end gap-3">
            <MultiSelectFilter
              label="Traits"
              options={traitOptions}
              selected={pcaTraits}
              onChange={setPcaTraits}
              width="w-72"
              testId="mv-pca-trait-picker"
            />
            <button
              type="button"
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
              disabled={
                effectivePcaTraits.length < 3 ||
                !aggOk ||
                loading ||
                traitsLoading
              }
              onClick={runPCA}
              data-testid="mv-pca-run"
            >
              {loading ? "Running…" : "Run PCA"}
            </button>
            {(effectivePcaTraits.length < 3 || !aggOk) && (
              <span className="text-xs text-muted-foreground">
                {effectivePcaTraits.length < 3
                  ? "Need at least 3 traits"
                  : !aggregation
                    ? "Pick an aggregation"
                    : "Pick a collection date"}
              </span>
            )}
          </div>

          {pcaResult && pcaResult.status !== "ok" && (
            <div
              className="rounded-md border border-amber-500 bg-amber-50 p-3 text-sm text-amber-900"
              data-testid="mv-pca-warning"
            >
              {pcaResult.message || pcaResult.status}
            </div>
          )}
          {pcaResult && pcaResult.status === "ok" && (
            <PcaBiplot response={pcaResult} />
          )}
        </TabsContent>

        <TabsContent value="gge" className="mt-4 flex flex-col gap-4">
          <p className="text-xs text-muted-foreground">
            Genotype × Environment (Yan & Tinker) biplot for one trait. Needs
            at least 3 environments (experiment × season × site combinations)
            where the same accessions appear. Always averages replicates by
            accession.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label
                htmlFor="mv-gge-trait"
                className="text-xs text-muted-foreground"
              >
                Trait
              </label>
              <select
                id="mv-gge-trait"
                className="h-10 w-72 rounded-md border bg-background px-3 text-sm"
                value={ggeTrait}
                onChange={(e) => setGgeTrait(e.target.value)}
                data-testid="mv-gge-trait"
              >
                <option value="">Pick a trait…</option>
                {traitOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
              disabled={!ggeTrait || !aggOk || loading || traitsLoading}
              onClick={runGGE}
              data-testid="mv-gge-run"
            >
              {loading ? "Running…" : "Run GGE"}
            </button>
            {(!ggeTrait || !aggOk) && (
              <span className="text-xs text-muted-foreground">
                {!ggeTrait
                  ? "Pick a trait"
                  : !aggregation
                    ? "Pick an aggregation"
                    : "Pick a collection date"}
              </span>
            )}
          </div>
          {ggeResult && ggeResult.status !== "ok" && (
            <div
              className="rounded-md border border-amber-500 bg-amber-50 p-3 text-sm text-amber-900"
              data-testid="mv-gge-warning"
            >
              {ggeResult.message || ggeResult.status}
            </div>
          )}
          {ggeResult && ggeResult.status === "ok" && (
            <GgeBiplot response={ggeResult} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
