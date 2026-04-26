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
import type { AerialScope } from "@/features/process/lib/paths"
import { yearFromDate } from "@/features/process/lib/paths"

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
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label htmlFor="aerial-date" className="mb-1.5 text-xs">
            Date
          </Label>
          <Input
            id="aerial-date"
            type="date"
            value={value.date}
            onChange={(e) => onChange({ ...value, date: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="aerial-platform" className="mb-1.5 text-xs">
            Platform
          </Label>
          <Input
            id="aerial-platform"
            list="aerial-platform-options"
            placeholder="Drone"
            value={value.platform}
            onChange={(e) => onChange({ ...value, platform: e.target.value })}
          />
          <datalist id="aerial-platform-options">
            {COMMON_PLATFORMS.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>
        <div>
          <Label htmlFor="aerial-sensor" className="mb-1.5 text-xs">
            Sensor
          </Label>
          <Input
            id="aerial-sensor"
            list="aerial-sensor-options"
            placeholder="RGB"
            value={value.sensor}
            onChange={(e) => onChange({ ...value, sensor: e.target.value })}
          />
          <datalist id="aerial-sensor-options">
            {COMMON_SENSORS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
      </div>
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
              onChange={(e) => onChange({ ...value, experimentOverride: e.target.value })}
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
              onChange={(e) => onChange({ ...value, locationOverride: e.target.value })}
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
              onChange={(e) => onChange({ ...value, populationOverride: e.target.value })}
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
