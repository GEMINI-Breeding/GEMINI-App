/**
 * Upload-scope persistence: reads the GEMINIbase entity tables that the
 * upload form's create-or-pick dropdowns offer, and exposes a
 * `resolveOrCreate` helper that turns a parent's `EntityChoice` map into
 * concrete (id, name) pairs by POSTing any "create new" rows first.
 *
 * Mirrors the create-or-get pattern from `backend/gemini-ui/src/components/
 * import-wizard/step-upload.tsx`: search by name first to dedupe across
 * multiple uploads, fall back to create on miss. This keeps two simultaneous
 * uploads of the same new experiment from racing into a unique-violation.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"

import {
  ExperimentsService,
  PopulationsService,
  SeasonsService,
  SensorPlatformsService,
  SensorsService,
  SitesService,
  UsersService,
  type ExperimentOutput,
  type PopulationOutput,
  type SeasonOutput,
  type SensorOutput,
  type SensorPlatformOutput,
  type SiteOutput,
} from "@/client"
import type { EntityChoice, EntityOption } from "@/features/files/components/EntitySelectField"
import { isLoggedIn } from "@/lib/auth"

export type ScopeKey = "experiment" | "site" | "population" | "season" | "sensorPlatform" | "sensor"

/** All the entity selections the form might collect. Date is plain text. */
export type UploadScopeChoices = Partial<Record<ScopeKey, EntityChoice>>

/** Resolved scope values used to build the upload path + run create calls. */
export type ResolvedScope = Partial<Record<ScopeKey, { id: string; name: string }>>

function asOptions<T extends { id?: string | number | null }>(
  rows: T[] | undefined,
  nameKey: keyof T,
): EntityOption[] {
  return (rows ?? [])
    .filter((r) => r.id != null && (r[nameKey] as unknown))
    .map((r) => ({ id: String(r.id), name: String(r[nameKey]) }))
}

/**
 * Pull every option set the form might need at once. Server returns flat
 * lists; we keep them in TanStack Query so refetching after a successful
 * create is one `invalidateQueries` away.
 */
export function useScopeOptions() {
  const enabled = isLoggedIn()
  const experiments = useQuery<ExperimentOutput[], Error>({
    queryKey: ["experiments", "all"],
    queryFn: async () =>
      (await ExperimentsService.apiExperimentsAllGetAllExperiments({
        limit: 500,
        offset: 0,
      })) as ExperimentOutput[] ?? [],
    enabled,
  })
  const sites = useQuery<SiteOutput[], Error>({
    queryKey: ["sites", "all"],
    queryFn: async () =>
      (await SitesService.apiSitesAllGetAllSites({
        limit: 500,
        offset: 0,
      })) as SiteOutput[] ?? [],
    enabled,
  })
  const populations = useQuery<PopulationOutput[], Error>({
    queryKey: ["populations", "all"],
    queryFn: async () =>
      (await PopulationsService.apiPopulationsAllGetAllPopulations({
        limit: 500,
        offset: 0,
      })) as PopulationOutput[] ?? [],
    enabled,
  })
  const seasons = useQuery<SeasonOutput[], Error>({
    queryKey: ["seasons", "all"],
    queryFn: async () =>
      (await SeasonsService.apiSeasonsAllGetAllSeasons({
        limit: 500,
        offset: 0,
      })) as SeasonOutput[] ?? [],
    enabled,
  })
  const sensorPlatforms = useQuery<SensorPlatformOutput[], Error>({
    queryKey: ["sensorPlatforms", "all"],
    queryFn: async () =>
      (await SensorPlatformsService.apiSensorPlatformsAllGetAllSensorPlatforms({
        limit: 500,
        offset: 0,
      })) as SensorPlatformOutput[] ?? [],
    enabled,
  })
  const sensors = useQuery<SensorOutput[], Error>({
    queryKey: ["sensors", "all"],
    queryFn: async () =>
      (await SensorsService.apiSensorsAllGetAllSensors({
        limit: 500,
        offset: 0,
      })) as SensorOutput[] ?? [],
    enabled,
  })

  return {
    experiment: {
      options: asOptions(experiments.data, "experiment_name"),
      isLoading: experiments.isLoading,
    },
    site: {
      options: asOptions(sites.data, "site_name"),
      isLoading: sites.isLoading,
    },
    population: {
      options: asOptions(populations.data, "population_name"),
      isLoading: populations.isLoading,
    },
    season: {
      options: asOptions(seasons.data, "season_name"),
      isLoading: seasons.isLoading,
    },
    sensorPlatform: {
      options: asOptions(sensorPlatforms.data, "sensor_platform_name"),
      isLoading: sensorPlatforms.isLoading,
    },
    sensor: {
      options: asOptions(sensors.data, "sensor_name"),
      isLoading: sensors.isLoading,
    },
  }
}

