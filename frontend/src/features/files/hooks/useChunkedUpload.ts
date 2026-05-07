/**
 * Per-file chunked upload with ProcessPanel wiring.
 *
 * Wraps `uploadFileChunked` from `src/lib/chunkedUpload.ts`, mirrors
 * progress into a Process row, and returns the completed MinIO object
 * path so callers can chain follow-up work (e.g. submitting
 * EXTRACT_BINARY jobs on .bin uploads).
 *
 * A single `fileIdentifier` is computed from {name, size, lastModified}
 * so retries of the same File resume instead of re-uploading chunks the
 * server already has.
 */
import { useCallback } from "react"
import { useProcess } from "@/contexts/ProcessContext"
import { uploadFileChunked } from "@/lib/chunkedUpload"

export type ChunkedUploadItemResult = {
  file: File
  objectPath: string
  bytes: number
  chunkCount: number
}

export type ChunkedUploadOpts = {
  /** Caller-provided MinIO object path for this specific file. */
  objectPath: string
  /** Processes are keyed to this id so the ProcessPanel row updates live. */
  processId: string
  /** Process-item id whose progress/status reflects this file. */
  itemId: string
  /**
   * UUID of the experiment this upload is scoped to. Forwarded to
   * `uploadFileChunked` so the backend can write a `experiment_files`
   * pointer row at finalize time. Required by the Files page UI gate
   * for every chunked upload, but typed optional so legacy callers
   * compile while we migrate.
   */
  experimentId?: string
  /** Optional abort signal — aborts the per-file chunk loop. */
  signal?: AbortSignal
}

/**
 * A stable-but-quick file identifier. Using a full SHA-256 would be the
 * most robust thing, but it doubles the upload wall-clock for large files
 * because it has to read the whole blob twice (hash + slice). The
 * name+size+mtime triple collides only if the user edits a file without
 * touching its modification time *and* the filename — rare enough that
 * we accept the risk and get instant identifiers in return.
 */
function computeFileIdentifier(file: File): string {
  return [file.name, file.size, file.lastModified].join(":")
}

export function useChunkedUpload() {
  const { updateProcess, updateProcessItem } = useProcess()

  const uploadOne = useCallback(
    async (
      file: File,
      opts: ChunkedUploadOpts,
    ): Promise<ChunkedUploadItemResult> => {
      const { objectPath, processId, itemId, experimentId, signal } = opts
      const fileIdentifier = computeFileIdentifier(file)

      updateProcessItem(processId, itemId, {
        status: "running",
        label: "Uploading 0%",
      })

      const result = await uploadFileChunked({
        file,
        fileIdentifier,
        objectName: objectPath,
        experimentId,
        signal,
        onProgress: (p) => {
          const pct = Math.round(p.fraction * 100)
          updateProcess(processId, {
            message: `Uploading ${file.name} (${pct}%)`,
            progress: pct,
          })
          updateProcessItem(processId, itemId, {
            status: "running",
            label: `${pct}%`,
          })
        },
      })

      updateProcessItem(processId, itemId, {
        status: "completed",
        label: undefined,
      })

      return {
        file,
        objectPath: result.objectName,
        bytes: result.bytes,
        chunkCount: result.chunkCount,
      }
    },
    [updateProcess, updateProcessItem],
  )

  return { uploadOne, computeFileIdentifier }
}
