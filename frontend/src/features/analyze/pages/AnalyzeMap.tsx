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
import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"

import { type TraitOutput, TraitsService } from "@/client"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { idAsString } from "@/features/admin/lib/ids"
import {
  ProcessScopeSelectors,
  useAerialScopeContext,
} from "@/features/process/components/AerialScopePicker"
import { TraitMap } from "@/features/process/components/TraitMap"
import { usePlotPolygons } from "../hooks/usePlotPolygons"
import { usePlotTraitValues } from "../hooks/usePlotTraitValues"
import { joinTraitToPolygons, plotKey } from "../lib/joinTraitToPolygons"

const STORAGE_KEY = "gemini.analyze.map.fields.v1"

type LocalFields = {
  traitId: string
}

function loadLocalFields(): LocalFields {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { traitId: "" }
    const parsed = JSON.parse(raw) as Partial<LocalFields>
    return {
      traitId: typeof parsed.traitId === "string" ? parsed.traitId : "",
    }
  } catch {
    return { traitId: "" }
  }
}

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
  // Population narrows the join so plot_number alone is the key (it's unique
  // only within a population). When no population is picked we fall back to
  // the experiment/season/site scope + the composite plot+row+col key.
  const joinKeyMode = ctx.populationId ? "plot" : "plotrc"
  const polygonsQuery = usePlotPolygons({
    experimentId: ctx.experimentId,
    seasonId: ctx.seasonId,
    siteId: ctx.siteId,
    populationId: ctx.populationId,
  })
  const polygonsFc = polygonsQuery.data ?? null
  const hasPolygons = polygonsFc !== null && polygonsFc.features.length > 0

  // Trait list. Globally scoped today — the analyze page is read-only and
  // a long list is acceptable; the join will simply produce no matches for
  // traits without records in this scope (those features render in the
  // "no value" gray). Slice 5 may add an "only show traits with records
  // in this experiment" filter.
  const traitsQuery = useQuery({
    queryKey: ["analyze", "map", "traits"],
    queryFn: () =>
      TraitsService.apiTraitsAllGetAllTraits({ limit: 500, offset: 0 }),
  })
  const traits: TraitOutput[] = (traitsQuery.data as TraitOutput[] | null) ?? []
  const selectedTrait = useMemo(
    () => traits.find((t) => idAsString(t.id) === fields.traitId) ?? null,
    [traits, fields.traitId],
  )

  // Per-plot mean values for the chosen trait, scoped to the picked
  // experiment/season/site. Empty Map until a trait is chosen.
  const valuesQuery = usePlotTraitValues({
    traitId: fields.traitId || null,
    experimentName: ctx.experimentName || null,
    seasonName: ctx.seasonName || null,
    siteName: ctx.siteName || null,
    populationName: ctx.populationName || null,
  })

  const traitValues = valuesQuery.data?.values ?? null

  // Join the values onto the polygons. When no trait is chosen we just
  // pass the unjoined FC through (TraitMap will render outline-only).
  const joinedFc = useMemo(() => {
    if (!polygonsFc) return null
    if (!selectedTrait || !traitValues || traitValues.size === 0) {
      return polygonsFc
    }
    return joinTraitToPolygons(
      polygonsFc,
      traitValues,
      selectedTrait.trait_name,
      joinKeyMode,
    )
  }, [polygonsFc, selectedTrait, traitValues, joinKeyMode])

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
      <ProcessScopeSelectors />

      <div className="flex flex-wrap items-end gap-4">
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
                  traitsQuery.isLoading ? "Loading traits…" : "Outline only"
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
      </div>

      {!hasScopeIds && (
        <p
          className="text-sm text-muted-foreground"
          data-testid="analyze-map-needs-scope"
        >
          Pick an experiment, season, and site to load saved plot boundaries.
        </p>
      )}

      {hasScopeIds && polygonsQuery.isLoading && (
        <p
          className="text-sm text-muted-foreground"
          data-testid="analyze-map-loading"
        >
          Loading plot boundaries…
        </p>
      )}

      {hasScopeIds && !polygonsQuery.isLoading && !hasPolygons && (
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
        />
      )}
    </div>
  )
}
