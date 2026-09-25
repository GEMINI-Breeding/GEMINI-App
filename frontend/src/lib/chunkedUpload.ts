/**
 * Chunked upload primitive for the GEMINIbase file-storage contract.
 *
 * Each HTTP chunk maps 1-to-1 onto an S3 multipart-upload part on MinIO. The
 * backend never buffers the file through local disk — it streams each chunk
 * straight into a MinIO part and asks MinIO to assemble on the final chunk.
 *
 * Endpoints (see backend/gemini/rest_api/controllers/files.py):
 *   POST /api/files/upload_chunk           — multipart: file_chunk, chunk_index,
 *                                            total_chunks, file_identifier,
 *                                            object_name, bucket_name?
 *   POST /api/files/check_uploaded_chunks  — JSON {file_identifier, total_chunks,
 *                                            object_name, bucket_name?}; returns
 *                                            uploaded_part_numbers (1-indexed) so the
 *                                            client can resume out-of-order. Parts are
 *                                            only reported for a session writing to
 *                                            the same object.
 *   POST /api/files/abort_upload           — JSON {file_identifier}; aborts the
 *                                            in-progress S3 multipart upload.
 *
 * Chunks for one file upload in parallel with bounded concurrency, since S3
 * parts are independent. Resume is random-access: the client diffs the
 * server's reported part numbers against {1..totalChunks} and re-sends the
 * missing ones.
 *
 * A chunk that fails with a network error, 408/429 or 5xx is retried with
 * backoff before the file is given up on: one blip used to throw away every
 * part of a multi-GB upload.
 */
import { OpenAPI } from "@/client/core/OpenAPI"
import { getToken } from "@/lib/auth"

const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024 // 8 MiB (>= S3 5 MiB minimum)
const DEFAULT_PARALLEL_PARTS = 4
/** Delays before each retry of a failed chunk. */
const CHUNK_RETRY_DELAYS_MS = [1_000, 3_000, 10_000]

export type ChunkedUploadProgress = {
  /** Bytes uploaded so far across all chunks (including already-resumed ones). */
  uploaded: number
  /** Total file size in bytes. */
  total: number
  /** 0–1 fraction — convenience for progress bars. */
  fraction: number
  /** Index of the most recently completed chunk. */
  chunkIndex: number
  /** Total number of chunks the file was split into. */
  totalChunks: number
}

export type ChunkedUploadOptions = {
  /** The File or Blob to upload. */
  file: File | Blob
  /**
   * Stable identifier for this upload. If the user retries the same file the
   * backend will skip parts already stored under this identifier — so reuse
   * the same string (e.g. a hash) across retries to resume.
   */
  fileIdentifier: string
  /** MinIO object key to write to (e.g. "Raw/2026/ExpA/.../file.bin"). */
  objectName: string
  /** MinIO bucket; defaults to the stack's GEMINI_STORAGE_BUCKET_NAME. */
  bucketName?: string
  /**
   * UUID of the experiment this upload is scoped to. The Files page UI
   * gate now requires an experiment for every chunked upload; the
   * backend's upload-finalize handler writes a `experiment_files` row
   * keyed on this id, which is what makes the experiment-delete cascade
   * able to sweep this object. Forwarded as the `experiment_id`
   * multipart field on every chunk POST.
   */
  experimentId?: string
  /**
   * UUID of the dataset that owns this upload batch. Optional — when
   * present, the backend's upload-finalize writes it into the
   * `experiment_files.dataset_id` column so `Dataset.delete()` can
   * sweep just this batch's files. Forwarded as the `dataset_id`
   * multipart field on every chunk POST.
   */
  datasetId?: string
  /** Bytes per chunk. Defaults to 8 MiB; must be >= 5 MiB for S3 multipart. */
  chunkSize?: number
  /** Max chunks of this file in flight at once. Defaults to 4. */
  parallelParts?: number
  /** Progress callback fired after each successful chunk. */
  onProgress?: (p: ChunkedUploadProgress) => void
  /** Abort signal — chunks stop being posted once this is aborted. */
  signal?: AbortSignal
  /** Delays before each retry of a failed chunk (tests shorten these). */
  retryDelaysMs?: readonly number[]
}

export type ChunkedUploadResult = {
  objectName: string
  bucketName?: string
  bytes: number
  chunkCount: number
}

function resolveApiUrl(path: string): string {
  const base = (OpenAPI.BASE ?? "").replace(/\/$/, "")
  return base ? `${base}${path}` : path
}

async function checkUploadedPartNumbers(
  fileIdentifier: string,
  totalChunks: number,
  objectName: string,
  bucketName?: string,
): Promise<Set<number>> {
  const url = resolveApiUrl("/api/files/check_uploaded_chunks")
  const token = getToken()
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      file_identifier: fileIdentifier,
      total_chunks: totalChunks,
      object_name: objectName,
      ...(bucketName ? { bucket_name: bucketName } : {}),
    }),
  })
  if (!resp.ok) return new Set()
  try {
    const body = (await resp.json()) as { uploaded_part_numbers?: number[] }
    return new Set(body.uploaded_part_numbers ?? [])
  } catch {
    return new Set()
  }
}

/**
 * Cancel an in-progress multipart upload server-side. Safe to call after the
 * upload has already finished or aborted — the backend treats it as a no-op.
 */
