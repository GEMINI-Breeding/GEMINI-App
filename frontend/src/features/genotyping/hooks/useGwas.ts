/**
 * Hooks for the GWAS surface. Submit, dataset-traits lookup, and
 * study-scoped job listing built on top of `useJobs` / `useJob` in
 * features/process.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  DatasetsService,
  ExperimentsService,
  type GwasSubmitInput,
  GwasService,
  type JobOutput,
  JobsService,
  type TraitOutput,
  TraitsService,
} from "@/client"
import { idAsString } from "@/features/admin/lib/ids"
import { useJob, useJobs } from "@/features/process/hooks/useJobs"

export const GWAS_JOB_TYPE = "RUN_GWAS"

export function useSubmitGwas() {
  const qc = useQueryClient()
  return useMutation<JobOutput[], Error, GwasSubmitInput>({
    mutationFn: async (requestBody) =>
      GwasService.apiGwasSubmitSubmitGwas({ requestBody }) as Promise<JobOutput[]>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] })
    },
  })
}

export function useDatasetTraits(datasetId: string | null | undefined) {
  return useQuery<TraitOutput[], Error>({
    queryKey: ["datasets", datasetId ?? "", "traits"],
    enabled: Boolean(datasetId),
    queryFn: () =>
      DatasetsService.apiDatasetsIdDatasetIdTraitsGetAssociatedTraits({
        datasetId: datasetId as string,
      }) as Promise<TraitOutput[]>,
  })
}

export function useExperimentDatasets(experimentId: string | null | undefined) {
  return useQuery({
    queryKey: ["experiments", experimentId ?? "", "datasets"],
    enabled: Boolean(experimentId),
    queryFn: () =>
      ExperimentsService.apiExperimentsIdExperimentIdDatasetsGetExperimentDatasets({
        experimentId: experimentId as string,
      }),
  })
}

/**
 * RUN_GWAS jobs scoped to a single study. `useJobs` filters by experiment
 * server-side via the SDK; study filtering is client-side against
 * `job.parameters.study_id`.
 */
export function useStudyGwasJobs(
  studyId: string | null | undefined,
  opts?: { refetchIntervalMs?: number },
) {
  const refetchIntervalMs = opts?.refetchIntervalMs ?? 5_000
  const query = useJobs({
    jobType: GWAS_JOB_TYPE,
    refetchIntervalMs,
  })
  const jobs = query.data ?? []
  const filtered = studyId
    ? jobs.filter((j) => {
        const params = j.parameters as { study_id?: unknown } | null | undefined
        return params != null && String(params.study_id ?? "") === String(studyId)
      })
    : jobs
  return { ...query, data: filtered }
}

export function useGwasJob(jobId: string | null | undefined) {
  return useJob(jobId)
}

/**
 * Delete a RUN_GWAS job. The backend's DELETE /api/jobs/{id} also
 * sweeps the MinIO artifacts under gwas/{job_id}/ — see
 * jobs.py::_sweep_gwas_artifacts. Invalidates the jobs cache so the
 * Recent Runs table refreshes immediately.
 */
export function useDeleteGwasJob() {
  const qc = useQueryClient()
  return useMutation<unknown, Error, string>({
    mutationFn: (jobId: string) =>
      JobsService.apiJobsJobIdDeleteJob({ jobId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] })
    },
  })
}

/**
 * Cached id → trait_name map for resolving the trait_id(s) embedded in
 * a job's parameters / result blob to a human-readable label. The
 * Recent Runs panel needs this for jobs that haven't finished yet
 * (parameters carry only the id), and the post-completion result blob
 * also stores ids only (see worker.py — names aren't written there).
 *
 * Uses the bulk traits endpoint with a generous staleTime; the trait
 * catalogue changes infrequently relative to job churn.
 */
export function useTraitNameMap() {
  return useQuery<Map<string, string>, Error>({
    queryKey: ["traits", "id-name-map"],
    queryFn: async () => {
      const list = (await TraitsService.apiTraitsAllGetAllTraits({
        limit: 500,
        offset: 0,
      })) as TraitOutput[] | null
      const map = new Map<string, string>()
      for (const t of list ?? []) {
        if (t?.id == null) continue
        map.set(idAsString(t.id), t.trait_name ?? "")
      }
      return map
    },
    staleTime: 5 * 60_000,
  })
}

/**
 * Pull the trait names referenced by a job's `parameters` blob.
 * Single-trait jobs use `trait_id`; mvLMM and the LMM fan-out path
 * use `trait_ids` (an array). Returns the names in the order the
 * job declared them. Unknown ids fall back to a truncated UUID.
 */
export function jobTraitNames(
  job: JobOutput,
  nameMap: Map<string, string> | undefined,
): string[] {
  const params = job.parameters as
    | { trait_id?: string | number | null; trait_ids?: Array<string | number> | null }
    | null
    | undefined
  if (!params) return []
  const ids: string[] = []
  if (params.trait_id != null) ids.push(idAsString(params.trait_id))
  if (Array.isArray(params.trait_ids)) {
    for (const id of params.trait_ids) ids.push(idAsString(id))
  }
  return ids.map((id) => nameMap?.get(id) || `${id.slice(0, 8)}…`)
}
