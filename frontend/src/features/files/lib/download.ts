import { OpenAPI } from "@/client"
import { getToken } from "@/lib/auth"

export const DEFAULT_BUCKET = "gemini"

export function apiUrl(path: string): string {
  return `${(OpenAPI.BASE ?? "").replace(/\/$/, "")}${path}`
}

/** A JSON object from storage (e.g. a manifest), or null when it is not there. */
export async function readJson<T>(objectPath: string): Promise<T | null> {
  const res = await fetch(
    apiUrl(`/api/files/download/${DEFAULT_BUCKET}/${objectPath}`),
    { headers: { Authorization: `Bearer ${getToken()}` } },
  )
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Could not read ${objectPath}: ${res.status}`)
  return (await res.json()) as T
}

/**
 * Save a MinIO object to the user's machine. The download route needs the
 * bearer token, so fetch into a blob rather than pointing an <a> at it.
 */
export async function downloadViaBrowser(objectPath: string): Promise<void> {
  const url = apiUrl(`/api/files/download/${DEFAULT_BUCKET}/${objectPath}`)
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${getToken()}` },
  })
  if (!res.ok) throw new Error(`Download failed: ${res.status}`)
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = objectUrl
  a.download = objectPath.split("/").pop() ?? "download"
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(objectUrl)
}

/**
 * Download many MinIO objects as one ZIP (POST /api/files/download_zip).
 * Entries keep their paths relative to the files' common folder.
 */
export async function downloadZip(opts: {
  files?: string[]
  prefix?: string
  /** Each object under its own name in the archive (one object may repeat). */
  entries?: { object: string; name: string }[]
  filename: string
}): Promise<void> {
  const res = await fetch(apiUrl("/api/files/download_zip"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...(opts.files ? { files: opts.files } : {}),
      ...(opts.prefix ? { prefix: opts.prefix } : {}),
      ...(opts.entries ? { entries: opts.entries } : {}),
      filename: opts.filename,
    }),
  })
  if (!res.ok) throw new Error(`ZIP download failed: ${res.status}`)
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = objectUrl
  a.download = opts.filename.endsWith(".zip")
    ? opts.filename
    : `${opts.filename}.zip`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(objectUrl)
}
