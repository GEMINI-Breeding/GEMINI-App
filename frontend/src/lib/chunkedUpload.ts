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
 *   POST /api/files/check_uploaded_chunks  — JSON {file_identifier, total_chunks};
 *                                            returns uploaded_part_numbers (1-indexed)
 *                                            so the client can resume out-of-order.
 *   POST /api/files/abort_upload           — JSON {file_identifier}; aborts the
 *                                            in-progress S3 multipart upload.
 *
 * Chunks for one file upload in parallel with bounded concurrency, since S3
 * parts are independent. Resume is random-access: the client diffs the
 * server's reported part numbers against {1..totalChunks} and re-sends the
 * missing ones.
 */
import { OpenAPI } from "@/client/core/OpenAPI"
import { getToken } from "@/lib/auth"

const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024 // 8 MiB (>= S3 5 MiB minimum)
const DEFAULT_PARALLEL_PARTS = 4

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
  /** Bytes per chunk. Defaults to 8 MiB; must be >= 5 MiB for S3 multipart. */
  chunkSize?: number
  /** Max chunks of this file in flight at once. Defaults to 4. */
  parallelParts?: number
  /** Progress callback fired after each successful chunk. */
  onProgress?: (p: ChunkedUploadProgress) => void
  /** Abort signal — chunks stop being posted once this is aborted. */
  signal?: AbortSignal
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
  signal,
}: {
  chunk: Blob
  chunkIndex: number
  totalChunks: number
  fileIdentifier: string
  objectName: string
  bucketName?: string
  signal?: AbortSignal
}): Promise<void> {
  const form = new FormData()
  form.append("file_chunk", chunk, `${fileIdentifier}.part${chunkIndex}`)
  form.append("chunk_index", String(chunkIndex))
  form.append("total_chunks", String(totalChunks))
  form.append("file_identifier", fileIdentifier)
  form.append("object_name", objectName)
  if (bucketName) form.append("bucket_name", bucketName)

  const token = getToken()
  const resp = await fetch(resolveApiUrl("/api/files/upload_chunk"), {
    method: "POST",
    body: form,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    signal,
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => "")
    throw new Error(
      `Chunk ${chunkIndex + 1}/${totalChunks} failed: ${resp.status} ${text.slice(0, 200)}`,
    )
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
    chunkSize = DEFAULT_CHUNK_SIZE,
    parallelParts = DEFAULT_PARALLEL_PARTS,
    onProgress,
    signal,
  } = opts

  const total = file.size
  const totalChunks = Math.max(1, Math.ceil(total / chunkSize))
  const alreadyUploaded = await checkUploadedPartNumbers(fileIdentifier, totalChunks)

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
        await uploadOneChunk({
          chunk,
          chunkIndex,
          totalChunks,
          fileIdentifier,
          objectName,
          bucketName,
          signal,
        })
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
