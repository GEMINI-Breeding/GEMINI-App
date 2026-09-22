/**
 * An analysis run's results in the database.
 *
 * Each EXTRACT_TRAITS / LOCATE_PLANTS run ingests its per-plot values into
 * its own dataset (named in the job result as `dataset_name`); a re-run
 * replaces the earlier run's dataset, and deleting a run's results is
 * deleting that dataset (which sweeps its trait records).
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { type DatasetOutput, DatasetsService } from "@/client"
import { idAsString } from "@/features/admin/lib/ids"

export function experimentDatasetsKey(experiment: string | undefined) {
  return ["datasets", "by-experiment", experiment ?? ""] as const
}

/**
 * Names of the experiment's datasets — to tell live runs from replaced.
 * `completedRuns` is part of the key so the list refetches the moment a
 * run finishes (its dataset appears, its predecessor's disappears).
 */
export function useExperimentDatasetNames(
  experiment: string | undefined,
  completedRuns: string[] = [],
) {
  return useQuery({
    queryKey: [...experimentDatasetsKey(experiment), completedRuns.join(",")],
    queryFn: async () => {
      const list = ((await DatasetsService.apiDatasetsGetDatasets({
        experimentName: experiment,
      })) ?? []) as DatasetOutput[]
      return new Set(list.map((d) => d.dataset_name ?? ""))
    },
    enabled: Boolean(experiment),
  })
}

/** Delete one run's dataset (and so its trait records) by name. */
export function useDeleteRunResults() {
  const qc = useQueryClient()
  return async (experiment: string, datasetName: string) => {
    const matches = ((await DatasetsService.apiDatasetsGetDatasets({
      experimentName: experiment,
      datasetName,
    })) ?? []) as DatasetOutput[]
    const ds = matches.find((d) => d.dataset_name === datasetName)
    if (!ds) throw new Error(`No dataset named ${datasetName}`)
    await DatasetsService.apiDatasetsIdDatasetIdDeleteDataset({
      datasetId: idAsString(ds.id),
    })
    // Everything that reads trait records.
    for (const key of [
      ["datasets"],
      ["analyze"],
      ["trait-records"],
      ["trait-record-geojson"],
    ]) {
      qc.invalidateQueries({ queryKey: key })
    }
  }
}
