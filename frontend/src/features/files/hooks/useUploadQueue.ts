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
import { UPLOAD_PHASE_END } from "@/features/files/lib/uploadProgressSplit"
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
      opts: {
        title?: string
        experimentId?: string
        /**
         * UUID of the dataset that owns this upload batch. Propagated to
         * each chunked-upload finalize (so `experiment_files.dataset_id`
         * is set) AND to any chained EXTRACT_BINARY job (so the amiga
         * worker registers its outputs against the same dataset). When
         * omitted, uploads land as legacy "experiment-owned" rows.
         */
        datasetId?: string
      } = {},
    ): Promise<UploadQueueResult> => {
      const abort = new AbortController()

      const items = tasks.map((t, i) => ({
        id: String(i),
        name: fileNameFromPath(t.objectPath),
        status: "pending" as const,
        uploadedBytes: 0,
        totalBytes: t.file.size,
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
            datasetId: opts.datasetId,
            signal: abort.signal,
          })
          uploaded.push({ file: task.file, objectPath: result.objectPath })

          // Chain the follow-up job once the upload is durably on MinIO.
          // The amiga worker expects { files: [...filenames], localDirPath:
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
                  // Forward both the experiment and dataset ids so the
                  // worker can register each extracted output as an
                  // experiment_files row scoped to this batch. Without
                  // dataset_id, the hundreds of outputs would be
                  // sweepable only by the experiment cascade's prefix
                  // backstop — never by per-dataset delete.
                  experiment_id: opts.experimentId,
                  dataset_id: opts.datasetId,
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
          // Unified 0→100 bar: the upload phase consumed [0,
          // UPLOAD_PHASE_END]; the worker phase will fill the rest.
          // Don't reset to 0 — that's the "fills then resets" UX
          // that made the user think the operation was done.
          // ProcessPanel.processProgress maps the worker's reported
          // 0–100 into [UPLOAD_PHASE_END, 100], so leaving
          // `progress: UPLOAD_PHASE_END` here just parks the bar at
          // the handoff point until the first WS event arrives.
          //
          // The message says "Queued" because there's a ~5s gap
          // between job submission and worker pickup (poll
          // interval). Once the WS handler in ProcessContext sees
          // the first RUNNING event it overwrites the message with
          // the real stage label ("downloading" → "extracting" →
          // "uploading" → "registering" → "Done").
          updateProcess(processId, {
            status: "running",
            message: `Queued for extraction (${jobIds.length} file${jobIds.length === 1 ? "" : "s"})`,
            runId: jobIds[0],
            progress: UPLOAD_PHASE_END,
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