export async function abortUpload(fileIdentifier: string): Promise<void> {
  const token = getToken()
  try {
    await fetch(resolveApiUrl("/api/files/abort_upload"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ file_identifier: fileIdentifier }),
    })
  } catch {
    // Best-effort cleanup; nothing the caller can do if this fails.
  }
}

async function uploadOneChunk({
  chunk,
  chunkIndex,
  totalChunks,
  fileIdentifier,
  objectName,
  bucketName,
  experimentId,
  datasetId,
  signal,
}: {
  chunk: Blob
  chunkIndex: number
  totalChunks: number
  fileIdentifier: string
  objectName: string
  bucketName?: string
  experimentId?: string
  datasetId?: string
  signal?: AbortSignal
}): Promise<void> {
  const form = new FormData()
  form.append("file_chunk", chunk, `${fileIdentifier}.part${chunkIndex}`)
  form.append("chunk_index", String(chunkIndex))
  form.append("total_chunks", String(totalChunks))
  form.append("file_identifier", fileIdentifier)
  form.append("object_name", objectName)
  if (bucketName) form.append("bucket_name", bucketName)
  if (experimentId) form.append("experiment_id", experimentId)
  if (datasetId) form.append("dataset_id", datasetId)

  const token = getToken()
  const resp = await fetch(resolveApiUrl("/api/files/upload_chunk"), {
    method: "POST",
    body: form,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    signal,
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => "")
    throw new ChunkError(
      `Chunk ${chunkIndex + 1}/${totalChunks} failed: ${resp.status} ${text.slice(0, 200)}`,
      resp.status === 408 || resp.status === 429 || resp.status >= 500,
    )
  }
}

class ChunkError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t)
        resolve()
      },
      { once: true },
    )
  })
}

/**
 * `uploadOneChunk` with retries. Network errors (fetch throws a TypeError)
 * and retryable statuses are retried; 4xx and aborts are not. The server
 * keeps the upload's other parts across a failed chunk, and re-sending a
 * part is idempotent.
 */
async function uploadChunkWithRetry(
  args: Parameters<typeof uploadOneChunk>[0],
  delaysMs: readonly number[],
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await uploadOneChunk(args)
      return
    } catch (err) {
      const retryable =
        err instanceof ChunkError ? err.retryable : err instanceof TypeError
      if (!retryable || attempt >= delaysMs.length || args.signal?.aborted) {
        throw err
      }
      await sleep(delaysMs[attempt], args.signal)
      if (args.signal?.aborted) throw err
    }
  }
}

/**
 * Upload a single file to MinIO via the GEMINIbase chunked-upload protocol.
 *
 * Splits the file into N >=5 MiB chunks and uploads them as S3 multipart parts
 * in parallel. Already-uploaded parts (reported by the server) are skipped, so
 * passing the same fileIdentifier across retries resumes where it left off.
 */
export async function uploadFileChunked(
  opts: ChunkedUploadOptions,
): Promise<ChunkedUploadResult> {
  const {
    file,
    fileIdentifier,
    objectName,
    bucketName,
    experimentId,
    datasetId,
    chunkSize = DEFAULT_CHUNK_SIZE,
    parallelParts = DEFAULT_PARALLEL_PARTS,
    onProgress,
    signal,
    retryDelaysMs = CHUNK_RETRY_DELAYS_MS,
  } = opts

  const total = file.size
  const totalChunks = Math.max(1, Math.ceil(total / chunkSize))
  const alreadyUploaded = await checkUploadedPartNumbers(
    fileIdentifier,
    totalChunks,
    objectName,
    bucketName,
  )

  let uploaded = 0
  for (const partNumber of alreadyUploaded) {
    if (partNumber < 1 || partNumber > totalChunks) continue
    const start = (partNumber - 1) * chunkSize
    const end = Math.min(start + chunkSize, total)
    uploaded += end - start
  }

  // Build the list of chunk indices that still need to be sent.
  const pending: number[] = []
  for (let i = 0; i < totalChunks; i++) {
    if (!alreadyUploaded.has(i + 1)) pending.push(i)
  }

  let cursor = 0
  let firstError: unknown = null

  async function worker() {
    while (true) {
      if (firstError) return
      if (signal?.aborted) return
      const idx = cursor++
      if (idx >= pending.length) return
      const chunkIndex = pending[idx]
      const start = chunkIndex * chunkSize
      const end = Math.min(start + chunkSize, total)
      const chunk = file.slice(start, end)
      try {
        await uploadChunkWithRetry(
          {
            chunk,
            chunkIndex,
            totalChunks,
            fileIdentifier,
            objectName,
            bucketName,
            experimentId,
            datasetId,
            signal,
          },
          retryDelaysMs,
        )
      } catch (err) {
        if (!firstError) firstError = err
        return
      }
      uploaded = Math.min(total, uploaded + (end - start))
      onProgress?.({
        uploaded,
        total,
        fraction: total > 0 ? uploaded / total : 1,
        chunkIndex,
        totalChunks,
      })
    }
  }

  const workerCount = Math.min(Math.max(1, parallelParts), pending.length || 1)
  const workers = Array.from({ length: workerCount }, () => worker())
  await Promise.all(workers)

  if (signal?.aborted) {
    abortUpload(fileIdentifier).catch(() => {})
    throw new DOMException("Aborted", "AbortError")
  }
  if (firstError) {
    abortUpload(fileIdentifier).catch(() => {})
    throw firstError
  }

  return { objectName, bucketName, bytes: total, chunkCount: totalChunks }
}
