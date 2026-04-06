/**
 * GeoTiffValidationCard
 *
 * Inline (non-modal) CRS validation shown directly below an Orthomosaic upload
 * field once the upload completes.  Persistent on the page so the user cannot
 * miss it by navigating away before a modal would open.
 */

import { useEffect, useState } from "react"
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import useCustomToast from "@/hooks/useCustomToast"

function apiUrl(path: string): string {
  const base = (window as any).__GEMI_BACKEND_URL__ ?? ""
  return base ? `${base}${path}` : path
}

function authHeaders() {
  const token = localStorage.getItem("access_token") || ""
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
}

interface GeoTiffInfo {
  path: string
  filename: string
  crs_epsg: number | null
  crs_name: string | null
  is_wgs84: boolean
  width: number
  height: number
}

type CheckState = "checking" | "ok" | "needs_conversion" | "error"
type ConvertState = "idle" | "converting" | "done" | "failed"

interface GeoTiffValidationCardProps {
  /** Absolute dest path of the uploaded TIF file to validate */
  destPath: string
}

export function GeoTiffValidationCard({ destPath }: GeoTiffValidationCardProps) {
  const { showErrorToast } = useCustomToast()
  const [info, setInfo] = useState<GeoTiffInfo | null>(null)
  const [checkState, setCheckState] = useState<CheckState>("checking")
  const [convertState, setConvertState] = useState<ConvertState>("idle")

  useEffect(() => {
    async function checkAndConvert() {
      // 1. Check CRS
      let result: GeoTiffInfo
      try {
        const res = await fetch(
          apiUrl(`/api/v1/files/check-geotiff?path=${encodeURIComponent(destPath)}`),
          { headers: authHeaders() },
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        result = {
          path: destPath,
          filename: destPath.split(/[\\/]/).pop() ?? destPath,
          ...data,
        }
        setInfo(result)
      } catch {
        setCheckState("error")
        return
      }

      if (result.is_wgs84) {
        setCheckState("ok")
        return
      }

      // 2. Not WGS84 — auto-reproject without asking
      setConvertState("converting")
      try {
        const res = await fetch(apiUrl("/api/v1/files/convert-geotiff"), {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ file_path: result.path }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: "Conversion failed" }))
          throw new Error(err.detail ?? "Conversion failed")
        }
        setConvertState("done")
        setInfo((prev) => prev ? { ...prev, is_wgs84: true, crs_epsg: 4326, crs_name: "WGS 84" } : prev)
        setCheckState("ok")
      } catch (err) {
        setConvertState("failed")
        showErrorToast(err instanceof Error ? err.message : "Auto-reprojection failed")
      }
    }
    checkAndConvert()
  }, [destPath])

  // Checking CRS / reprojecting in progress
  if (checkState === "checking" || convertState === "converting") {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-xs mt-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        {convertState === "converting" ? "Reprojecting to WGS84…" : "Checking CRS…"}
      </div>
    )
  }

  if (checkState === "error" || !info) return null

  if (checkState === "ok") {
    return (
      <div className="flex items-center gap-2 text-green-700 text-xs mt-2">
        <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
        <span>
          {convertState === "done"
            ? `Reprojected to WGS84 — original backed up as ${info.filename.replace(/\.tif(f)?$/i, ".original.tif")}`
            : "WGS84 (EPSG:4326) — ready to use"}
        </span>
      </div>
    )
  }

  // convert failed
  return (
    <div className="flex items-center gap-2 text-red-600 text-xs mt-2">
      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
      <span>
        Auto-reprojection failed — file is not in WGS84. Reproject it externally and re-upload.
      </span>
    </div>
  )
}
