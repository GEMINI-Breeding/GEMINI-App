/**
 * EdgeCropTool — configure stitching edge mask for AgRowStitch.
 *
 * R6 MVP. Lets the user pick a per-side pixel mask (left/right/top/bottom)
 * that AgRowStitch crops from each input image before stitching. Saves
 * via PlotGeometryService.stitch_mask/save against the run's processed
 * directory; the stitching step reads it back when assembling the
 * AgRowStitch config.
 *
 * The original main version (463 LOC) overlaid the four mask values on a
 * sample image so users could see what was being cropped. This MVP
 * collects the same four values without the visual overlay; the visual
 * overlay can be added later if users find the blind-tuning UX painful.
 */
import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Save } from "lucide-react"

import { PlotGeometryService } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  setStepState,
  type Run,
} from "@/features/process/lib/runStore"
import type { AerialScope } from "@/features/process/lib/paths"
import { processedPrefix } from "@/features/process/lib/paths"
import useCustomToast from "@/hooks/useCustomToast"
import { isLoggedIn } from "@/lib/auth"

interface EdgeCropToolProps {
  run: Run
  scope: AerialScope
  onSaved?: () => void
  onCancel?: () => void
}

interface MaskValues {
  left: number
  right: number
  top: number
  bottom: number
}

const DEFAULT_MASK: MaskValues = { left: 0, right: 0, top: 0, bottom: 0 }

export function EdgeCropTool({
  run,
  scope,
  onSaved,
  onCancel,
}: EdgeCropToolProps) {
  const directory = processedPrefix(scope)
  const queryClient = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const [mask, setMask] = useState<MaskValues>(DEFAULT_MASK)

  // Try to hydrate from a previously-saved mask. The check endpoint
  // returns the stored mask when present.
  const checkQuery = useQuery({
    queryKey: ["plot-geometry", "stitch-mask", directory],
    queryFn: async () => {
      // The check endpoint takes the per-component scope rather than the
      // composed directory; mirror the worker's expectation.
      return await PlotGeometryService.apiPlotGeometryStitchMaskCheckCheckStitchMask(
        {
          requestBody: {
            year: scope.year,
            experiment: scope.experiment,
            location: scope.location,
            population: scope.population,
            date: scope.date,
            platform: scope.platform,
            sensor: scope.sensor,
          },
        },
      )
    },
    enabled: isLoggedIn(),
  })

  useEffect(() => {
    if (!checkQuery.data) return
    const data = checkQuery.data as {
      mask?: { left?: number; right?: number; top?: number; bottom?: number } | null
    }
    if (data.mask) {
      setMask({
        left: data.mask.left ?? 0,
        right: data.mask.right ?? 0,
        top: data.mask.top ?? 0,
        bottom: data.mask.bottom ?? 0,
      })
    }
  }, [checkQuery.data])

  const save = useMutation({
    mutationFn: async () => {
      await PlotGeometryService.apiPlotGeometryStitchMaskSaveSaveStitchMask({
        requestBody: {
          directory,
          mask,
        },
      })
    },
    onSuccess: () => {
      setStepState(run.id, "edge_crop", {
        status: "completed",
        completedAt: new Date().toISOString(),
        outputs: {
          ...(run.steps.edge_crop?.outputs ?? {}),
          mask,
        },
      })
      queryClient.invalidateQueries({
        queryKey: ["plot-geometry", "stitch-mask", directory],
      })
      showSuccessToast("Saved stitch mask")
      onSaved?.()
    },
    onError: (err) =>
      showErrorToast(err instanceof Error ? err.message : "Failed to save"),
  })

  function setSide(side: keyof MaskValues, value: number) {
    setMask((m) => ({ ...m, [side]: Math.max(0, Math.round(value)) }))
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Edge crop mask</CardTitle>
          <CardDescription>
            Pixel margin AgRowStitch trims from each image edge before
            matching features. Set to 0 unless your camera mount has a
            fixed obstruction (lens cowl, monopod arm, etc.). Stored at{" "}
            <code>{directory}</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {(["left", "right", "top", "bottom"] as const).map((side) => (
              <div key={side}>
                <Label htmlFor={`mask-${side}`} className="mb-1.5 text-xs capitalize">
                  {side} (px)
                </Label>
                <Input
                  id={`mask-${side}`}
                  data-testid={`mask-${side}`}
                  type="number"
                  min={0}
                  value={mask[side]}
                  onChange={(e) => setSide(side, parseInt(e.target.value, 10) || 0)}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          data-testid="mask-save-and-complete"
          onClick={() => save.mutate()}
          disabled={save.isPending}
        >
          {save.isPending ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="mr-1.5 h-3.5 w-3.5" />
          )}
          Save & complete step
        </Button>
      </div>
    </div>
  )
}
