/**
 * Hooks for reading and writing genotype records on a study.
 *
 * `useGenotypeRecords` paginates the records table; the backend caps
 * `limit` at 500 and returns ordered-by-id (ascending) results. Filter
 * params (variantName, accessionName, chromosome) all map to query
 * params on the SDK call.
 *
 * `useIngestGenotypeMatrix` POSTs a parsed matrix; on success it
 * invalidates both the records list and the variants list (Phase 9c)
 * so the user sees the new rows on next render without a manual refetch.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  type GenotypeMatrixBatchInput,
  type GenotypeMatrixBatchResult,
  type GenotypeRecordOutput,
  GenotypingStudiesService,
} from "@/client"
import { genotypingStudiesQueryKey } from "./useGenotypingStudies"

export type GenotypeRecordsParams = {
  studyId: string | undefined
  limit?: number
  offset?: number
  variantName?: string
  accessionName?: string
  chromosome?: number
}

export const genotypeRecordsQueryKey = (
  studyId: string,
  params: Omit<GenotypeRecordsParams, "studyId">,
) => [...genotypingStudiesQueryKey, "records", studyId, params] as const

export function useGenotypeRecords(args: GenotypeRecordsParams) {
  const {
    studyId,
    limit = 50,
    offset = 0,
    variantName,
    accessionName,
    chromosome,
  } = args
  return useQuery<GenotypeRecordOutput[], Error>({
    queryKey: studyId
      ? genotypeRecordsQueryKey(studyId, {
          limit,
          offset,
          variantName,
          accessionName,
          chromosome,
        })
      : ["genotyping_records", "disabled"],
    enabled: Boolean(studyId),
    queryFn: () =>
      GenotypingStudiesService.apiGenotypingStudiesIdStudyIdRecordsGetRecords({
        studyId: studyId as string,
        limit,
        offset,
        variantName,
        accessionName,
        chromosome,
      }) as Promise<GenotypeRecordOutput[]>,
  })
}

export function useIngestGenotypeMatrix(studyId: string | undefined) {
  const qc = useQueryClient()
  return useMutation<
    GenotypeMatrixBatchResult,
    Error,
    GenotypeMatrixBatchInput
  >({
    mutationFn: (batch) => {
      if (!studyId) {
        return Promise.reject(
          new Error("studyId is required to ingest a matrix."),
        )
      }
      return GenotypingStudiesService.apiGenotypingStudiesIdStudyIdIngestMatrixIngestMatrix(
        { studyId, requestBody: batch },
      )
    },
    onSuccess: () => {
      // Invalidate every records-derived query (any pagination / filter)
      // and also the variants list (9c) and the experiments list (which
      // could be affected if the backend cascades). Cheapest path: nuke
      // the whole subtree.
      qc.invalidateQueries({ queryKey: genotypingStudiesQueryKey })
    },
  })
}
