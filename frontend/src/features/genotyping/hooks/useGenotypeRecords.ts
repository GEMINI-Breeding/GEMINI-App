/**
 * Hook for the paginated genotype-records table.
 *
 * `useGenotypeRecords` paginates the records table; the backend caps
 * `limit` at 500 and returns ordered-by-id (ascending) results. Filter
 * params (variantName, accessionName, chromosome) all map to query
 * params on the SDK call.
 *
 * (The legacy `useIngestGenotypeMatrix` hook was removed when the
 * genomic import wizard moved to a PGEN-only ingest pipeline; the
 * matrix endpoint no longer exists in the backend.)
 */
import { useQuery } from "@tanstack/react-query"

import {
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
