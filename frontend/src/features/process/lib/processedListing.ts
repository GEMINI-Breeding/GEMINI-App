import { OpenAPI } from "@/client"
import type { FileMetadata } from "@/client/types.gen"
import { getToken } from "@/lib/auth"

/** Everything under a date's Processed/ folder except the per-plot frame
 *  images (PlotFrames/…/*.jpg|png|tif). Those are most of the folder (a
 *  sorghum date: 3,000 of 3,300 objects, thermal crops mostly), their own
 *  panels list them, and the run page only needs their manifests. */
export const PROCESSED_MATCH = "^(?!.*/PlotFrames/.*\\.(?:jpe?g|png|tiff?)$)"

/** List a Processed/ prefix without the frame images (an older server
 *  ignores the filter and sends everything, which is still correct). */
export async function listProcessed(
  bucket: string,
  prefix: string,
): Promise<FileMetadata[]> {
  const base = (OpenAPI.BASE ?? "").replace(/\/$/, "")
  const path = `${bucket}/${prefix}`
    .split("/")
    .map(encodeURIComponent)
    .join("/")
  const res = await fetch(
    `${base}/api/files/list/${path}?match=${encodeURIComponent(PROCESSED_MATCH)}`,
    { headers: { Authorization: `Bearer ${getToken()}` } },
  )
  if (!res.ok) throw new Error(`Listing ${prefix} failed (${res.status})`)
  return ((await res.json()) as FileMetadata[] | null) ?? []
}
