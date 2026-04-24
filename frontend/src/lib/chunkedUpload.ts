/**
 * Chunked upload primitive for the GEMINIbase file-storage contract.
 *
 * The old FastAPI backend had a single-shot `/api/v1/files/copy-local-stream`
 * that took absolute server-side paths (Tauri-only — only worked when the
 * backend and frontend shared a filesystem). The new GEMINIbase model is
 * pure-HTTP: the browser slices a File into chunks and posts them one at a
 * time; the backend assembles them on MinIO.
 *
 * Endpoints (see gemini/rest_api/controllers/files.py):
 *   POST /api/files/upload_chunk           — multipart: file_chunk, chunk_index,
 *                                            total_chunks, file_identifier,
 *                                            object_name, bucket_name?
 *   POST /api/files/check_uploaded_chunks  — returns which chunk indices are
 *                                            already uploaded; supports resume
 *
 * For .bin uploads the caller then submits a JOB_TYPE=EXTRACT_BINARY via
 * POST /api/jobs/submit and subscribes to the WS progress. The progress-side
 * dance is handled by `src/lib/wsManager.ts`.
 *
 * This primitive is deliberately minimal: it uploads *one* file with progress
 * callbacks. Higher-level flows (multi-file queue, UI process-panel wiring,
 * retries across browser refreshes) belong in the feature layer (Phase 5).
 */
import { OpenAPI } from "@/client/core/OpenAPI"
import { getToken } from "@/lib/auth"

const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024 // 5 MiB

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
   * backend will skip chunks already stored under this identifier — so reuse
   * the same string (e.g. a hash) across retries to resume.
   */
  fileIdentifier: string
  /** MinIO object key to write to (e.g. "Raw/2026/ExpA/.../file.bin"). */
  objectName: string
  /** MinIO bucket; defaults to the stack's GEMINI_STORAGE_BUCKET_NAME. */
  bucketName?: string
  /** Bytes per chunk. Defaults to 5 MiB. */
  chunkSize?: number
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

async function checkUploadedChunkCount(
  fileIdentifier: string,
  totalChunks: number,
): Promise<number> {
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
  if (!resp.ok) return 0
  try {
    // The backend returns `uploaded_chunks` as a count, not a list of indices,
    // so we can only resume contiguous prefixes. That matches how the chunk
    // upload endpoint processes them anyway: chunk_index N requires N−1 to
    // already be present.
    const body = (await resp.json()) as { uploaded_chunks?: number }
    return typeof body.uploaded_chunks === "number" ? body.uploaded_chunks : 0
  } catch {
    return 0
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
 * Upload a single file chunk-by-chunk to MinIO via the GEMINIbase REST API.
 * Automatically skips already-uploaded chunks when the same fileIdentifier
 * is reused (resume-after-retry).
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
    onProgress,
    signal,
  } = opts

  const total = file.size
  const totalChunks = Math.max(1, Math.ceil(total / chunkSize))
  const alreadyCount = await checkUploadedChunkCount(fileIdentifier, totalChunks)

  let uploaded = Math.min(total, alreadyCount * chunkSize)

  for (let i = 0; i < totalChunks; i++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
    if (i < alreadyCount) continue

    const start = i * chunkSize
    const end = Math.min(start + chunkSize, total)
    const chunk = file.slice(start, end)

    await uploadOneChunk({
      chunk,
      chunkIndex: i,
      totalChunks,
      fileIdentifier,
      objectName,
      bucketName,
      signal,
    })

    uploaded = Math.min(total, uploaded + (end - start))
    onProgress?.({
      uploaded,
      total,
      fraction: total > 0 ? uploaded / total : 1,
      chunkIndex: i,
      totalChunks,
    })
  }

  return { objectName, bucketName, bytes: total, chunkCount: totalChunks }
}
