/**
 * useBatchLabels — what tells same-day upload batches apart.
 *
 * Two uploads for the same experiment / site / population / date /
 * platform / sensor land in two dataset folders named by an 8-character
 * id. When the person labelled them at upload (run of the day,
 * treatment), this gives each id its label so the Process tab can show
 * "run 2 · drought" instead of the bare id.
 */
import { useQuery } from "@tanstack/react-query"

import { type DatasetOutput, DatasetsService } from "@/client"
import { idAsString } from "@/features/admin/lib/ids"
import { extractDatasetShortId } from "@/features/files/lib/datasetForUpload"
import { batchLabelText } from "@/features/files/lib/uploadGroups"
import { isLoggedIn } from "@/lib/auth"

/** Dataset short id → "run 2 · drought". Batches without labels are absent. */
export function useBatchLabels(
  experimentName: string | undefined,
): Record<string, string> {
  const query = useQuery({
    queryKey: ["datasets", "batch-labels", experimentName],
    enabled: isLoggedIn() && !!experimentName,
    staleTime: 30_000,
    queryFn: async () => {
      const rows =
        ((await DatasetsService.apiDatasetsGetDatasets({
          experimentName,
        })) as DatasetOutput[] | null) ?? []
      const out: Record<string, string> = {}
      for (const d of rows) {
        const id = idAsString(d.id)
        const label = batchLabelText(d.dataset_info)
        if (!id || !label) continue
        try {
          out[extractDatasetShortId(id)] = label
        } catch {
          // not a UUID-shaped id: no folder is named after it
        }
      }
      return out
    },
  })
  return query.data ?? {}
}
