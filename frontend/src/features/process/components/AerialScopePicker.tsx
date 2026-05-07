/**
 * AerialScopePicker — shared scope picker for the Process tool pages.
 *
 * Owns the full scope locally (no global sidebar dependency):
 *   - experiment / season / site / population — from useProcessScope, a
 *     localStorage-backed store shared by every Process tool page so that
 *     navigating between Orthomosaic / Boundaries / Split / Traits / Inference
 *     keeps the same scope across tabs and reloads.
 *   - date / platform / sensor — controlled by the parent tool page (these
 *     vary mission-to-mission and the user often runs RUN_ODM for one date
 *     while inspecting SPLIT_ORTHOMOSAIC for another).
 *
 * The override fields below are escape hatches for path components when the
 * data on disk doesn't have a matching entity row in the DB.
 */
import { useEffect, useMemo } from "react"

import type { ExperimentOutput } from "@/client"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  useAllExperiments,
  useExperimentPopulations,
  useExperimentSeasons,
  useExperimentSites,
  useMyExperimentIds,
} from "@/features/experiments/hooks/useExperimentData"
import { useAvailableScopeOptions } from "@/features/process/hooks/useAvailableScopeOptions"
import type { AerialScope } from "@/features/process/lib/paths"
import { yearFromDate } from "@/features/process/lib/paths"
import { useProcessScope } from "@/features/process/lib/processScope"
import useAuth from "@/hooks/useAuth"

export type AerialScopeFields = {
  date: string
  platform: string
  sensor: string
  /** Override the experiment-context entity name (used as a path component). */
  experimentOverride?: string
  /** Override the site name. */
  locationOverride?: string
  /** Override the population name. */
  populationOverride?: string
}

export type AerialScopeContext = {
  experimentId: string | null
  seasonId: string | null
  siteId: string | null
  populationId: string | null
  experimentName: string
  seasonName: string
  siteName: string
  populationName: string
}

export const COMMON_PLATFORMS = ["Drone", "Amiga", "RoverM2", "DJI"] as const
export const COMMON_SENSORS = [
  "RGB",
  "Thermal",
  "Multispectral",
  "LiDAR",
  "FC6310S",
] as const

export function useAerialScopeContext(): AerialScopeContext {
  const { experimentId, seasonId, siteId, populationId } = useProcessScope()
  const { data: experiments = [] } = useAllExperiments()
  const { data: seasons = [] } = useExperimentSeasons(experimentId)
  const { data: sites = [] } = useExperimentSites(experimentId)
  const { data: populations = [] } = useExperimentPopulations(experimentId)

  const experimentName =
    (experiments.find((e) => String(e.id) === experimentId)?.experiment_name ??
      "") ||
    ""
  const seasonName =
    (seasons.find((s) => String(s.id) === seasonId)?.season_name ?? "") || ""
  const siteName =
    (sites.find((s) => String(s.id) === siteId)?.site_name ?? "") || ""
  const populationName =
    (populations.find((p) => String(p.id) === populationId)?.population_name ??
      "") ||
    ""

  return {
    experimentId,
    seasonId,
    siteId,
    populationId,
    experimentName,
    seasonName,
    siteName,
    populationName,
  }
}

export function buildAerialScope(
  ctx: AerialScopeContext,
  fields: AerialScopeFields,
): AerialScope {
  return {
    year: yearFromDate(fields.date) || ctx.seasonName,
    experiment: fields.experimentOverride?.trim() || ctx.experimentName,
    location: fields.locationOverride?.trim() || ctx.siteName,
    population: fields.populationOverride?.trim() || ctx.populationName,
    date: fields.date,
    platform: fields.platform,
    sensor: fields.sensor,
  }
}

function filterVisible(
  all: ExperimentOutput[],
  myIds: string[],
  isSuperuser: boolean,
): ExperimentOutput[] {
  if (isSuperuser) return all
  const mySet = new Set(myIds)
  return all.filter((e) => e.id != null && mySet.has(String(e.id)))
}

