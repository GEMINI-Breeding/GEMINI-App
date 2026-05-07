/**
 * PlotMarker — placeholder until the GPS-data + plot-markings endpoints
 * land on GEMINIbase.
 *
 * Main's PlotMarker (1,039 LOC) navigated raw Amiga rover images via a
 * GPS-aware slider, marking start/end frames per plot. The flow needs
 * three REST endpoints that don't exist on GEMINIbase yet:
 *
 *   GET  /api/processing/runs/{runId}/gps-data
 *   POST /api/processing/runs/{runId}/plot-markings
 *   GET  /api/processing/runs/{runId}/plot-markings
 *
 * Tracked in `findings.md` "Ground pipeline gaps" + `task_plan.md`
 * Phase 15 with explicit ownership. This component renders a clear
 * dependency notice so the wizard doesn't pretend the step works.
 *
 * Workaround until then: users can record start/end frame indices in a
 * spreadsheet and feed them into the stitch worker via the `image_paths`
 * parameter directly (advanced; not exposed in UI).
 */
import { AlertTriangle } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

interface PlotMarkerProps {
  onCancel?: () => void
}

export function PlotMarker({ onCancel }: PlotMarkerProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <AlertTriangle className="text-amber-600 mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <CardTitle className="text-base">
              Plot marking depends on backend endpoints not yet shipped
            </CardTitle>
            <CardDescription>
              The marking flow needs GEMINIbase to expose three endpoints
              (per-image GPS data + save/list of frame-range markings)
              equivalent to the deleted <code>/pipeline-runs/.../gps-data</code>
              and <code>/plot-markings</code> routes from the pre-migration
              backend.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Once the endpoints land, this tool will replace the placeholder with
          the full image-slider + frame-marking UI restored from
          <code className="mx-1">main</code>'s 1,039-LOC PlotMarker. The rest of
          the ground pipeline (boundaries, edge crop, stitching submission) is
          wired and works.
        </p>
        <p className="text-muted-foreground">
          <strong>Workaround:</strong> if you have frame-range data already, you
          can submit a RUN_STITCH job directly with an explicit{" "}
          <code>image_paths</code> array — bypasses this UI but unblocks
          stitching while we wait.
        </p>
        <p className="text-muted-foreground text-xs">
          See <code>findings.md</code> "Ground pipeline gaps" for the full
          backend contract + ownership.
        </p>
        <div className="flex items-center justify-end pt-2">
          {onCancel && (
            <Button variant="outline" onClick={onCancel}>
              Close
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
