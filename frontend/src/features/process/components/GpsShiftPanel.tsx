/**
 * GpsShiftPanel — apply / undo a GPS reference shift for a directory.
 *
 * Backed by PlotGeometryService.{shift_gps, undo_gps_shift, gps_shift_status}.
 * The user enters the (current_lat, current_lon) coordinates of a known
 * reference point in the imagery and applies the shift; subsequent plot-
 * geometry calculations use the shifted reference.
 */

import { Loader2 } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  useGpsShiftStatus,
  useShiftGps,
  useUndoGpsShift,
} from "@/features/process/hooks/usePlotGeometry"
import useCustomToast from "@/hooks/useCustomToast"

export function GpsShiftPanel({ directory }: { directory: string }) {
  const status = useGpsShiftStatus(directory)
  const shift = useShiftGps()
  const undo = useUndoGpsShift()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [lat, setLat] = useState("")
  const [lon, setLon] = useState("")

  async function applyShift() {
    const latN = Number(lat)
    const lonN = Number(lon)
    if (!Number.isFinite(latN) || !Number.isFinite(lonN)) {
      showErrorToast("Enter valid latitude and longitude.")
      return
    }
    try {
      await shift.mutateAsync({ directory, currentLat: latN, currentLon: lonN })
      setLat("")
      setLon("")
      showSuccessToast("GPS shift applied")
    } catch (err) {
      showErrorToast(
        err instanceof Error ? err.message : "Failed to apply shift",
      )
    }
  }
  async function applyUndo() {
    try {
      await undo.mutateAsync({ directory })
      showSuccessToast("GPS shift undone")
    } catch (err) {
      showErrorToast(
        err instanceof Error ? err.message : "Failed to undo shift",
      )
    }
  }

  const data = status.data
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">GPS shift</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1 text-sm">
            <p className="text-muted-foreground text-xs">Status</p>
            <p>
              {status.isLoading ? (
                <Loader2 className="inline h-4 w-4 animate-spin" />
              ) : data?.shifted ? (
                <span className="font-medium text-amber-700">shifted</span>
              ) : (
                <span className="text-muted-foreground">no shift applied</span>
              )}
            </p>
          </div>
          {data?.shifted && (
            <div className="space-y-1 text-sm">
              <p className="text-muted-foreground text-xs">Current reference</p>
              <p className="font-mono text-xs">
                {data.current_lat?.toFixed(6) ?? "—"},{" "}
                {data.current_lon?.toFixed(6) ?? "—"}
              </p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="shift-lat" className="mb-1.5 text-xs">
              Current latitude
            </Label>
            <Input
              id="shift-lat"
              type="number"
              step="any"
              placeholder="38.5341"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="shift-lon" className="mb-1.5 text-xs">
              Current longitude
            </Label>
            <Input
              id="shift-lon"
              type="number"
              step="any"
              placeholder="-121.7821"
              value={lon}
              onChange={(e) => setLon(e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={applyShift} disabled={shift.isPending}>
            {shift.isPending ? "Applying…" : "Apply shift"}
          </Button>
          <Button
            variant="outline"
            onClick={applyUndo}
            disabled={!data?.shifted || undo.isPending}
          >
            {undo.isPending ? "Undoing…" : "Undo shift"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