/**
 * For every scope the user marked "new", create the row on the backend
 * before the upload starts. Search-by-name first so concurrent uploads
 * of the same name dedupe instead of racing.
 *
 * Returns the resolved {id, name} for every key in `choices`. Throws
 * with a per-entity message if any creation fails — the caller surfaces
 * that in the upload-error dialog.
 */
export function useResolveScope() {
  const qc = useQueryClient()

  async function resolveOrCreateExperiment(c: EntityChoice): Promise<{ id: string; name: string }> {
    if (c.kind === "existing") return { id: c.id, name: c.name }
    if (c.kind === "new") {
      const trimmed = c.name.trim()
      if (!trimmed) throw new Error("New experiment name is empty")
      // Search first. If it already exists globally we still want to ensure
      // the current user is associated — without that link the sidebar
      // ExperimentSelector filters it out and the just-created experiment
      // appears as "no experiments available."
      const existing = (await ExperimentsService.apiExperimentsGetExperiments({
        experimentName: trimmed,
      })) as ExperimentOutput[] | null
      const match = existing?.find((e) => e.experiment_name === trimmed)
      const expId = match?.id != null
        ? String(match.id)
        : await createExperimentRow(trimmed)
      await ensureUserAssociated(expId)
      qc.invalidateQueries({ queryKey: ["experiments", "all"] })
      qc.invalidateQueries({ queryKey: ["users", "me", "experiments"] })
      return { id: expId, name: trimmed }
    }
    throw new Error("Experiment is required")
  }

  async function createExperimentRow(name: string): Promise<string> {
    const created = (await ExperimentsService.apiExperimentsCreateExperiment({
      requestBody: { experiment_name: name },
    })) as ExperimentOutput
    return String(created.id ?? "")
  }

  /**
   * Idempotent "this user owns this experiment" link. POSTing to
   * /me/experiments when the link already exists is a no-op on the
   * backend (returns 200 with a "already associated" message).
   * Anything else is best-effort: a failure here doesn't void the
   * upload — the user can still see the experiment via /admin if
   * they're a superuser.
   */
  async function ensureUserAssociated(experimentId: string): Promise<void> {
    if (!experimentId) return
    try {
      await UsersService.apiUsersMeExperimentsAssociateMyExperiment({
        requestBody: { experiment_id: experimentId },
      })
    } catch {
      // Best-effort.
    }
  }

  async function resolveOrCreateSite(
    c: EntityChoice,
    parentExperiment: string,
  ): Promise<{ id: string; name: string }> {
    if (c.kind === "existing") return { id: c.id, name: c.name }
    if (c.kind === "new") {
      const trimmed = c.name.trim()
      if (!trimmed) throw new Error("New site name is empty")
      // Scope the search to the parent experiment: a Site row that exists
      // globally but isn't linked to the active experiment is a *new
      // association*, not a reuse. Re-calling create with experiment_name
      // is safe — the backend's get_or_create dedupes on row identity and
      // always re-runs `associate_experiment` if the link is missing.
      const scoped = (await SitesService.apiSitesGetSites({
        siteName: trimmed,
        experimentName: parentExperiment,
      })) as SiteOutput[] | null
      const match = scoped?.find((s) => s.site_name === trimmed)
      if (match?.id != null) return { id: String(match.id), name: trimmed }
      const created = (await SitesService.apiSitesCreateSite({
        requestBody: { site_name: trimmed, experiment_name: parentExperiment },
      })) as SiteOutput
      qc.invalidateQueries({ queryKey: ["sites", "all"] })
      qc.invalidateQueries({ queryKey: ["experiments"] })
      return { id: String(created.id ?? ""), name: trimmed }
    }
    throw new Error("Site is required")
  }

  async function resolveOrCreatePopulation(
    c: EntityChoice,
    parentExperiment: string,
  ): Promise<{ id: string; name: string }> {
    if (c.kind === "existing") return { id: c.id, name: c.name }
    if (c.kind === "new") {
      const trimmed = c.name.trim()
      if (!trimmed) throw new Error("New population name is empty")
      const scoped = (await PopulationsService.apiPopulationsGetPopulations({
        populationName: trimmed,
        experimentName: parentExperiment,
      })) as PopulationOutput[] | null
      const match = scoped?.find((p) => p.population_name === trimmed)
      if (match?.id != null) return { id: String(match.id), name: trimmed }
      const created = (await PopulationsService.apiPopulationsCreatePopulation({
        requestBody: { population_name: trimmed, experiment_name: parentExperiment },
      })) as PopulationOutput
      qc.invalidateQueries({ queryKey: ["populations", "all"] })
      qc.invalidateQueries({ queryKey: ["experiments"] })
      return { id: String(created.id ?? ""), name: trimmed }
    }
    throw new Error("Population is required")
  }

  async function resolveOrCreateSeason(
    c: EntityChoice,
    parentExperiment: string,
  ): Promise<{ id: string; name: string }> {
    if (c.kind === "existing") return { id: c.id, name: c.name }
    if (c.kind === "new") {
      const trimmed = c.name.trim()
      if (!trimmed) throw new Error("New season name is empty")
      const scoped = (await SeasonsService.apiSeasonsGetSeasons({
        seasonName: trimmed,
        experimentName: parentExperiment,
      })) as SeasonOutput[] | null
      const match = scoped?.find((s) => s.season_name === trimmed)
      if (match?.id != null) return { id: String(match.id), name: trimmed }
      const created = (await SeasonsService.apiSeasonsCreateSeason({
        requestBody: { season_name: trimmed, experiment_name: parentExperiment },
      })) as SeasonOutput
      qc.invalidateQueries({ queryKey: ["seasons", "all"] })
      qc.invalidateQueries({ queryKey: ["experiments"] })
      return { id: String(created.id ?? ""), name: trimmed }
    }
    throw new Error("Season is required")
  }

  async function resolveOrCreateSensorPlatform(
    c: EntityChoice,
    parentExperiment: string,
  ): Promise<{ id: string; name: string }> {
    if (c.kind === "existing") return { id: c.id, name: c.name }
    if (c.kind === "new") {
      const trimmed = c.name.trim()
      if (!trimmed) throw new Error("New sensor platform name is empty")
      const scoped = (await SensorPlatformsService.apiSensorPlatformsGetSensorPlatforms({
        sensorPlatformName: trimmed,
        experimentName: parentExperiment,
      })) as SensorPlatformOutput[] | null
      const match = scoped?.find((s) => s.sensor_platform_name === trimmed)
      if (match?.id != null) return { id: String(match.id), name: trimmed }
      const created = (await SensorPlatformsService.apiSensorPlatformsCreateSensorPlatform({
        requestBody: {
          sensor_platform_name: trimmed,
          experiment_name: parentExperiment,
        },
      })) as SensorPlatformOutput
      qc.invalidateQueries({ queryKey: ["sensorPlatforms", "all"] })
      qc.invalidateQueries({ queryKey: ["experiments"] })
      return { id: String(created.id ?? ""), name: trimmed }
    }
    throw new Error("Sensor platform is required")
  }

  async function resolveOrCreateSensor(
    c: EntityChoice,
    parentExperiment: string,
    parentPlatform: string,
  ): Promise<{ id: string; name: string }> {
    if (c.kind === "existing") return { id: c.id, name: c.name }
    if (c.kind === "new") {
      const trimmed = c.name.trim()
      if (!trimmed) throw new Error("New sensor name is empty")
      const scoped = (await SensorsService.apiSensorsGetSensors({
        sensorName: trimmed,
        experimentName: parentExperiment,
      })) as SensorOutput[] | null
      const match = scoped?.find((s) => s.sensor_name === trimmed)
      if (match?.id != null) return { id: String(match.id), name: trimmed }
      const created = (await SensorsService.apiSensorsCreateSensor({
        requestBody: {
          sensor_name: trimmed,
          experiment_name: parentExperiment,
          sensor_platform_name: parentPlatform,
        },
      })) as SensorOutput
      qc.invalidateQueries({ queryKey: ["sensors", "all"] })
      qc.invalidateQueries({ queryKey: ["experiments"] })
      return { id: String(created.id ?? ""), name: trimmed }
    }
    throw new Error("Sensor is required")
  }

  /**
   * Resolve a full set of choices in dependency order. Skips entities
   * that aren't in `choices` (data types only require a subset).
   */
  async function resolveScope(choices: UploadScopeChoices): Promise<ResolvedScope> {
    const out: ResolvedScope = {}

    if (choices.experiment) {
      out.experiment = await resolveOrCreateExperiment(choices.experiment)
    }
    const expName = out.experiment?.name ?? ""

    if (choices.site) out.site = await resolveOrCreateSite(choices.site, expName)
    if (choices.population) out.population = await resolveOrCreatePopulation(choices.population, expName)
    if (choices.season) out.season = await resolveOrCreateSeason(choices.season, expName)
    if (choices.sensorPlatform) {
      out.sensorPlatform = await resolveOrCreateSensorPlatform(choices.sensorPlatform, expName)
    }
    const platformName = out.sensorPlatform?.name ?? ""
    if (choices.sensor) {
      out.sensor = await resolveOrCreateSensor(choices.sensor, expName, platformName)
    }

    return out
  }

  return { resolveScope }
}
