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
 *
 * The five experiment-scoped resolvers (Site, Population, Season,
 * SensorPlatform, Sensor) all delegate to a single factory at
 * `src/features/files/lib/uploadScopeHelpers.ts`. Experiment is its own
 * special case because it searches without an experiment scope and also
 * runs ensureUserAssociated.
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
import { resolveOrCreateEntity } from "@/features/files/lib/uploadScopeHelpers"
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

  /**
   * Experiment is the special case: it searches without an experiment
   * scope and also runs ensureUserAssociated so the new row appears in
   * the user's experiment dropdown.
   */
  async function resolveOrCreateExperiment(
    c: EntityChoice,
  ): Promise<{ id: string; name: string }> {
    if (c.kind === "existing") return { id: c.id, name: c.name }
    if (c.kind === "new") {
      const trimmed = c.name.trim()
      if (!trimmed) throw new Error("New experiment name is empty")
      const existing = (await ExperimentsService.apiExperimentsGetExperiments({
        experimentName: trimmed,
      })) as ExperimentOutput[] | null
      const match = existing?.find((e) => e.experiment_name === trimmed)
      const expId =
        match?.id != null
          ? String(match.id)
          : await (async () => {
              const created = (await ExperimentsService.apiExperimentsCreateExperiment({
                requestBody: { experiment_name: trimmed },
              })) as ExperimentOutput
              return String(created.id ?? "")
            })()
      await ensureUserAssociated(expId)
      qc.invalidateQueries({ queryKey: ["experiments", "all"] })
      qc.invalidateQueries({ queryKey: ["users", "me", "experiments"] })
      return { id: expId, name: trimmed }
    }
    throw new Error("Experiment is required")
  }

  function invalidateAfter(...keys: string[]) {
    return () => {
      for (const k of keys) qc.invalidateQueries({ queryKey: [k] })
      qc.invalidateQueries({ queryKey: ["experiments"] })
    }
  }

  function resolveOrCreateSite(c: EntityChoice, parentExperiment: string) {
    return resolveOrCreateEntity<SiteOutput>(c, {
      entityLabel: "site",
      search: async (name) =>
        (await SitesService.apiSitesGetSites({
          siteName: name,
          experimentName: parentExperiment,
        })) as SiteOutput[] | null,
      getName: (r) => r.site_name,
      getId: (r) => r.id,
      create: async (name) =>
        (await SitesService.apiSitesCreateSite({
          requestBody: { site_name: name, experiment_name: parentExperiment },
        })) as SiteOutput,
      onResolved: invalidateAfter("sites"),
    })
  }

  function resolveOrCreatePopulation(c: EntityChoice, parentExperiment: string) {
    return resolveOrCreateEntity<PopulationOutput>(c, {
      entityLabel: "population",
      search: async (name) =>
        (await PopulationsService.apiPopulationsGetPopulations({
          populationName: name,
          experimentName: parentExperiment,
        })) as PopulationOutput[] | null,
      getName: (r) => r.population_name,
      getId: (r) => r.id,
      create: async (name) =>
        (await PopulationsService.apiPopulationsCreatePopulation({
          requestBody: { population_name: name, experiment_name: parentExperiment },
        })) as PopulationOutput,
      onResolved: invalidateAfter("populations"),
    })
  }

  function resolveOrCreateSeason(c: EntityChoice, parentExperiment: string) {
    return resolveOrCreateEntity<SeasonOutput>(c, {
      entityLabel: "season",
      search: async (name) =>
        (await SeasonsService.apiSeasonsGetSeasons({
          seasonName: name,
          experimentName: parentExperiment,
        })) as SeasonOutput[] | null,
      getName: (r) => r.season_name,
      getId: (r) => r.id,
      create: async (name) =>
        (await SeasonsService.apiSeasonsCreateSeason({
          requestBody: { season_name: name, experiment_name: parentExperiment },
        })) as SeasonOutput,
      onResolved: invalidateAfter("seasons"),
    })
  }

  function resolveOrCreateSensorPlatform(
    c: EntityChoice,
    parentExperiment: string,
  ) {
    return resolveOrCreateEntity<SensorPlatformOutput>(c, {
      entityLabel: "sensor platform",
      search: async (name) =>
        (await SensorPlatformsService.apiSensorPlatformsGetSensorPlatforms({
          sensorPlatformName: name,
          experimentName: parentExperiment,
        })) as SensorPlatformOutput[] | null,
      getName: (r) => r.sensor_platform_name,
      getId: (r) => r.id,
      create: async (name) =>
        (await SensorPlatformsService.apiSensorPlatformsCreateSensorPlatform({
          requestBody: {
            sensor_platform_name: name,
            experiment_name: parentExperiment,
          },
        })) as SensorPlatformOutput,
      onResolved: invalidateAfter("sensorPlatforms"),
    })
  }

  function resolveOrCreateSensor(
    c: EntityChoice,
    parentExperiment: string,
    parentPlatform: string,
  ) {
    return resolveOrCreateEntity<SensorOutput>(c, {
      entityLabel: "sensor",
      search: async (name) =>
        (await SensorsService.apiSensorsGetSensors({
          sensorName: name,
          experimentName: parentExperiment,
        })) as SensorOutput[] | null,
      getName: (r) => r.sensor_name,
      getId: (r) => r.id,
      create: async (name) =>
        (await SensorsService.apiSensorsCreateSensor({
          requestBody: {
            sensor_name: name,
            experiment_name: parentExperiment,
            sensor_platform_name: parentPlatform,
          },
        })) as SensorOutput,
      onResolved: invalidateAfter("sensors"),
    })
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
