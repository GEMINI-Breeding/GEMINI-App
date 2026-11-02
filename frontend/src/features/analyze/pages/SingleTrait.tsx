/**
 * One trait at a time, through the season by default. The scope comes
 * first (experiment, season, site, crop: the same picks as the Table), then
 * only the traits measured there, searchable, each with how many flight
 * dates it has, instead of one long list of every trait.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import type { TraitOutput } from "@/client"
import { Input } from "@/components/ui/input"
import { idAsString } from "@/features/admin/lib/ids"
import { useTraitRecords } from "@/features/dashboard/hooks/useTraitData"
import {
  useAllExperiments,
  useExperimentPopulations,
  useExperimentSeasons,
  useExperimentSites,
} from "@/features/experiments/hooks/useExperimentData"
import {
  ProcessScopeSelectors,
  useAerialScopeContext,
} from "@/features/process/components/AerialScopePicker"
import { useProcessScope } from "@/features/process/lib/processScope"
import { traitLabel } from "@/lib/traitName"
import { type ChartType, TraitCharts } from "../components/TraitCharts"
import { seasonOf } from "../lib/mapDate"

export interface TraitLink {
  trait?: string
  chart?: ChartType
  experiment?: string
  season?: string
  site?: string
  population?: string
}

/** A link's scope (by name) put into the shared picks (by id), once. */
function useApplyLinkedScope(link: TraitLink | null) {
  const s = useProcessScope()
  const { data: experiments = [] } = useAllExperiments()
  const { data: seasons = [] } = useExperimentSeasons(s.experimentId)
  const { data: sites = [] } = useExperimentSites(s.experimentId)
  const { data: populations = [] } = useExperimentPopulations(s.experimentId)
  const done = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!link || done.current.has("experiment") || !link.experiment) return
    const e = experiments.find((x) => x.experiment_name === link.experiment)
    if (!e?.id) return
    done.current.add("experiment")
    if (String(e.id) !== s.experimentId) s.setExperimentId(String(e.id))
  }, [link, experiments, s])
  useEffect(() => {
    if (!link || !done.current.has("experiment")) return
    const pick = (
      key: string,
      want: string | undefined,
      list: { id?: unknown }[],
      name: (x: never) => string | null | undefined,
      current: string | null,
      set: (id: string) => void,
    ) => {
      if (!want || done.current.has(key)) return
      const hit = list.find((x) => name(x as never) === want)
      if (!hit?.id) return
      done.current.add(key)
      if (String(hit.id) !== current) set(String(hit.id))
    }
    pick(
      "season",
      link.season,
      seasons,
      (x: { season_name?: string | null }) => x.season_name,
      s.seasonId,
      s.setSeasonId,
    )
    pick(
      "site",
      link.site,
      sites,
      (x: { site_name?: string | null }) => x.site_name,
      s.siteId,
      s.setSiteId,
    )
    pick(
      "population",
      link.population,
      populations,
      (x: { population_name?: string | null }) => x.population_name,
      s.populationId,
      s.setPopulationId,
    )
  }, [link, seasons, sites, populations, s])
}

