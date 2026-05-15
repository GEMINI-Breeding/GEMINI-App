/**
 * Cached lookup of existing dataset names, used by the import wizard to
 * warn the user when an auto-generated or typed dataset name would
 * collide with a dataset that already exists.
 *
 * The DB enforces `UNIQUE(dataset_name)` globally and the
 * `check_trait_validity` trigger is get-or-create — so submitting a
 * trait file under an existing dataset_name silently merges its records
 * into the existing dataset. That's hard to undo. We surface a non-
 * blocking warning at the wizard so the user can rename if the merge
 * wasn't intended.
 *
 * Returns a Set<string> for O(1) membership checks. Cached for 60 s
 * since the catalogue doesn't churn during a single upload session.
 */
import { useQuery } from "@tanstack/react-query"

import { DatasetsService, type DatasetOutput } from "@/client"

const DATASETS_PAGE_SIZE = 500

export function useExistingDatasetNames() {
  return useQuery<Set<string>, Error>({
    queryKey: ["datasets", "names"],
    queryFn: async () => {
      const list = (await DatasetsService.apiDatasetsAllGetAllDatasets({
        limit: DATASETS_PAGE_SIZE,
        offset: 0,
      })) as DatasetOutput[] | null
      const names = new Set<string>()
      for (const d of list ?? []) {
        if (d?.dataset_name) names.add(d.dataset_name)
      }
      return names
    },
    staleTime: 60_000,
  })
}
