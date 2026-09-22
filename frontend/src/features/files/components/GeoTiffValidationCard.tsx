/**
 * GeoTiffValidationCard
 *
 * Inline (non-modal) check shown directly below an Orthomosaic / DEM upload
 * once it completes: is this a georeferenced raster the pipeline can place?
 * Persistent on the page so the user can't miss it by navigating away.
 *
 * Asks TiTiler (`/titiler/cog/info`), which reads the file straight from
 * MinIO. Main called `/api/v1/files/check-geotiff`, a route GEMINIbase
 * doesn't have, and then auto-reprojected anything not in WGS84. Nothing
 * here needs WGS84 — TiTiler tiles and the geo/ML workers reproject from
 * any CRS — so reprojecting would only resample the data. What does break
 * everything is a TIF with no coordinate system at all; that is what this
 * reports.
 */

import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react"

interface CogInfo {
  crs?: string | null
  width?: number
  height?: number
  count?: number
}

/** `http://www.opengis.net/def/crs/EPSG/0/32610` → `EPSG:32610`. */
export function crsLabel(crs: string | null | undefined): string | null {
  if (!crs) return null
  const m = crs.match(/EPSG\/\d+\/(\d+)$/) ?? crs.match(/EPSG:(\d+)/i)
  return m ? `EPSG:${m[1]}` : crs
}

interface GeoTiffValidationCardProps {
  /** MinIO object path of the uploaded TIF (no bucket prefix). */
  destPath: string
}

export function GeoTiffValidationCard({
  destPath,
}: GeoTiffValidationCardProps) {
  const info = useQuery({
    queryKey: ["titiler", "info", destPath],
    queryFn: async (): Promise<CogInfo> => {
      const url = `s3://gemini/${destPath.replace(/^gemini\//, "")}`
      const res = await fetch(
        `/titiler/cog/info?url=${encodeURIComponent(url)}`,
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  })

  if (info.isLoading) {
    return (
      <div className="mt-2 flex items-center gap-2 text-muted-foreground text-xs">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Checking georeferencing…
      </div>
    )
  }

  if (info.isError || !info.data) {
    return (
      <div
        className="mt-2 flex items-center gap-2 text-amber-700 text-xs"
        data-testid="geotiff-check-failed"
      >
        <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
        <span>
          Couldn't read this file as a GeoTIFF. Check it opens in a GIS before
          processing.
        </span>
      </div>
    )
  }

  const crs = crsLabel(info.data.crs)
  if (!crs) {
    return (
      <div
        className="mt-2 flex items-center gap-2 text-red-600 text-xs"
        data-testid="geotiff-check-no-crs"
      >
        <XCircle className="h-3.5 w-3.5 flex-shrink-0" />
        <span>
          No coordinate system — this file can't be placed on the map or cut
          into plots. Export it as a GeoTIFF with its CRS and upload it again.
        </span>
      </div>
    )
  }

  const { width, height, count } = info.data
  return (
    <div
      className="mt-2 flex items-center gap-2 text-green-700 text-xs"
      data-testid="geotiff-check-ok"
    >
      <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
      <span>
        Georeferenced ({crs}){width && height ? ` · ${width}×${height} px` : ""}
        {count ? ` · ${count} band${count === 1 ? "" : "s"}` : ""}
      </span>
    </div>
  )
}
