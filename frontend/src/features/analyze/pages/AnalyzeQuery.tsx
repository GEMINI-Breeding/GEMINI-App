/**
 * AnalyzeQuery — pick plots (by plot number or accession) and see each one
 * through the season: its image on every flight date side by side, with the
 * traits measured on that date under it. Several plots at once, one row
 * each, so a change across dates or between plots reads at a glance.
 */
import { useQuery } from "@tanstack/react-query"
import { Search, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { ExperimentsService, type TraitOutput } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useTraitRecords } from "@/features/dashboard/hooks/useTraitData"
import { ImageLightbox } from "@/features/files/components/ImageLightbox"
import {
  AuthImage,
  thumbnailSrc,
} from "@/features/genotyping/components/AuthImage"
import {
  ProcessScopeSelectors,
  useAerialScopeContext,
} from "@/features/process/components/AerialScopePicker"
import { processedPopulationPrefix } from "@/features/process/lib/paths"
import { useAllRuns } from "@/features/process/lib/runStore"
import { traitLabel } from "@/lib/traitName"
import { usePlotImageListing } from "../hooks/usePlotImageListing"
import { usePlotPolygons } from "../hooks/usePlotPolygons"
import { useScopeDates, useTraitsByDate } from "../hooks/useTraitsByDate"
import { seasonOf } from "../lib/mapDate"
import {
  comparePlots,
  imagePopulations,
  indexSeasonImages,
  kindLabel,
  type PlotChoice,
  suggestPlots,
} from "../lib/plotSeason"

const SIZES = { S: 110, M: 170, L: 260 } as const
type Size = keyof typeof SIZES

const PICKS_KEY = "gemini.analyze.query.v1"

function fmt(v: number): string {
  return Math.abs(v) >= 100
    ? v.toFixed(1)
    : Math.abs(v) >= 1
      ? v.toFixed(2)
      : v.toFixed(3)
}

/** The plots picked per scope, remembered in this browser. */
function readPicks(scope: string): string[] {
  try {
    const all = JSON.parse(localStorage.getItem(PICKS_KEY) ?? "{}")
    return Array.isArray(all[scope]) ? all[scope].map(String) : []
  } catch {
    return []
  }
}
function writePicks(scope: string, plots: string[]) {
  try {
    const all = JSON.parse(localStorage.getItem(PICKS_KEY) ?? "{}")
    all[scope] = plots
    localStorage.setItem(PICKS_KEY, JSON.stringify(all))
  } catch {
    // private mode / blocked storage: the picks just aren't remembered
  }
}