export function SingleTrait({
  traits,
  traitsLoading,
  link,
}: {
  traits: TraitOutput[]
  traitsLoading: boolean
  link: TraitLink | null
}) {
  useApplyLinkedScope(link)
  const ctx = useAerialScopeContext()
  const catalog = useTraitRecords()

  // Traits measured in the scope, with their flight dates.
  const inScope = useMemo(() => {
    const dates = new Map<string, Set<string>>()
    for (const r of catalog.data ?? []) {
      if (ctx.experimentName && r.experiment !== ctx.experimentName) continue
      if (ctx.siteName && r.location !== ctx.siteName) continue
      if (ctx.populationName && r.population !== ctx.populationName) continue
      if (ctx.seasonName && seasonOf(r) !== ctx.seasonName) continue
      for (const t of r.trait_columns) {
        const set = dates.get(t) ?? new Set<string>()
        set.add(r.date.slice(0, 10))
        dates.set(t, set)
      }
    }
    return dates
  }, [
    catalog.data,
    ctx.experimentName,
    ctx.seasonName,
    ctx.siteName,
    ctx.populationName,
  ])

  const [showAll, setShowAll] = useState(false)
  const [q, setQ] = useState("")
  const [traitId, setTraitId] = useState("")

  // Opened from a link: that trait.
  useEffect(() => {
    if (!link?.trait || traitId) return
    const t = traits.find((x) => x.trait_name === link.trait)
    if (t) setTraitId(idAsString(t.id))
  }, [link, traits, traitId])

  const listed = useMemo(() => {
    const s = q.trim().toLowerCase()
    return traits
      .filter((t) => t.trait_name)
      .filter((t) => showAll || inScope.has(t.trait_name as string))
      .filter(
        (t) =>
          !s ||
          traitLabel(t.trait_name).toLowerCase().includes(s) ||
          (t.trait_name as string).toLowerCase().includes(s),
      )
      .sort(
        (a, b) =>
          Number(inScope.has(b.trait_name as string)) -
            Number(inScope.has(a.trait_name as string)) ||
          traitLabel(a.trait_name).localeCompare(traitLabel(b.trait_name)),
      )
  }, [traits, inScope, showAll, q])

  const selected = traits.find((t) => idAsString(t.id) === traitId)
  const linkedHere = link?.trait && selected?.trait_name === link.trait
  const scopeKey = [
    ctx.experimentName,
    ctx.seasonName,
    ctx.siteName,
    ctx.populationName,
  ].join("|")

  return (
    <div className="flex flex-col gap-4" data-testid="single-trait">
      <ProcessScopeSelectors allowAllPopulations />

      <div className="space-y-2">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label
              htmlFor="analyze-trait-find"
              className="text-muted-foreground block text-xs"
            >
              Trait
            </label>
            <Input
              id="analyze-trait-find"
              className="h-8 w-64 text-sm"
              placeholder="Search traits…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              data-testid="analyze-trait-search"
            />
          </div>
          <label className="flex h-8 items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              className="accent-primary size-3.5"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
            />
            Also traits not measured here ({traits.length} in all)
          </label>
        </div>
        <div
          className="flex max-h-40 flex-wrap gap-1.5 overflow-auto"
          data-testid="analyze-trait-list"
        >
          {listed.map((t) => {
            const id = idAsString(t.id)
            const n = inScope.get(t.trait_name as string)?.size ?? 0
            const on = id === traitId
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTraitId(id)}
                className={`rounded-full border px-3 py-1 text-xs ${
                  on
                    ? "border-primary bg-primary text-primary-foreground"
                    : n
                      ? "hover:bg-muted"
                      : "text-muted-foreground hover:bg-muted border-dashed"
                }`}
                title={t.trait_name ?? ""}
                data-testid={`analyze-trait-${t.trait_name}`}
              >
                {traitLabel(t.trait_name)}
                {t.trait_units ? ` (${t.trait_units})` : ""}
                <span className={on ? "opacity-80" : "text-muted-foreground"}>
                  {" "}
                  · {n ? `${n} date${n === 1 ? "" : "s"}` : "not here"}
                </span>
              </button>
            )
          })}
          {listed.length === 0 && (
            <p className="text-muted-foreground text-sm">
              {traitsLoading || catalog.isLoading
                ? "Loading traits…"
                : q
                  ? "No trait matches."
                  : "No traits measured in this scope yet. Tick “Also traits not measured here” to see every trait."}
            </p>
          )}
        </div>
      </div>

      {!selected ? (
        <p
          className="text-muted-foreground text-sm"
          data-testid="analyze-empty"
        >
          Pick a trait to see it through the season, plot by plot, or across
          genotypes and sites.
        </p>
      ) : (
        <TraitCharts
          key={`${traitId}|${scopeKey}`}
          traitId={traitId}
          traitName={selected.trait_name}
          traitUnits={selected.trait_units ?? undefined}
          initialChart={(linkedHere && link?.chart) || "date-trend"}
          initialFilters={{
            experiment: ctx.experimentName || undefined,
            season: ctx.seasonName || undefined,
            site: ctx.siteName || undefined,
            population: ctx.populationName || undefined,
          }}
        />
      )}
    </div>
  )
}
