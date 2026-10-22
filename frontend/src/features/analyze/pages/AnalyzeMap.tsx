/**
 * AnalyzeMap — geospatial trait viewer.
 *
 * Lets the user pick an experiment / season / site scope and renders
 * the saved plot-boundary polygons (joined with optional per-plot trait
 * values) over a satellite basemap.
 *
 * Plots and trait_records are scoped to experiment / season / site,
 * not to a specific mission date / platform / sensor — those tag the
 * RAW imagery upload but don't constrain which plots exist. This page
 * therefore reads from `/api/plots/geojson` (scope-ID-keyed) only; the
 * older MinIO-directory fallback used to require the user to enter a
 * date that often doesn't apply (manual trait uploads have no flight
 * date) and could mis-match the season the boundary was actually saved
 * under.
 */
import { useQueries, useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"

import { PlotGeometryService, type TraitOutput, TraitsService } from "@/client"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { idAsString } from "@/features/admin/lib/ids"
import { useTraitRecords } from "@/features/dashboard/hooks/useTraitData"
import { plotImagesForDate } from "@/features/dashboard/lib/traitCatalog"
import { DEFAULT_BUCKET } from "@/features/files/lib/download"
import {
  ProcessScopeSelectors,
  useAerialScopeContext,
} from "@/features/process/components/AerialScopePicker"
import { TraitMap } from "@/features/process/components/TraitMap"
import { buildTitilerTileUrl } from "@/features/process/lib/activeOrtho"
import { processedPopulationPrefix } from "@/features/process/lib/paths"
import { useAllRuns } from "@/features/process/lib/runStore"
import { PlotImageDialog } from "../components/PlotImageDialog"
import {
  usePopulationListing,
  usePopulationOrthos,
} from "../hooks/usePlotImages"
import { usePlotPolygons } from "../hooks/usePlotPolygons"
import { usePlotTraitValues } from "../hooks/usePlotTraitValues"
import {
  attachHoverValues,
  joinTraitToPolygons,
  plotKey,
} from "../lib/joinTraitToPolygons"
import {
  boundaryPlots,
  dateFolders,
  dateOrthos,
  mapDates,
  traitsOnDate,
} from "../lib/mapDate"
import { fetchMatrix } from "../lib/multivariate"

const STORAGE_KEY = "gemini.analyze.map.fields.v1"

type LocalFields = {
  traitId: string
  /** The flight date shown (YYYY-MM-DD); "" = the newest with traits. */
  date: string
}

function loadLocalFields(): LocalFields {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { traitId: "", date: "" }
    const parsed = JSON.parse(raw) as Partial<LocalFields>
    return {
      traitId: typeof parsed.traitId === "string" ? parsed.traitId : "",
      date: typeof parsed.date === "string" ? parsed.date : "",
    }
  } catch {
    return { traitId: "", date: "" }
  }
}

/** Most traits the map tooltip lists for a hovered plot. */
const HOVER_TRAIT_LIMIT = 12

