/**
 * useResolveScope smoke tests. The factory's branches are exhaustively
 * covered by uploadScopeHelpers.test.ts; here we verify the hook's
 * orchestration: experiment-first, parent-experiment-name passes through,
 * each entity hits the right SDK endpoint with the right body, and
 * resolveScope skips entities the caller didn't supply.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  ExperimentsService,
  PopulationsService,
  SeasonsService,
  SensorPlatformsService,
  SensorsService,
  SitesService,
  UsersService,
} from "@/client"

import { useResolveScope } from "./useUploadScope"

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  localStorage.setItem("gemini.auth.token", "fake-token")
})
afterEach(() => {
  localStorage.removeItem("gemini.auth.token")
  vi.restoreAllMocks()
})

describe("useResolveScope.resolveScope", () => {
  it("passes existing choices through and skips unset entities", async () => {
    // No SDK calls should fire when every choice is "existing" — the
    // factory short-circuits.
    const sitesSpy = vi.spyOn(SitesService, "apiSitesGetSites")
    const popsSpy = vi.spyOn(PopulationsService, "apiPopulationsGetPopulations")
    const { result } = renderHook(() => useResolveScope(), { wrapper })
    const out = await result.current.resolveScope({
      experiment: { kind: "existing", id: "exp-1", name: "GEMINI" },
      site: { kind: "existing", id: "site-1", name: "Davis" },
    })
    expect(out).toEqual({
      experiment: { id: "exp-1", name: "GEMINI" },
      site: { id: "site-1", name: "Davis" },
    })
    expect(out.population).toBeUndefined()
    expect(sitesSpy).not.toHaveBeenCalled()
    expect(popsSpy).not.toHaveBeenCalled()
  })

  it("creates a new experiment + associates the user when missing", async () => {
    const getSpy = vi
      .spyOn(ExperimentsService, "apiExperimentsGetExperiments")
      .mockResolvedValue([] as never)
    const createSpy = vi
      .spyOn(ExperimentsService, "apiExperimentsCreateExperiment")
      .mockResolvedValue({
        id: "new-exp",
        experiment_name: "TomatoMAGIC",
      } as never)
    const associateSpy = vi
      .spyOn(UsersService, "apiUsersMeExperimentsAssociateMyExperiment")
      .mockResolvedValue({} as never)

    const { result } = renderHook(() => useResolveScope(), { wrapper })
    const out = await result.current.resolveScope({
      experiment: { kind: "new", name: "TomatoMAGIC" },
    })

    expect(getSpy).toHaveBeenCalledWith({ experimentName: "TomatoMAGIC" })
    expect(createSpy).toHaveBeenCalledWith({
      requestBody: { experiment_name: "TomatoMAGIC" },
    })
    expect(associateSpy).toHaveBeenCalledWith({
      requestBody: { experiment_id: "new-exp" },
    })
    expect(out.experiment).toEqual({ id: "new-exp", name: "TomatoMAGIC" })
  })

  it("threads the resolved experiment name into site/population/sensor creates", async () => {
    vi.spyOn(SitesService, "apiSitesGetSites").mockResolvedValue([] as never)
    const sitesCreate = vi
      .spyOn(SitesService, "apiSitesCreateSite")
      .mockResolvedValue({ id: 11, site_name: "Davis" } as never)
    vi.spyOn(
      PopulationsService,
      "apiPopulationsGetPopulations",
    ).mockResolvedValue([] as never)
    const popsCreate = vi
      .spyOn(PopulationsService, "apiPopulationsCreatePopulation")
      .mockResolvedValue({ id: 22, population_name: "Cowpea" } as never)
    vi.spyOn(
      SensorPlatformsService,
      "apiSensorPlatformsGetSensorPlatforms",
    ).mockResolvedValue([] as never)
    const platsCreate = vi
      .spyOn(SensorPlatformsService, "apiSensorPlatformsCreateSensorPlatform")
      .mockResolvedValue({ id: 33, sensor_platform_name: "Drone" } as never)
    vi.spyOn(SensorsService, "apiSensorsGetSensors").mockResolvedValue(
      [] as never,
    )
    const sensorsCreate = vi
      .spyOn(SensorsService, "apiSensorsCreateSensor")
      .mockResolvedValue({ id: 44, sensor_name: "RGB" } as never)

    const { result } = renderHook(() => useResolveScope(), { wrapper })
    const out = await result.current.resolveScope({
      experiment: { kind: "existing", id: "exp-1", name: "GEMINI" },
      site: { kind: "new", name: "Davis" },
      population: { kind: "new", name: "Cowpea" },
      sensorPlatform: { kind: "new", name: "Drone" },
      sensor: { kind: "new", name: "RGB" },
    })

    expect(sitesCreate).toHaveBeenCalledWith({
      requestBody: { site_name: "Davis", experiment_name: "GEMINI" },
    })
    expect(popsCreate).toHaveBeenCalledWith({
      requestBody: { population_name: "Cowpea", experiment_name: "GEMINI" },
    })
    expect(platsCreate).toHaveBeenCalledWith({
      requestBody: { sensor_platform_name: "Drone", experiment_name: "GEMINI" },
    })
    // Sensor inherits both parents.
    expect(sensorsCreate).toHaveBeenCalledWith({
      requestBody: {
        sensor_name: "RGB",
        experiment_name: "GEMINI",
        sensor_platform_name: "Drone",
      },
    })
    expect(out.sensor).toEqual({ id: "44", name: "RGB" })
  })

  it("dedupes when the season already exists by exact name", async () => {
    vi.spyOn(SeasonsService, "apiSeasonsGetSeasons").mockResolvedValue([
      { id: 9, season_name: "Summer 2026" },
    ] as never)
    const seasonsCreate = vi.spyOn(SeasonsService, "apiSeasonsCreateSeason")

    const { result } = renderHook(() => useResolveScope(), { wrapper })
    const out = await result.current.resolveScope({
      experiment: { kind: "existing", id: "e1", name: "GEMINI" },
      season: { kind: "new", name: "Summer 2026" },
    })

    expect(seasonsCreate).not.toHaveBeenCalled()
    expect(out.season).toEqual({ id: "9", name: "Summer 2026" })
  })

  it("propagates a meaningful error when a new entity name is blank", async () => {
    const { result } = renderHook(() => useResolveScope(), { wrapper })
    await expect(
      result.current.resolveScope({
        experiment: { kind: "new", name: "  " },
      }),
    ).rejects.toThrow(/experiment name is empty/i)
  })
})