export function AnalyzeQuery() {
  const ctx = useAerialScopeContext()
  const scopeReady = Boolean(
    ctx.experimentName && ctx.seasonName && ctx.siteName,
  )
  // Crops: the population picked, else those the scope's runs and trait
  // records name (known at once; an experiment may have no populations
  // registered, and the image listing is slow).
  const allRuns = useAllRuns()
  const catalog = useTraitRecords()
  const knownCrops = useMemo(() => {
    const out = new Set<string>()
    for (const r of allRuns) {
      const u = r.uploadScope
      if (
        u?.population &&
        u.experiment === ctx.experimentName &&
        u.location === ctx.siteName &&
        u.year === ctx.seasonName
      )
        out.add(u.population)
    }
    for (const r of catalog.data ?? [])
      if (
        r.population &&
        r.experiment === ctx.experimentName &&
        r.location === ctx.siteName &&
        seasonOf(r) === ctx.seasonName
      )
        out.add(r.population)
    return [...out].sort()
  }, [allRuns, catalog.data, ctx.experimentName, ctx.siteName, ctx.seasonName])
  const [cropPick, setCrop] = useState("")
  const cropGuess = knownCrops.includes(cropPick)
    ? cropPick
    : (knownCrops[0] ?? "")
  // A crop known: list just its folder. Else the whole site, and read the
  // crops from its image folders.
  const listCrop = ctx.populationName || cropGuess
  const prefix = !scopeReady
    ? null
    : listCrop
      ? processedPopulationPrefix({
          year: ctx.seasonName,
          experiment: ctx.experimentName,
          location: ctx.siteName,
          population: listCrop,
        })
      : `Processed/${ctx.seasonName}/${ctx.experimentName}/${ctx.siteName}/`
  const listing = usePlotImageListing(prefix)
  const crops = useMemo(
    () =>
      knownCrops.length ? knownCrops : imagePopulations(listing.data ?? []),
    [knownCrops, listing.data],
  )
  const crop =
    ctx.populationName ||
    (crops.includes(cropPick) ? cropPick : (crops[0] ?? ""))
  const images = useMemo(
    () => indexSeasonImages(listing.data ?? [], crop || null),
    [listing.data, crop],
  )
  const [kindPick, setKind] = useState<string>("")
  const kind = images.kinds.includes(kindPick) ? kindPick : images.kinds[0]
  const kindDates = images.byKind.get(kind ?? "")

  // Plots (with accessions) from the field's boundaries, plus any plot that
  // only the images name.
  const polygons = usePlotPolygons({
    experimentId: ctx.experimentId,
    seasonId: ctx.seasonId,
    siteId: ctx.siteId,
    populationId: ctx.populationId,
  })
  const plots: PlotChoice[] = useMemo(() => {
    const fromBoundaries = new Map<string, string | null>()
    for (const f of polygons.data?.features ?? []) {
      const n = f.properties?.plot_number
      if (n == null) continue
      fromBoundaries.set(String(n), f.properties?.accession_name ?? null)
    }
    // With images, the crop's plots are the ones they show (a site's
    // boundaries can hold every crop); else every plot of the boundaries.
    const by = new Map<string, string | null>()
    for (const dates of images.byKind.values())
      for (const ps of dates.values())
        for (const p of ps.keys())
          by.set(p, fromBoundaries.get(p) ?? images.accessions.get(p) ?? null)
    if (by.size === 0) for (const [p, a] of fromBoundaries) by.set(p, a)
    return [...by.entries()]
      .map(([plot, accession]) => ({ plot, accession }))
      .sort((a, b) => comparePlots(a.plot, b.plot))
  }, [polygons.data, images])
  const accessionOf = useMemo(
    () => new Map(plots.map((p) => [p.plot, p.accession])),
    [plots],
  )

  // Traits: the experiment's, measured per plot on each date.
  const traitsQuery = useQuery({
    queryKey: ["analyze", "table", "traits", ctx.experimentId],
    queryFn: () =>
      ExperimentsService.apiExperimentsIdExperimentIdTraitsGetExperimentTraits({
        experimentId: ctx.experimentId as string,
      }),
    enabled: Boolean(ctx.experimentId),
  })
  const traitList = useMemo(
    () =>
      ((traitsQuery.data as TraitOutput[] | null) ?? [])
        .filter((t) => t.trait_name)
        .sort((a, b) =>
          traitLabel(a.trait_name).localeCompare(traitLabel(b.trait_name)),
        ),
    [traitsQuery.data],
  )
  const traitNames = useMemo(
    () => traitList.map((t) => t.trait_name as string),
    [traitList],
  )
  const unitOf = useMemo(
    () => new Map(traitList.map((t) => [t.trait_name, t.trait_units ?? ""])),
    [traitList],
  )
  const scopeNames = {
    experiment: ctx.experimentName,
    season: ctx.seasonName,
    site: ctx.siteName,
    population: crop,
  }
  const { dates: traitDates } = useScopeDates(scopeNames)

  // Picked plots, remembered per scope.
  const scopeKey = [
    ctx.experimentId,
    ctx.seasonId,
    ctx.siteId,
    ctx.populationId,
    crop,
  ].join("|")
  const [picked, setPicked] = useState<string[]>(() => readPicks(scopeKey))
  const lastScope = useRef(scopeKey)
  useEffect(() => {
    if (lastScope.current === scopeKey) return
    lastScope.current = scopeKey
    setPicked(readPicks(scopeKey))
  }, [scopeKey])
  const setPicks = (next: string[]) => {
    const unique = [...new Set(next)]
    setPicked(unique)
    writePicks(scopeKey, unique)
  }

  // Trait values are only fetched once a plot is picked.
  const values = useTraitsByDate({
    scope: scopeNames,
    traits: traitNames,
    dates: traitDates,
    enabled: picked.length > 0,
  })
  const valueAt = useMemo(() => {
    const m = new Map<string, Record<string, number | null>>()
    for (const r of values.data?.rows ?? [])
      if (r.plot_number != null && r.collection_date)
        m.set(`${r.collection_date}|${r.plot_number}`, r.values)
    return m
  }, [values.data])
  const measured = useMemo(
    () => (values.data?.trait_names ?? []).filter(Boolean),
    [values.data],
  )
  const [hiddenTraits, setHiddenTraits] = useState<Set<string>>(new Set())
  const shownTraits = measured.filter((t) => !hiddenTraits.has(t))

  const [imageDatesOnly, setImageDatesOnly] = useState(false)
  const dates = useMemo(() => {
    const set = new Set<string>(kindDates ? [...kindDates.keys()] : [])
    if (!imageDatesOnly) for (const d of traitDates) set.add(d)
    return [...set].sort()
  }, [kindDates, traitDates, imageDatesOnly])

  const [size, setSize] = useState<Size>("M")
  const [viewing, setViewing] = useState<{
    plot: string
    index: number
  } | null>(null)
  const rowImages = (plot: string) =>
    dates
      .map((d) => ({ date: d, path: kindDates?.get(d)?.get(plot) }))
      .filter((x): x is { date: string; path: string } => Boolean(x.path))

  return (
    <div className="flex flex-col gap-4" data-testid="analyze-query">
      <ProcessScopeSelectors allowAllPopulations />

      {!scopeReady ? (
        <p className="text-muted-foreground text-sm">
          Pick an experiment, season and site.
        </p>
      ) : (
        <>
          {!ctx.populationName && crops.length > 0 && (
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label className="text-xs" htmlFor="analyze-query-crop">
                  Crop
                </Label>
                <Select value={crop} onValueChange={setCrop}>
                  <SelectTrigger
                    id="analyze-query-crop"
                    className="w-40"
                    data-testid="analyze-query-crop"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {crops.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <PlotPicker
            plots={plots}
            picked={picked}
            loading={polygons.isLoading}
            onAdd={(ps) => setPicks([...picked, ...ps])}
          />

          {picked.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {picked.map((p) => (
                <span
                  key={p}
                  className="bg-muted inline-flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5 text-xs"
                >
                  Plot {p}
                  {accessionOf.get(p) ? ` · ${accessionOf.get(p)}` : ""}
                  {(() => {
                    const acc = accessionOf.get(p)
                    if (!acc) return null
                    const rest = plots
                      .filter(
                        (x) => x.accession === acc && !picked.includes(x.plot),
                      )
                      .map((x) => x.plot)
                    return rest.length ? (
                      <button
                        type="button"
                        className="text-primary hover:bg-background rounded px-1 text-[11px] font-medium"
                        title={`Add the other ${rest.length} plot(s) of ${acc}`}
                        onClick={() => setPicks([...picked, ...rest])}
                      >
                        +{rest.length} more
                      </button>
                    ) : null
                  })()}
                  <button
                    type="button"
                    className="hover:bg-background rounded-full p-0.5"
                    aria-label={`Remove plot ${p}`}
                    onClick={() => setPicks(picked.filter((x) => x !== p))}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => setPicks([])}
              >
                Clear
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="analyze-query-kind">
                Image
              </Label>
              <Select
                value={kind ?? ""}
                onValueChange={setKind}
                disabled={images.kinds.length === 0}
              >
                <SelectTrigger
                  id="analyze-query-kind"
                  className="w-56"
                  data-testid="analyze-query-kind"
                >
                  <SelectValue
                    placeholder={
                      listing.isLoading ? "Looking…" : "No plot images yet"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {images.kinds.map((k) => (
                    <SelectItem key={k} value={k}>
                      {kindLabel(k)} ({images.byKind.get(k)?.size ?? 0} dates)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <span className="text-muted-foreground block text-xs">Size</span>
              <div className="flex rounded-md border">
                {(Object.keys(SIZES) as Size[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`h-9 px-3 text-sm ${size === s ? "bg-muted font-medium" : ""}`}
                    onClick={() => setSize(s)}
                    aria-pressed={size === s}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex h-9 items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                className="accent-primary size-4"
                checked={imageDatesOnly}
                onChange={(e) => setImageDatesOnly(e.target.checked)}
              />
              Only dates with images
            </label>
          </div>

          {measured.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="text-muted-foreground">Traits shown:</span>
              {measured.map((t) => (
                <label key={t} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    className="accent-primary size-3.5"
                    checked={!hiddenTraits.has(t)}
                    onChange={(e) => {
                      const next = new Set(hiddenTraits)
                      if (e.target.checked) next.delete(t)
                      else next.add(t)
                      setHiddenTraits(next)
                    }}
                  />
                  {traitLabel(t)}
                </label>
              ))}
            </div>
          )}

          {picked.length === 0 ? (
            <p
              className="text-muted-foreground text-sm"
              data-testid="analyze-query-empty"
            >
              Find plots above by plot number or accession to see them across
              the season. Add several to compare them side by side.
            </p>
          ) : dates.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No flight dates with plot images or traits here yet.
            </p>
          ) : (
            <div className="max-h-[75vh] overflow-auto rounded-md border">
              <table className="min-w-max border-collapse text-xs">
                <thead className="bg-muted sticky top-0 z-20">
                  <tr>
                    <th className="bg-muted sticky left-0 z-30 px-2 py-1.5 text-left">
                      Plot
                    </th>
                    {dates.map((d) => (
                      <th
                        key={d}
                        className="px-2 py-1.5 text-left font-mono font-medium"
                      >
                        {d}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {picked.map((p) => {
                    const row = rowImages(p)
                    return (
                      <tr
                        key={p}
                        className="border-t align-top"
                        data-testid="analyze-query-row"
                      >
                        <td className="bg-background sticky left-0 z-10 px-2 py-2">
                          <div className="font-medium">Plot {p}</div>
                          <div className="text-muted-foreground">
                            {accessionOf.get(p) ?? "—"}
                          </div>
                        </td>
                        {dates.map((d) => {
                          const path = kindDates?.get(d)?.get(p)
                          const v = valueAt.get(`${d}|${p}`)
                          return (
                            <td
                              key={d}
                              className="px-1.5 py-2"
                              style={{ width: SIZES[size] + 12 }}
                            >
                              <div
                                className="bg-muted flex items-center justify-center overflow-hidden rounded"
                                style={{
                                  width: SIZES[size],
                                  height: SIZES[size],
                                }}
                              >
                                {path ? (
                                  <AuthImage
                                    src={thumbnailSrc(
                                      path,
                                      size === "L" ? 600 : 400,
                                    )}
                                    alt={`Plot ${p} on ${d}`}
                                    className="h-full w-full border-0 object-contain"
                                    onImageClick={() =>
                                      setViewing({
                                        plot: p,
                                        index: row.findIndex(
                                          (x) => x.path === path,
                                        ),
                                      })
                                    }
                                    lazy
                                  />
                                ) : (
                                  <span className="text-muted-foreground px-2 text-center text-[11px]">
                                    {listing.isLoading ? "…" : "No image"}
                                  </span>
                                )}
                              </div>
                              {v && shownTraits.length > 0 && (
                                <dl
                                  className="mt-1 space-y-0.5 tabular-nums"
                                  style={{ width: SIZES[size] }}
                                >
                                  {shownTraits.map((t) =>
                                    v[t] == null ? null : (
                                      <div
                                        key={t}
                                        className="flex justify-between gap-2"
                                        title={traitLabel(t)}
                                      >
                                        <dt className="text-muted-foreground truncate">
                                          {traitLabel(t)}
                                        </dt>
                                        <dd className="shrink-0 font-mono">
                                          {fmt(v[t] as number)}
                                          {unitOf.get(t)
                                            ? ` ${unitOf.get(t)}`
                                            : ""}
                                        </dd>
                                      </div>
                                    ),
                                  )}
                                </dl>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {values.isLoading && picked.length > 0 && (
            <p className="text-muted-foreground text-xs">Loading traits…</p>
          )}
        </>
      )}

      <ImageLightbox
        images={viewing ? rowImages(viewing.plot).map((x) => x.path) : []}
        index={viewing?.index ?? null}
        onIndex={(i) => viewing && setViewing({ ...viewing, index: i })}
        onClose={() => setViewing(null)}
        caption={(name) => {
          if (!viewing) return null
          const d = rowImages(viewing.plot).find((x) => x.path === name)?.date
          const v = d ? valueAt.get(`${d}|${viewing.plot}`) : undefined
          const traits = v
            ? shownTraits
                .filter((t) => v[t] != null)
                .map(
                  (t) =>
                    `${traitLabel(t)} ${fmt(v[t] as number)}${unitOf.get(t) ? ` ${unitOf.get(t)}` : ""}`,
                )
                .join(" · ")
            : ""
          return `Plot ${viewing.plot}${
            accessionOf.get(viewing.plot)
              ? ` · ${accessionOf.get(viewing.plot)}`
              : ""
          } · ${d ?? ""}${traits ? ` · ${traits}` : ""}`
        }}
      />
    </div>
  )
}

/** Type a plot number or accession; pick plots (or every plot of an
 *  accession) from the suggestions. */
function PlotPicker({
  plots,
  picked,
  loading,
  onAdd,
}: {
  plots: PlotChoice[]
  picked: string[]
  loading: boolean
  onAdd: (plots: string[]) => void
}) {
  const [typed, setTyped] = useState("")
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [])
  const taken = new Set(picked)
  const s = suggestPlots(
    plots.filter((p) => !taken.has(p.plot)),
    typed,
  )
  const add = (ps: string[]) => {
    onAdd(ps)
    setTyped("")
  }
  return (
    <div className="relative max-w-xl space-y-1" ref={box}>
      <Label className="text-xs" htmlFor="analyze-query-find">
        Find plots
      </Label>
      <div className="relative">
        <Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
        <Input
          id="analyze-query-find"
          data-testid="analyze-query-find"
          className="pl-8"
          value={typed}
          placeholder={
            loading
              ? "Loading plots…"
              : `Plot number or accession (${plots.length} plots)`
          }
          onChange={(e) => {
            setTyped(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && s.plots[0]) add([s.plots[0].plot])
            if (e.key === "Escape") setOpen(false)
          }}
        />
      </div>
      {open && (s.plots.length > 0 || s.accessions.length > 0) && (
        <div className="bg-popover absolute z-40 mt-1 max-h-72 w-full overflow-auto rounded-md border shadow-md">
          {s.accessions.length > 0 && (
            <p className="text-muted-foreground bg-muted/50 px-3 py-1 text-[11px] font-medium uppercase">
              Accessions: adds all its plots
            </p>
          )}
          {s.accessions.map((a) => (
            <button
              key={a.accession}
              type="button"
              className="hover:bg-accent flex w-full justify-between gap-3 px-3 py-1.5 text-left text-sm"
              onClick={() => add(a.plots)}
              data-testid="analyze-query-accession"
            >
              <span className="font-medium">{a.accession}</span>
              <span className="text-muted-foreground shrink-0">
                {a.plots.length} plot{a.plots.length === 1 ? "" : "s"}
              </span>
            </button>
          ))}
          {s.plots.length > 0 && (
            <p className="text-muted-foreground bg-muted/50 px-3 py-1 text-[11px] font-medium uppercase">
              Plots
            </p>
          )}
          {s.plots.map((p) => (
            <button
              key={p.plot}
              type="button"
              className="hover:bg-accent flex w-full justify-between gap-3 px-3 py-1.5 text-left text-sm"
              onClick={() => add([p.plot])}
              data-testid="analyze-query-suggestion"
            >
              <span>Plot {p.plot}</span>
              <span className="text-muted-foreground truncate">
                {p.accession ?? ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
