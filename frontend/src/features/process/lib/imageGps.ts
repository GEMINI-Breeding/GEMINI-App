/**
 * Shared helpers for fetching raw drone images from MinIO and reading
 * their EXIF GPS in the browser. Used by `useImageGps` (image-review +
 * GCP picker map tab) and by `GcpPicker` for the per-image preview blob.
 *
 * GPS is parsed via `exifr` over a 128 KB Range request — JPEG EXIF
 * sits near the start of the file, so this avoids downloading the
 * full pixel data when we only need lat/lon/alt.
 */

import exifr from "exifr"

const DEFAULT_BUCKET = "gemini"
const EXIF_RANGE_BYTES = 131072

export type ImageGps = { lat: number; lon: number; alt: number } | null

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("gemini.auth.token") ?? ""
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function fetchObjectAsBlob(objectName: string): Promise<Blob> {
  const res = await fetch(
    `/api/files/download/${DEFAULT_BUCKET}/${objectName}`,
    {
      headers: authHeaders(),
    },
  )
  if (!res.ok) throw new Error(`download ${objectName}: ${res.status}`)
  return res.blob()
}

export async function fetchObjectAsText(objectName: string): Promise<string> {
  const blob = await fetchObjectAsBlob(objectName)
  return blob.text()
}

/**
 * Fetch the first ~128 KB of a JPEG so we can parse EXIF/XMP without
 * downloading 5 MB per image. JPEG segments are linearly ordered with
 * EXIF, IPTC, and short XMP all sitting near the start, so this is
 * enough for any drone EXIF in practice. If the server doesn't honor
 * Range, we fall back to the full body — exifr can still parse it,
 * just slower.
 */
export async function fetchExifHeader(
  objectName: string,
): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(
      `/api/files/download/${DEFAULT_BUCKET}/${objectName}`,
      {
        headers: {
          ...authHeaders(),
          Range: `bytes=0-${EXIF_RANGE_BYTES - 1}`,
        },
      },
    )
    if (!res.ok && res.status !== 206) return null
    return await res.arrayBuffer()
  } catch {
    return null
  }
}

export async function readImageGps(buf: ArrayBuffer): Promise<ImageGps> {
  try {
    // `exifr.gps()` is the canonical way to get post-processed
    // {latitude, longitude}. It skips altitude, so we run a second
    // parse (cheap — exifr re-uses the in-memory buffer) for altitude.
    const [gps, tags] = await Promise.all([
      exifr.gps(buf).catch(() => null),
      exifr
        .parse(buf, {
          gps: true,
          pick: ["GPSAltitude", "GPSAltitudeRef"],
        })
        .catch(() => null) as Promise<{
        GPSAltitude?: number
        GPSAltitudeRef?: number | string
      } | null>,
    ])
    if (
      !gps ||
      typeof gps.latitude !== "number" ||
      typeof gps.longitude !== "number"
    ) {
      return null
    }
    let alt =
      tags && typeof tags.GPSAltitude === "number" ? tags.GPSAltitude : 0
    if (tags?.GPSAltitudeRef === 1 || tags?.GPSAltitudeRef === "1") alt = -alt
    return { lat: gps.latitude, lon: gps.longitude, alt }
  } catch {
    return null
  }
}
