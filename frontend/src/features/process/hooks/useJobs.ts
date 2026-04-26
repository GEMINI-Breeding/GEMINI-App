/**
 * React-Query hooks for GEMINIbase job lifecycle.
 *
 * Phase 6 wired EXTRACT_BINARY through `useUploadQueue` directly; Phase 7
 * needs a shared layer because every aerial-pipeline tool (RUN_ODM,
 * SPLIT_ORTHOMOSAIC, EXTRACT_TRAITS) submits a job and surfaces its result
 * via the same `/api/jobs/{id}/progress` WebSocket the upload queue already
 * uses. These hooks normalise that pattern.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { JobsService, type JobOutput } from "@/client"
import { isLoggedIn } from "@/lib/auth"

export type SubmitJobInput = {
  jobType: string
  parameters: Record<string, unknown>
  experimentId?: string | null
}

export function useSubmitJob() {
  const qc = useQueryClient()
  return useMutation<JobOutput, Error, SubmitJobInput>({
    mutationFn: async ({ jobType, parameters, experimentId }) => {
      const job = await JobsService.apiJobsSubmitSubmitJob({
        requestBody: {
          job_type: jobType,
          parameters,
          experiment_id: experimentId ?? undefined,
        },
      })
      return job
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] })
    },
  })
}

export function useCancelJob() {
  const qc = useQueryClient()
  return useMutation<unknown, Error, string>({
    mutationFn: async (jobId: string) => {
      return JobsService.apiJobsJobIdCancelCancelJob({ jobId })
    },
    onSuccess: (_, jobId) => {
      qc.invalidateQueries({ queryKey: ["jobs"] })
      qc.invalidateQueries({ queryKey: ["jobs", jobId] })
    },
  })
}

/** List all jobs of an optional type. Filtered client-side by experiment. */
export function useJobs(opts: {
  jobType?: string | null
  experimentId?: string | null
  enabled?: boolean
  refetchIntervalMs?: number
}) {
  const enabled = opts.enabled !== false && isLoggedIn()
  return useQuery<JobOutput[], Error>({
    queryKey: ["jobs", { jobType: opts.jobType ?? null, experimentId: opts.experimentId ?? null }],
    queryFn: async () => {
      const res = await JobsService.apiJobsAllGetAllJobs(
        opts.jobType ? { jobType: opts.jobType } : {},
      )
      const list = (res as JobOutput[] | null) ?? []
      if (!opts.experimentId) return list
      return list.filter((j) => (j as { experiment_id?: string }).experiment_id === opts.experimentId)
    },
    enabled,
    refetchInterval: opts.refetchIntervalMs,
  })
}

export function useJob(jobId: string | null | undefined) {
  return useQuery<JobOutput, Error>({
    queryKey: ["jobs", jobId],
    queryFn: async () => {
      if (!jobId) throw new Error("jobId required")
      return JobsService.apiJobsJobIdGetJob({ jobId })
    },
    enabled: isLoggedIn() && Boolean(jobId),
    refetchInterval: 5_000,
  })
}
