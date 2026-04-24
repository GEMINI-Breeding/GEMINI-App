/**
 * Shared queries for the ExperimentSelector + friends.
 *
 * All hooks here are scoped read-only, auth-aware, and safe to call on
 * unauthenticated pages (they return `{ data: undefined, isLoading: false }`
 * when there's no logged-in user).
 */
import { useQuery } from "@tanstack/react-query"

import {
  ExperimentsService,
  UsersService,
  type ExperimentOutput,
  type PopulationOutput,
  type SeasonOutput,
  type SiteOutput,
} from "@/client"
import { isLoggedIn } from "@/lib/auth"

export function useMyExperimentIds() {
  return useQuery<string[], Error>({
    queryKey: ["users", "me", "experiments"],
    queryFn: async () => {
      const ids = await UsersService.apiUsersMeExperimentsListMyExperiments()
      return Array.isArray(ids) ? ids.map(String) : []
    },
    enabled: isLoggedIn(),
    staleTime: 30_000,
  })
}

export function useAllExperiments() {
  return useQuery<ExperimentOutput[], Error>({
    queryKey: ["experiments", "all"],
    queryFn: async () => {
      const res = await ExperimentsService.apiExperimentsAllGetAllExperiments(
        { limit: 500, offset: 0 },
      )
      return (res as ExperimentOutput[] | null) ?? []
    },
    enabled: isLoggedIn(),
  })
}

export function useExperimentSeasons(experimentId: string | null | undefined) {
  return useQuery<SeasonOutput[], Error>({
    queryKey: ["experiments", experimentId, "seasons"],
    queryFn: async () => {
      if (!experimentId) return []
      const res =
        await ExperimentsService.apiExperimentsIdExperimentIdSeasonsGetExperimentSeasons(
          { experimentId },
        )
      return (res as SeasonOutput[] | null) ?? []
    },
    enabled: isLoggedIn() && Boolean(experimentId),
  })
}

export function useExperimentSites(experimentId: string | null | undefined) {
  return useQuery<SiteOutput[], Error>({
    queryKey: ["experiments", experimentId, "sites"],
    queryFn: async () => {
      if (!experimentId) return []
      const res =
        await ExperimentsService.apiExperimentsIdExperimentIdSitesGetExperimentSites(
          { experimentId },
        )
      return (res as SiteOutput[] | null) ?? []
    },
    enabled: isLoggedIn() && Boolean(experimentId),
  })
}

export function useExperimentPopulations(
  experimentId: string | null | undefined,
) {
  return useQuery<PopulationOutput[], Error>({
    queryKey: ["experiments", experimentId, "populations"],
    queryFn: async () => {
      if (!experimentId) return []
      const res =
        await ExperimentsService.apiExperimentsIdExperimentIdPopulationsGetExperimentPopulations(
          { experimentId },
        )
      return (res as PopulationOutput[] | null) ?? []
    },
    enabled: isLoggedIn() && Boolean(experimentId),
  })
}
