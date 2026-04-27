/**
 * AerialScopePicker — shared scope picker for the Phase-7 aerial pipeline.
 *
 * The experiment / season / site / population side comes from the global
 * ExperimentSelector (sidebar). Each Phase-7 tool additionally needs:
 *   - date (per-flight date, "YYYY-MM-DD")
 *   - platform (e.g. "Drone")
 *   - sensor (e.g. "RGB")
 *
 * These three live as local state on each tool page rather than the global
 * scope, because they vary mission-to-mission and the user often runs
 * RUN_ODM for one date while looking at SPLIT_ORTHOMOSAIC for another.
 *
 * The component is "controlled" — the parent owns the values and hands them
 * back from the worker calls.
 */
import { useExperimentScope } from "@/contexts/ExperimentContext"
import {
  useExperimentPopulations,
  useExperimentSeasons,
  useExperimentSites,
  useAllExperiments,
} from "@/features/experiments/hooks/useExperimentData"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { AerialScope } from "@/features/process/lib/paths"
import { yearFromDate } from "@/features/process/lib/paths"
import { useAvailableScopeOptions } from "@/features/process/hooks/useAvailableScopeOptions"

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
export const COMMON_SENSORS = ["RGB", "Thermal", "Multispectral", "LiDAR", "FC6310S"] as const

export function useAerialScopeContext(): AerialScopeContext {
  const { experimentId, seasonId, siteId, populationId } = useExperimentScope()
  const { data: experiments = [] } = useAllExperiments()
  const { data: seasons = [] } = useExperimentSeasons(experimentId)
  const { data: sites = [] } = useExperimentSites(experimentId)
  const { data: populations = [] } = useExperimentPopulations(experimentId)

  const experimentName =
    (experiments.find((e) => String(e.id) === experimentId)?.experiment_name ?? "") || ""
  const seasonName =
    (seasons.find((s) => String(s.id) === seasonId)?.season_name ?? "") || ""
  const siteName = (sites.find((s) => String(s.id) === siteId)?.site_name ?? "") || ""
  const populationName =
    (populations.find((p) => String(p.id) === populationId)?.population_name ?? "") || ""

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
    !available.isLoading && Boolean(value.date) && available.platforms.length === 0
  const sensorsEmpty =
    !available.isLoading && Boolean(value.platform) && available.sensors.length === 0

  return (
    <div className="space-y-3">
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
              Pick experiment / site / population in the sidebar first.
            </p>
          ) : (
            <Select
              value={value.date || ""}
              onValueChange={(v) => onChange({ ...value, date: v, platform: "", sensor: "" })}
              disabled={available.isLoading || datesEmpty}
            >
              <SelectTrigger
                id="aerial-date"
                data-testid="aerial-date-select"
              >
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
            onValueChange={(v) => onChange({ ...value, platform: v, sensor: "" })}
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
          No data has been uploaded yet under this experiment / site / population.
          Upload some via the Files tab first, then come back here.
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
              placeholder="(uses sidebar experiment)"
              value={value.experimentOverride ?? ""}
              onChange={(e) => onChange({ ...value, experimentOverride: e.target.value, date: "", platform: "", sensor: "" })}
            />
          </div>
          <div>
            <Label htmlFor="aerial-location" className="mb-1.5 text-xs">
              Site override
            </Label>
            <Input
              id="aerial-location"
              placeholder="(uses sidebar site)"
              value={value.locationOverride ?? ""}
              onChange={(e) => onChange({ ...value, locationOverride: e.target.value, date: "", platform: "", sensor: "" })}
            />
          </div>
          <div>
            <Label htmlFor="aerial-population" className="mb-1.5 text-xs">
              Population override
            </Label>
            <Input
              id="aerial-population"
              placeholder="(uses sidebar population)"
              value={value.populationOverride ?? ""}
              onChange={(e) => onChange({ ...value, populationOverride: e.target.value, date: "", platform: "", sensor: "" })}
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
