/**
 * Multi-file upload orchestrator.
 *
 * Given a list of `File`s and the data-type metadata that tells us how to
 * build their MinIO paths, this hook:
 *   1. opens a Process in the ProcessPanel
 *   2. uploads each file with `useChunkedUpload` (bounded concurrency)
 *   3. for `.bin` uploads of data type "Farm-ng Binary File", submits a
 *      JOB_TYPE=EXTRACT_BINARY job per file via JobsService and wires the
 *      returned Job id into the Process so wsManager streams extraction
 *      progress automatically (see ProcessContext auto-subscribe loop).
 *   4. returns the list of uploaded MinIO paths for the caller to act on.
 *
 * No backend seeding, no direct fetch — all HTTP goes through the
 * regenerated SDK or the chunked-upload primitive.
 */
import { useCallback } from "react"

import { JobsService } from "@/client"
import { useProcess } from "@/contexts/ProcessContext"
import { runWithConcurrency } from "@/lib/concurrency"
import { useChunkedUpload } from "./useChunkedUpload"

const MAX_CONCURRENCY = 3

export type UploadTask = {
  file: File
  /** Full MinIO object path (bucket-relative) that this file should land at. */
  objectPath: string
  /** Optional: submit this job-type on completion (chains extraction onto the upload). */
  followUpJob?: { kind: "extract_binary" } | { kind: "none" }
}

export type UploadQueueResult = {
  uploaded: { file: File; objectPath: string }[]
  jobIds: string[]
  processId: string
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

export function useUploadQueue() {
  const { addProcess, updateProcess } = useProcess()
  const { uploadOne } = useChunkedUpload()

  const run = useCallback(
    async (
      tasks: UploadTask[],
      opts: { title?: string; experimentId?: string } = {},
    ): Promise<UploadQueueResult> => {
      const abort = new AbortController()

      const items = tasks.map((t, i) => ({
        id: String(i),
        name: fileNameFromPath(t.objectPath),
        status: "pending" as const,
      }))

      const processId = addProcess({
        type: "file_upload",
        status: "running",
        title: opts.title ?? `Uploading ${tasks.length} file(s)`,
        items,
        cancel: () => abort.abort(),
      })

      const uploaded: { file: File; objectPath: string }[] = []
      const jobIds: string[] = []

      try {
        const uploadThunks = tasks.map((task, i) => async () => {
          const result = await uploadOne(task.file, {
            objectPath: task.objectPath,
            processId,
            itemId: String(i),
            experimentId: opts.experimentId,
            signal: abort.signal,
          })
          uploaded.push({ file: task.file, objectPath: result.objectPath })

          // Chain the follow-up job once the upload is durably on MinIO.
          // The FLIR worker expects { files: [...filenames], localDirPath:
          // <MinIO prefix without trailing slash> } so it can fetch from
          // MinIO and accept multiple .bin chunks of the same recording.
          if (task.followUpJob?.kind === "extract_binary") {
            const lastSlash = result.objectPath.lastIndexOf("/")
            const localDirPath =
              lastSlash > 0 ? result.objectPath.slice(0, lastSlash) : ""
            const filename =
              lastSlash > 0
                ? result.objectPath.slice(lastSlash + 1)
                : result.objectPath
            const job = await JobsService.apiJobsSubmitSubmitJob({
              requestBody: {
                job_type: "EXTRACT_BINARY",
                parameters: {
                  files: [filename],
                  localDirPath,
                },
                // Without this the job row lands with experiment_id=NULL
                // and the experiment-cascade delete leaves it behind as
                // an orphan (its FK is not set, so the cleanup loop in
                // `Experiment.delete()` never matches it).
                experiment_id: opts.experimentId,
              },
            })
            if (job?.id) {
              jobIds.push(String(job.id))
            }
          }
        })

        await runWithConcurrency(uploadThunks, MAX_CONCURRENCY)

        if (jobIds.length === 0) {
          // No extraction to wait for — mark done immediately.
          updateProcess(processId, {
            status: "completed",
            completedAt: new Date(),
            progress: 100,
            message: undefined,
          })
        } else {
          // ProcessContext auto-subscribes to any process with a runId, so
          // picking the first EXTRACT_BINARY job id keeps progress flowing.
          // Multi-job progress (one row per job) is a Phase-8 concern.
          updateProcess(processId, {
            status: "running",
            message: `Extracting ${jobIds.length} file(s)`,
            runId: jobIds[0],
          })
        }
      } catch (err) {
        updateProcess(processId, {
          status: "error",
          error: err instanceof Error ? err.message : String(err),
          completedAt: new Date(),
        })
        throw err
      }

      return { uploaded, jobIds, processId }
    },
    [addProcess, updateProcess, uploadOne],
  )

  return { run }
}