/**
 * Process-scope selectors: experiment / season / site / population.
 *
 * Renders inline above the date / platform / sensor row in the picker. Reads
 * from useProcessScope (the localStorage-backed Process-only scope store) so
 * the selection persists across Process tool tabs and reloads.
 *
 * Auto-picks the first visible experiment on mount if none is set yet, and
 * auto-picks any single-option child selector — same UX the deleted sidebar
 * ScopeChildSelectors offered.
 */
export function ProcessScopeSelectors() {
  const { user, isUserLoading } = useAuth()
  const {
    experimentId,
    setExperimentId,
    seasonId,
    setSeasonId,
    siteId,
    setSiteId,
    populationId,
    setPopulationId,
  } = useProcessScope()
  const isSuperuser = Boolean(user?.is_superuser)

  const { data: all, isLoading: loadingAll } = useAllExperiments()
  const { data: myIds, isLoading: loadingMyIds } = useMyExperimentIds()
  const { data: seasons = [], isLoading: loadingSeasons } =
    useExperimentSeasons(experimentId)
  const { data: sites = [], isLoading: loadingSites } =
    useExperimentSites(experimentId)
  const { data: populations = [], isLoading: loadingPopulations } =
    useExperimentPopulations(experimentId)

  const stillLoadingExperiments =
    loadingAll || isUserLoading || (!isSuperuser && loadingMyIds)

  const visible = useMemo(
    () => filterVisible(all ?? [], myIds ?? [], isSuperuser),
    [all, myIds, isSuperuser],
  )

  // Auto-select the first visible experiment if none is set, mirroring the
  // deleted sidebar ExperimentSelector. Also re-fire if the stored
  // experimentId no longer matches a visible row.
  useEffect(() => {
    if (visible.length === 0) return
    const match = experimentId
      ? visible.find((e) => String(e.id) === experimentId)
      : null
    if (!match && visible[0].id != null) {
      setExperimentId(String(visible[0].id))
    }
  }, [experimentId, visible, setExperimentId])

  // Auto-pick the only child option to save the user a click.
  useEffect(() => {
    if (!seasonId && seasons.length === 1 && seasons[0].id != null) {
      setSeasonId(String(seasons[0].id))
    }
  }, [seasonId, seasons, setSeasonId])
  useEffect(() => {
    if (!siteId && sites.length === 1 && sites[0].id != null) {
      setSiteId(String(sites[0].id))
    }
  }, [siteId, sites, setSiteId])
  useEffect(() => {
    if (
      !populationId &&
      populations.length === 1 &&
      populations[0].id != null
    ) {
      setPopulationId(String(populations[0].id))
    }
  }, [populationId, populations, setPopulationId])

  const seasonOptions = (seasons ?? [])
    .filter((s) => s.id != null)
    .map((s) => ({ id: String(s.id), name: s.season_name ?? "(unnamed)" }))
  const siteOptions = (sites ?? [])
    .filter((s) => s.id != null)
    .map((s) => ({ id: String(s.id), name: s.site_name ?? "(unnamed)" }))
  const populationOptions = (populations ?? [])
    .filter((p) => p.id != null)
    .map((p) => ({ id: String(p.id), name: p.population_name ?? "(unnamed)" }))

  return (
    <div className="grid grid-cols-4 gap-3">
      <div>
        <Label htmlFor="process-experiment" className="mb-1.5 text-xs">
          Experiment
        </Label>
        {stillLoadingExperiments ? (
          <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Loading…
          </p>
        ) : visible.length === 0 ? (
          <p
            data-testid="process-experiment-empty"
            className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
          >
            No experiments yet — create one via Files upload.
          </p>
        ) : (
          <Select
            value={experimentId ?? undefined}
            onValueChange={(v) => setExperimentId(v || null)}
          >
            <SelectTrigger
              id="process-experiment"
              data-testid="process-experiment-select"
            >
              <SelectValue placeholder="Select experiment" />
            </SelectTrigger>
            <SelectContent>
              {visible.map((e) => (
                <SelectItem key={String(e.id)} value={String(e.id)}>
                  {e.experiment_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <div>
        <Label htmlFor="process-season" className="mb-1.5 text-xs">
          Season
        </Label>
        <Select
          value={seasonId ?? undefined}
          onValueChange={(v) => setSeasonId(v || null)}
          disabled={
            !experimentId || loadingSeasons || seasonOptions.length === 0
          }
        >
          <SelectTrigger
            id="process-season"
            data-testid="process-season-select"
          >
            <SelectValue
              placeholder={
                !experimentId
                  ? "Pick experiment first"
                  : loadingSeasons
                    ? "Loading…"
                    : seasonOptions.length === 0
                      ? "None registered"
                      : "Select season"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {seasonOptions.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="process-site" className="mb-1.5 text-xs">
          Site
        </Label>
        <Select
          value={siteId ?? undefined}
          onValueChange={(v) => setSiteId(v || null)}
          disabled={!experimentId || loadingSites || siteOptions.length === 0}
        >
          <SelectTrigger id="process-site" data-testid="process-site-select">
            <SelectValue
              placeholder={
                !experimentId
                  ? "Pick experiment first"
                  : loadingSites
                    ? "Loading…"
                    : siteOptions.length === 0
                      ? "None registered"
                      : "Select site"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {siteOptions.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="process-population" className="mb-1.5 text-xs">
          Population
        </Label>
        <Select
          value={populationId ?? undefined}
          onValueChange={(v) => setPopulationId(v || null)}
          disabled={
            !experimentId ||
            loadingPopulations ||
            populationOptions.length === 0
          }
        >
          <SelectTrigger
            id="process-population"
            data-testid="process-population-select"
          >
            <SelectValue
              placeholder={
                !experimentId
                  ? "Pick experiment first"
                  : loadingPopulations
                    ? "Loading…"
                    : populationOptions.length === 0
                      ? "None registered"
                      : "Select population"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {populationOptions.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

export function AerialScopePicker({
  value,
  onChange,
}: {
  value: AerialScopeFields
  onChange: (next: AerialScopeFields) => void
}) {
  const ctx = useAerialScopeContext()

  // Resolve the picker's effective experiment/site/population — sidebar
  // values take precedence unless the override fields are non-blank.
  const effective = {
    experiment: value.experimentOverride?.trim() || ctx.experimentName,
    location: value.locationOverride?.trim() || ctx.siteName,
    population: value.populationOverride?.trim() || ctx.populationName,
  }

  const available = useAvailableScopeOptions(
    effective,
    value.date || null,
    value.platform || null,
  )

  const datesEmpty = !available.isLoading && available.dates.length === 0
  const platformsEmpty =
    !available.isLoading &&
    Boolean(value.date) &&
    available.platforms.length === 0
  const sensorsEmpty =
    !available.isLoading &&
    Boolean(value.platform) &&
    available.sensors.length === 0

  return (
    <div className="space-y-3">
      <ProcessScopeSelectors />
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label htmlFor="aerial-date" className="mb-1.5 text-xs">
            Date
          </Label>
          {available.scopeIncomplete ? (
            <p
              data-testid="aerial-date-empty"
              className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
            >
              Pick experiment / site / population above first.
            </p>
          ) : (
            <Select
              value={value.date || ""}
              onValueChange={(v) =>
                onChange({ ...value, date: v, platform: "", sensor: "" })
              }
              disabled={available.isLoading || datesEmpty}
            >
              <SelectTrigger id="aerial-date" data-testid="aerial-date-select">
                <SelectValue
                  placeholder={
                    available.isLoading
                      ? "Loading…"
                      : datesEmpty
                        ? "No data uploaded yet"
                        : "Select a date"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {available.dates.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div>
          <Label htmlFor="aerial-platform" className="mb-1.5 text-xs">
            Platform
          </Label>
          <Select
            value={value.platform || ""}
            onValueChange={(v) =>
              onChange({ ...value, platform: v, sensor: "" })
            }
            disabled={!value.date || available.isLoading || platformsEmpty}
          >
            <SelectTrigger
              id="aerial-platform"
              data-testid="aerial-platform-select"
            >
              <SelectValue
                placeholder={
                  !value.date
                    ? "Pick a date first"
                    : available.isLoading
                      ? "Loading…"
                      : platformsEmpty
                        ? "No platforms for this date"
                        : "Select a platform"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {available.platforms.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="aerial-sensor" className="mb-1.5 text-xs">
            Sensor
          </Label>
          <Select
            value={value.sensor || ""}
            onValueChange={(v) => onChange({ ...value, sensor: v })}
            disabled={!value.platform || available.isLoading || sensorsEmpty}
          >
            <SelectTrigger
              id="aerial-sensor"
              data-testid="aerial-sensor-select"
            >
              <SelectValue
                placeholder={
                  !value.platform
                    ? "Pick a platform first"
                    : available.isLoading
                      ? "Loading…"
                      : sensorsEmpty
                        ? "No sensors for this platform"
                        : "Select a sensor"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {available.sensors.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {available.empty && !available.scopeIncomplete && (
        <p
          data-testid="aerial-empty-state"
          className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800"
        >
          No data has been uploaded yet under this experiment / site /
          population. Upload some via the Files tab first, then come back here.
        </p>
      )}

      <details className="text-xs">
        <summary className="text-muted-foreground cursor-pointer select-none">
          Override path components (experiment / site / population)
        </summary>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <div>
            <Label htmlFor="aerial-experiment" className="mb-1.5 text-xs">
              Experiment override
            </Label>
            <Input
              id="aerial-experiment"
              placeholder="(uses scope experiment)"
              value={value.experimentOverride ?? ""}
              onChange={(e) =>
                onChange({
                  ...value,
                  experimentOverride: e.target.value,
                  date: "",
                  platform: "",
                  sensor: "",
                })
              }
            />
          </div>
          <div>
            <Label htmlFor="aerial-location" className="mb-1.5 text-xs">
              Site override
            </Label>
            <Input
              id="aerial-location"
              placeholder="(uses scope site)"
              value={value.locationOverride ?? ""}
              onChange={(e) =>
                onChange({
                  ...value,
                  locationOverride: e.target.value,
                  date: "",
                  platform: "",
                  sensor: "",
                })
              }
            />
          </div>
          <div>
            <Label htmlFor="aerial-population" className="mb-1.5 text-xs">
              Population override
            </Label>
            <Input
              id="aerial-population"
              placeholder="(uses scope population)"
              value={value.populationOverride ?? ""}
              onChange={(e) =>
                onChange({
                  ...value,
                  populationOverride: e.target.value,
                  date: "",
                  platform: "",
                  sensor: "",
                })
              }
            />
          </div>
        </div>
      </details>
    </div>
  )
}

const STORAGE_KEY = "gemini.aerial.scope"

export function readStoredAerialFields(): AerialScopeFields {
  if (typeof window === "undefined") {
    return { date: "", platform: "Drone", sensor: "RGB" }
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { date: "", platform: "Drone", sensor: "RGB" }
    const parsed = JSON.parse(raw) as Partial<AerialScopeFields>
    return {
      date: parsed.date ?? "",
      platform: parsed.platform ?? "Drone",
      sensor: parsed.sensor ?? "RGB",
    }
  } catch {
    return { date: "", platform: "Drone", sensor: "RGB" }
  }
}

export function writeStoredAerialFields(fields: AerialScopeFields): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fields))
  } catch {
    // Best-effort
  }
}
