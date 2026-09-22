import { OpenAPI } from "@/client"
import { getToken } from "@/lib/auth"

export const DEFAULT_BUCKET = "gemini"

export function apiUrl(path: string): string {
  return `${(OpenAPI.BASE ?? "").replace(/\/$/, "")}${path}`
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