export function AnalyzeMap() {
  const ctx = useAerialScopeContext()
  const [fields, setFields] = useState<LocalFields>(loadLocalFields)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(fields))
    } catch {
      // ignore quota / privacy-mode errors
    }
  }, [fields])

  const hasScopeIds = Boolean(ctx.experimentId && ctx.seasonId && ctx.siteId)
  // Every file of the scope: plot images, orthomosaics and the dates' folders.
  const plotImagesPrefix =
    ctx.seasonName && ctx.experimentName && ctx.siteName && ctx.populationName
      ? processedPopulationPrefix({
          year: ctx.seasonName,
          experiment: ctx.experimentName,
          location: ctx.siteName,
          population: ctx.populationName,
        })
      : null
  // Without a population, list the whole site so a run over any
  // population can still sit under the plots.
  const sitePrefix =
    ctx.seasonName && ctx.experimentName && ctx.siteName
      ? `Processed/${ctx.seasonName}/${ctx.experimentName}/${ctx.siteName}/`
      : null
  const listing = usePopulationListing(plotImagesPrefix ?? sitePrefix)
  const files = useMemo(() => listing.data ?? [], [listing.data])
  const orthosQuery = usePopulationOrthos(
    plotImagesPrefix ?? sitePrefix,
    !plotImagesPrefix,
  )

  // One flight date at a time: its traits, its boundaries and its
  // orthomosaics. A trait measured on one date is never drawn over another
  // date's plots or image.
  const catalog = useTraitRecords()
  const mapScope = useMemo(
    () => ({
      experiment: ctx.experimentName || null,
      season: ctx.seasonName || null,
      site: ctx.siteName || null,
      population: ctx.populationName || null,
    }),
    [ctx.experimentName, ctx.seasonName, ctx.siteName, ctx.populationName],
  )
  const dates = useMemo(
    () =>
      mapDates(
        catalog.data ?? [],
        (orthosQuery.data ?? []).map((o) => o.date),
        mapScope,
      ),
    [catalog.data, orthosQuery.data, mapScope],
  )
  const date = dates.some((d) => d.date === fields.date)
    ? fields.date
    : (dates.find((d) => d.traits)?.date ?? dates[0]?.date ?? "")
  const dateTraits = useMemo(
    () => traitsOnDate(catalog.data ?? [], mapScope, date),
    [catalog.data, mapScope, date],
  )

  // Traits: only those measured on this date in this scope.
  const traitsQuery = useQuery({
    queryKey: ["analyze", "map", "traits"],
    queryFn: () =>
      TraitsService.apiTraitsAllGetAllTraits({ limit: 500, offset: 0 }),
  })
  const traits: TraitOutput[] = useMemo(
    () =>
      ((traitsQuery.data as TraitOutput[] | null) ?? []).filter((t) =>
        dateTraits.has(t.trait_name ?? ""),
      ),
    [traitsQuery.data, dateTraits],
  )
  const selectedTrait = useMemo(
    () => traits.find((t) => idAsString(t.id) === fields.traitId) ?? null,
    [traits, fields.traitId],
  )

  // Per-plot values of the chosen trait on this date.
  const valuesQuery = usePlotTraitValues({
    traitId: selectedTrait ? idAsString(selectedTrait.id) : null,
    experimentName: ctx.experimentName || null,
    seasonName: ctx.seasonName || null,
    siteName: ctx.siteName || null,
    populationName: ctx.populationName || null,
    collectionDate: date || null,
  })
  const traitValues = valuesQuery.data?.values ?? null

  // Boundaries: the version active for this date (the plots as drawn on
  // that flight's map); the scope's saved plots when the date has none.
  const polygonsQuery = usePlotPolygons({
    experimentId: ctx.experimentId,
    seasonId: ctx.seasonId,
    siteId: ctx.siteId,
    populationId: ctx.populationId,
  })
  const folders = useMemo(
    () => (date ? dateFolders(files, date) : []),
    [files, date],
  )
  const boundaryQueries = useQueries({
    queries: folders.map((directory) => ({
      queryKey: ["analyze", "map", "date-boundaries", directory],
      queryFn: async () => {
        try {
          const r =
            (await PlotGeometryService.apiPlotGeometryVersionsLoadLoadVersion({
              requestBody: { directory },
            })) as { state_snapshot?: unknown }
          return boundaryPlots(r.state_snapshot)
        } catch {
          return []
        }
      },
      staleTime: 60_000,
    })),
  })
  const boundaryStamp = boundaryQueries.map((q) => q.dataUpdatedAt).join()
  // biome-ignore lint/correctness/useExhaustiveDependencies: boundaryStamp changes whenever a query's data does
  const dateBoundaries = useMemo(() => {
    const features = boundaryQueries.flatMap((q) => q.data ?? [])
    return features.length
      ? ({ type: "FeatureCollection", features } as unknown as NonNullable<
          typeof polygonsQuery.data
        >)
      : null
  }, [boundaryStamp])
  const boundariesLoading = boundaryQueries.some((q) => q.isLoading)
  const polygonsFc = dateBoundaries ?? polygonsQuery.data ?? null
  const hasPolygons = polygonsFc !== null && polygonsFc.features.length > 0
  // Population narrows the join so plot_number alone is the key (it is unique
  // within a population, and within a saved boundary version's field design).
  const joinKeyMode = ctx.populationId || dateBoundaries ? "plot" : "plotrc"

  // Underlay: every orthomosaic of this date (one per treatment block, say),
  // each flight's latest.
  const allRuns = useAllRuns()
  const latestJobs = useMemo(
    () =>
      new Set(
        allRuns
          .flatMap((r) => [
            r.steps.orthomosaic?.jobIds?.at(-1),
            ...(r.uploadScope?.treatments ?? []).map((t) => t.orthoJobId),
          ])
          .filter((j): j is string => Boolean(j)),
      ),
    [allRuns],
  )
  const dayOrthos = useMemo(
    () => (date ? dateOrthos(files, date, latestJobs) : []),
    [files, date, latestJobs],
  )
  const [showOrtho, setShowOrtho] = useState(true)
  const tileUrls = useMemo(
    () =>
      showOrtho
        ? dayOrthos.map((o) =>
            buildTitilerTileUrl(
              `s3://${DEFAULT_BUCKET}/${o.cogPath ?? o.path}`,
            ),
          )
        : [],
    [showOrtho, dayOrthos],
  )
  const [fillOpacity, setFillOpacity] = useState(0.8)
  const [orthoOpacity, setOrthoOpacity] = useState(1)

  // Per-plot PNGs for the click-through, from this date's flight.
  const datePlotImages = useMemo(
    () => (date ? plotImagesForDate(files, date) : new Map<number, string>()),
    [files, date],
  )
  const [clickedPlot, setClickedPlot] = useState<{
    plot: number
    props: Record<string, unknown>
  } | null>(null)

  // Hover: the other traits of this date, per plot, so the tooltip can list
  // them while the colour shows one. Capped so it stays readable.
  const hoverTraits = useMemo(
    () =>
      [...dateTraits]
        .sort((a, b) => a.localeCompare(b))
        .slice(0, HOVER_TRAIT_LIMIT),
    [dateTraits],
  )
  const hoverQuery = useQuery({
    queryKey: [
      "analyze",
      "map",
      "hover",
      ctx.experimentName,
      ctx.seasonName,
      ctx.siteName,
      ctx.populationName,
      date,
      hoverTraits.join("\u0000"),
    ],
    queryFn: () =>
      fetchMatrix({
        trait_names: hoverTraits,
        experiment_names: [ctx.experimentName as string],
        season_names: [ctx.seasonName as string],
        site_names: [ctx.siteName as string],
        ...(ctx.populationName ? { populations: [ctx.populationName] } : {}),
        aggregation: "date",
        aggregation_date: date,
      }),
    enabled:
      hasPolygons &&
      hoverTraits.length > 0 &&
      Boolean(date && ctx.experimentName && ctx.seasonName && ctx.siteName),
  })

  // Join the values onto the polygons. When no trait is chosen we just
  // pass the unjoined FC through (TraitMap will render outline-only).
  const joinedFc = useMemo(() => {
    if (!polygonsFc) return null
    const base =
      !selectedTrait || !traitValues || traitValues.size === 0
        ? polygonsFc
        : joinTraitToPolygons(
            polygonsFc,
            traitValues,
            selectedTrait.trait_name,
            joinKeyMode,
          )
    const rows = hoverQuery.data?.rows ?? []
    return rows.length ? attachHoverValues(base, rows, joinKeyMode) : base
  }, [polygonsFc, selectedTrait, traitValues, joinKeyMode, hoverQuery.data])

  // Zero-overlap diagnostic: a trait can have records in this scope yet
  // share no plot key with the displayed boundaries (e.g. the boundary
  // grid numbered plots 1..N locally while the trait sheet uses the
  // field's true 701.. numbering). Without this the map just shows the
  // "no value" gray everywhere, indistinguishable from "no data".
  const overlap = useMemo(() => {
    if (!selectedTrait || !polygonsFc || !traitValues) return null
    const recordCount = valuesQuery.data?.recordCount ?? 0
    if (recordCount === 0) return null // genuinely no records → not this case
    let matched = 0
    for (const f of polygonsFc.features) {
      const props = f.properties ?? {}
      const key = plotKey(
        props.plot_number ?? null,
        props.plot_row_number ?? null,
        props.plot_column_number ?? null,
        joinKeyMode,
      )
      if (key !== null && traitValues.has(key)) matched += 1
    }
    if (matched > 0) return null // some overlap → heatmap renders, no warning
    // Plot-number ranges for the message.
    let pMin = Number.POSITIVE_INFINITY
    let pMax = Number.NEGATIVE_INFINITY
    for (const f of polygonsFc.features) {
      const n = (f.properties as { plot_number?: number | null })?.plot_number
      if (typeof n === "number" && Number.isFinite(n)) {
        if (n < pMin) pMin = n
        if (n > pMax) pMax = n
      }
    }
    return {
      recordCount,
      recordRange: valuesQuery.data?.plotNumberRange ?? null,
      boundaryRange: Number.isFinite(pMin) ? { min: pMin, max: pMax } : null,
      populationScoped: Boolean(ctx.populationId),
    }
  }, [
    selectedTrait,
    polygonsFc,
    traitValues,
    valuesQuery.data,
    joinKeyMode,
    ctx.populationId,
  ])

  return (
    <div className="flex flex-col gap-4" data-testid="analyze-map">
      <ProcessScopeSelectors allowAllPopulations />

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <Label
            htmlFor="analyze-map-date"
            className="text-xs text-muted-foreground"
          >
            Date
          </Label>
          <Select
            value={date || "__none__"}
            onValueChange={(v) =>
              setFields((f) => ({ ...f, date: v === "__none__" ? "" : v }))
            }
            disabled={dates.length === 0}
          >
            <SelectTrigger
              id="analyze-map-date"
              data-testid="analyze-map-date"
              className="w-56"
            >
              <SelectValue
                placeholder={catalog.isLoading ? "Loading dates…" : "No dates"}
              />
            </SelectTrigger>
            <SelectContent>
              {dates.map((d) => (
                <SelectItem key={d.date} value={d.date}>
                  {d.date}
                  <span className="text-muted-foreground ml-2 text-xs">
                    {d.traits && d.ortho
                      ? "traits · image"
                      : d.traits
                        ? "traits"
                        : "image only"}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label
            htmlFor="analyze-map-trait"
            className="text-xs text-muted-foreground"
          >
            Trait (heatmap)
          </Label>
          <Select
            value={fields.traitId}
            onValueChange={(v) =>
              setFields((f) => ({ ...f, traitId: v === "__none__" ? "" : v }))
            }
          >
            <SelectTrigger
              id="analyze-map-trait"
              data-testid="analyze-map-trait"
              className="w-60"
            >
              <SelectValue
                placeholder={
                  traitsQuery.isLoading
                    ? "Loading traits…"
                    : traits.length
                      ? "Outline only"
                      : "No traits on this date"
                }
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Outline only</SelectItem>
              {traits.map((t) => (
                <SelectItem key={idAsString(t.id)} value={idAsString(t.id)}>
                  {t.trait_name}
                  {t.trait_units ? ` (${t.trait_units})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label
            htmlFor="analyze-map-underlay"
            className="text-xs text-muted-foreground"
          >
            Ortho underlay
          </Label>
          <Select
            value={showOrtho && dayOrthos.length ? "date" : "__none__"}
            onValueChange={(v) => setShowOrtho(v === "date")}
            disabled={dayOrthos.length === 0}
          >
            <SelectTrigger
              id="analyze-map-underlay"
              data-testid="analyze-map-underlay"
              className="w-72"
            >
              <SelectValue
                placeholder={
                  listing.isLoading ? "Loading orthos…" : "None for this date"
                }
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {dayOrthos.length > 0 && (
                <SelectItem value="date">
                  {date}
                  {dayOrthos.length > 1
                    ? ` (${dayOrthos.length} orthomosaics)`
                    : ""}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>

        <OpacitySlider
          id="analyze-map-fill-opacity"
          label="Plot fill"
          value={fillOpacity}
          onChange={setFillOpacity}
        />
        {tileUrls.length > 0 && (
          <OpacitySlider
            id="analyze-map-ortho-opacity"
            label="Ortho"
            value={orthoOpacity}
            onChange={setOrthoOpacity}
          />
        )}
      </div>

      {!hasScopeIds && (
        <p
          className="text-sm text-muted-foreground"
          data-testid="analyze-map-needs-scope"
        >
          Pick an experiment, season, and site to load saved plot boundaries.
        </p>
      )}

      {hasScopeIds && (polygonsQuery.isLoading || boundariesLoading) && (
        <p
          className="text-sm text-muted-foreground"
          data-testid="analyze-map-loading"
        >
          Loading plot boundaries…
        </p>
      )}

      {hasScopeIds &&
        !polygonsQuery.isLoading &&
        !boundariesLoading &&
        !hasPolygons && (
          <p
            className="text-sm text-muted-foreground"
            data-testid="analyze-map-no-polygons"
          >
            No plot boundaries saved for this scope yet. Run the Plot Boundary
            Prep tool in the Process pipeline first.
          </p>
        )}

      {overlap && (
        <p
          className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800"
          data-testid="analyze-map-no-trait-overlap"
        >
          {selectedTrait?.trait_name} has {overlap.recordCount} record
          {overlap.recordCount === 1 ? "" : "s"} in this scope, but none match
          the plot numbering of these boundaries
          {overlap.recordRange
            ? ` (records use plots ${overlap.recordRange.min}–${overlap.recordRange.max}`
            : ""}
          {overlap.recordRange && overlap.boundaryRange
            ? `; boundaries use ${overlap.boundaryRange.min}–${overlap.boundaryRange.max})`
            : overlap.recordRange
              ? ")"
              : ""}
          .{" "}
          {overlap.populationScoped
            ? "Set a plot-number offset / fill pattern in the Plot Boundary tool, or upload the matching field-design CSV, so the boundary plot numbers match the records."
            : "Select the matching Population above to join by plot number, or set a plot-number offset in the Plot Boundary tool."}
        </p>
      )}

      {hasPolygons && joinedFc && (
        <TraitMap
          data={joinedFc}
          traitColumn={
            selectedTrait && traitValues && traitValues.size > 0
              ? selectedTrait.trait_name
              : undefined
          }
          onPlotClick={(plot, props) => setClickedPlot({ plot, props })}
          orthoTileUrl={tileUrls}
          orthoOpacity={orthoOpacity}
          fillOpacity={fillOpacity}
        />
      )}

      <PlotImageDialog
        open={clickedPlot !== null}
        onClose={() => setClickedPlot(null)}
        plot={clickedPlot?.plot ?? null}
        properties={clickedPlot?.props}
        objectPath={
          clickedPlot ? (datePlotImages.get(clickedPlot.plot) ?? null) : null
        }
        loading={listing.isLoading}
      />
    </div>
  )
}

function OpacitySlider({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label} opacity ({Math.round(value * 100)}%)
      </Label>
      <input
        id={id}
        data-testid={id}
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="block w-32"
      />
    </div>
  )
}
