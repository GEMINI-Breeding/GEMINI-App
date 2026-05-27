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
import { joinTraitToPolygons } from "../lib/joinTraitToPolygons"

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
  const polygonsQuery = usePlotPolygons({
    experimentId: ctx.experimentId,
    seasonId: ctx.seasonId,
    siteId: ctx.siteId,
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
  })

  // Join the values onto the polygons. When no trait is chosen we just
  // pass the unjoined FC through (TraitMap will render outline-only).
  const joinedFc = useMemo(() => {
    if (!polygonsFc) return null
    if (!selectedTrait || !valuesQuery.data || valuesQuery.data.size === 0) {
      return polygonsFc
    }
    return joinTraitToPolygons(
      polygonsFc,
      valuesQuery.data,
      selectedTrait.trait_name,
    )
  }, [polygonsFc, selectedTrait, valuesQuery.data])

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

      {hasPolygons && joinedFc && (
        <TraitMap
          data={joinedFc}
          traitColumn={
            selectedTrait && valuesQuery.data && valuesQuery.data.size > 0
              ? selectedTrait.trait_name
              : undefined
          }
        />
      )}
    </div>
  )
}
