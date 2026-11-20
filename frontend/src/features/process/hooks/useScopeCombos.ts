import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { ExperimentsService } from "@/client"
import { seasonOf } from "@/features/analyze/lib/mapDate"
import { useTraitRecords } from "@/features/dashboard/hooks/useTraitData"
import { useAllRuns } from "../lib/runStore"
import { addCombo, type ScopeCombo } from "../lib/scopeCombos"

/** The experiment's season / site / population combinations with data. */
export function useScopeCombos(
  experimentId: string | null | undefined,
  experimentName: string | null | undefined,
): ScopeCombo[] {
  const catalog = useTraitRecords()
  const runs = useAllRuns()
  const datasets = useQuery({
    queryKey: ["experiments", experimentId, "datasets", "scope-combos"],
    queryFn: () =>
      ExperimentsService.apiExperimentsIdExperimentIdDatasetsGetExperimentDatasets(
        { experimentId: experimentId as string },
      ),
    enabled: Boolean(experimentId),
    staleTime: 5 * 60_000,
  })
  return useMemo(() => {
    const out: ScopeCombo[] = []
    if (!experimentName) return out
    for (const r of catalog.data ?? [])
      if (r.experiment === experimentName)
        addCombo(out, seasonOf(r), r.location, r.population)
    for (const run of runs) {
      const u = run.uploadScope
      if (u?.experiment === experimentName)
        addCombo(out, u.year, u.location, u.population)
    }
    for (const d of (datasets.data as
      | { dataset_info?: Record<string, unknown> | null }[]
      | null) ?? []) {
      const i = d.dataset_info ?? {}
      const s = (k: string) =>
        typeof i[k] === "string" ? (i[k] as string) : ""
      addCombo(out, s("season"), s("site"), s("population"))
    }
    return out
  }, [catalog.data, runs, datasets.data, experimentName])
}
