/**
 * GeoTiffValidationDialog
 *
 * Shown after an Orthomosaic TIF upload completes.  For each uploaded TIF the
 * backend /files/check-geotiff endpoint is queried.  If the CRS is not WGS84
 * (EPSG:4326) the user is prompted to convert in-place via
 * /files/convert-geotiff, with a warning that reprojection may alter data
 * precision.
 */

import { useEffect, useState } from "react"
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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

interface GeoTiffValidationDialogProps {
  /** Absolute dest paths of the uploaded TIF files to validate */
  destPaths: string[]
  onClose: () => void
}

type CheckState = "checking" | "ok" | "needs_conversion" | "error"
type ConvertState = "idle" | "converting" | "done" | "failed"

export function GeoTiffValidationDialog({ destPaths, onClose }: GeoTiffValidationDialogProps) {
  const { showErrorToast } = useCustomToast()
  const [infos, setInfos] = useState<GeoTiffInfo[]>([])
  const [checkState, setCheckState] = useState<CheckState>("checking")
  const [convertStates, setConvertStates] = useState<Record<string, ConvertState>>({})

  // Check all uploaded TIFs on mount
  useEffect(() => {
    async function checkAll() {
      const results: GeoTiffInfo[] = []
      for (const p of destPaths) {
        try {
          const res = await fetch(
            apiUrl(`/api/v1/files/check-geotiff?path=${encodeURIComponent(p)}`),
            { headers: authHeaders() },
          )
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const data = await res.json()
          results.push({
            path: p,
            filename: p.split(/[\\/]/).pop() ?? p,
            ...data,
          })
        } catch {
          // If we can't check a file, report an error but don't block the user
          results.push({
            path: p,
            filename: p.split(/[\\/]/).pop() ?? p,
            crs_epsg: null,
            crs_name: null,
            is_wgs84: false,
            width: 0,
            height: 0,
          })
        }
      }
      setInfos(results)
      const anyBad = results.some((r) => !r.is_wgs84)
      setCheckState(anyBad ? "needs_conversion" : "ok")
    }
    checkAll()
  }, [destPaths])

  async function handleConvert(info: GeoTiffInfo) {
    setConvertStates((prev) => ({ ...prev, [info.path]: "converting" }))
    try {
      const res = await fetch(apiUrl("/api/v1/files/convert-geotiff"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ file_path: info.path }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Conversion failed" }))
        throw new Error(err.detail ?? "Conversion failed")
      }
      setConvertStates((prev) => ({ ...prev, [info.path]: "done" }))
      setInfos((prev) =>
        prev.map((i) => (i.path === info.path ? { ...i, is_wgs84: true, crs_epsg: 4326, crs_name: "WGS 84" } : i)),
      )
    } catch (err) {
      setConvertStates((prev) => ({ ...prev, [info.path]: "failed" }))
      showErrorToast(err instanceof Error ? err.message : "Conversion failed")
    }
  }

  const nonWgs84 = infos.filter((i) => !i.is_wgs84)
  const allConverted = nonWgs84.length > 0 && nonWgs84.every((i) => convertStates[i.path] === "done")
  const open = checkState !== "ok" || !allConverted

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Orthomosaic Validation</DialogTitle>
          <DialogDescription asChild>
            <div className="text-sm text-muted-foreground">
              {checkState === "checking"
                ? "Checking uploaded files…"
                : checkState === "ok" || allConverted
                  ? "All files are in WGS84 (EPSG:4326) and ready to use."
                  : "Some files are not in WGS84 format. BoundaryDrawer and map overlays require WGS84."}
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {checkState === "checking" && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Checking CRS of {destPaths.length} file(s)…
            </div>
          )}

          {infos.map((info) => {
            const cState = convertStates[info.path] ?? "idle"
            const converted = cState === "done"
            return (
              <div
                key={info.path}
                className="rounded-md border p-3 space-y-2"
              >
                <div className="flex items-start gap-2">
                  {info.is_wgs84 || converted ? (
                    <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{info.filename}</p>
                    <p className="text-xs text-muted-foreground">
                      {converted
                        ? "Converted to WGS84 (EPSG:4326)"
                        : info.crs_name
                          ? `CRS: ${info.crs_name} (EPSG:${info.crs_epsg ?? "?"})`
                          : "CRS: unknown"}
                      {info.width > 0 && ` · ${info.width} × ${info.height} px`}
                    </p>
                  </div>
                </div>

                {!info.is_wgs84 && !converted && (
                  <div className="ml-6 space-y-2">
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                      <strong>Warning:</strong> Reprojection to WGS84 may slightly alter pixel values
                      and geometry due to resampling. The original will be backed up as{" "}
                      <code className="font-mono">{info.filename.replace(/\.tif(f)?$/i, ".original.tif")}</code>.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={cState === "converting"}
                      onClick={() => handleConvert(info)}
                    >
                      {cState === "converting" && <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />}
                      {cState === "converting" ? "Converting…" : "Convert to WGS84"}
                    </Button>
                    {cState === "failed" && (
                      <p className="text-xs text-red-600">Conversion failed — see error above.</p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {allConverted || checkState === "ok" ? "Close" : "Keep Original (skip conversion)"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
