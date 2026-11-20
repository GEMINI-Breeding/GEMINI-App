/**
 * TanStack-Query hooks for the GenotypingStudiesService SDK.
 *
 * Phase 9a covers list / create / update / delete and `getById`. Phase 9b
 * adds records (paginated GET + ingest-matrix POST), 9c adds variants, 9d
 * adds GWAS submission.
 *
 * Conventions:
 *   - One root cache key (`genotypingStudiesQueryKey`) so all mutations
 *     can invalidate every list-derived query in one call.
 *   - Mutation functions accept the raw SDK input/update shape; callers
 *     that want to massage the JSON `study_info` field should do so
 *     before invoking the mutation.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  GenotypingStudiesService,
  type GenotypingStudyInput,
  type GenotypingStudyOutput,
  type GenotypingStudyUpdate,
} from "@/client"
import { idAsString } from "@/features/admin/lib/ids"

export const genotypingStudiesQueryKey = ["genotyping_studies"] as const

export function useGenotypingStudies() {
  return useQuery<GenotypingStudyOutput[], Error>({
    queryKey: genotypingStudiesQueryKey,
    queryFn: () =>
      GenotypingStudiesService.apiGenotypingStudiesAllGetAllStudies({
        limit: 500,
        offset: 0,
      }) as Promise<GenotypingStudyOutput[]>,
  })
}

export function useGenotypingStudy(studyId: string | undefined) {
  return useQuery<GenotypingStudyOutput, Error>({
    queryKey: [...genotypingStudiesQueryKey, "by-id", studyId ?? ""],
    enabled: Boolean(studyId),
    queryFn: () =>
      GenotypingStudiesService.apiGenotypingStudiesIdStudyIdGetStudyById({
        studyId: studyId as string,
      }) as Promise<GenotypingStudyOutput>,
  })
}

export function useCreateGenotypingStudy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: GenotypingStudyInput) =>
      GenotypingStudiesService.apiGenotypingStudiesCreateStudy({
        requestBody: input,
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: genotypingStudiesQueryKey }),
  })
}

export function useUpdateGenotypingStudy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      row,
      input,
    }: {
      row: GenotypingStudyOutput
      input: GenotypingStudyUpdate
    }) =>
      GenotypingStudiesService.apiGenotypingStudiesIdStudyIdUpdateStudy({
        studyId: idAsString(row.id),
        requestBody: input,
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: genotypingStudiesQueryKey }),
  })
}

export function useDeleteGenotypingStudy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (row: GenotypingStudyOutput) =>
      GenotypingStudiesService.apiGenotypingStudiesIdStudyIdDeleteStudy({
        studyId: idAsString(row.id),
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: genotypingStudiesQueryKey }),
  })
}

export function useGenotypingStudyExperiments(studyId: string | undefined) {
  return useQuery({
    queryKey: [...genotypingStudiesQueryKey, "experiments", studyId ?? ""],
    enabled: Boolean(studyId),
    queryFn: () =>
      GenotypingStudiesService.apiGenotypingStudiesIdStudyIdExperimentsGetAssociatedExperiments(
        { studyId: studyId as string },
      ),
  })
}
