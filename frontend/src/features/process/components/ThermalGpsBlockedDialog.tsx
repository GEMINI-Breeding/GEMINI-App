/**
 * Modal dialog shown when RUN_ODM is blocked because the selected
 * thermal dataset has no per-image GPS.
 *
 * Why a modal and not a toast: per memory `feedback_error_dialogs`,
 * critical errors deserve a Dialog the user has to acknowledge.
 * A toast in this position used to disappear before the user could
 * understand why their (long-running) submission never started.
 */
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { ThermalGpsRequiredError } from "@/features/process/lib/thermalGpsPreflight"

interface ThermalGpsBlockedDialogProps {
  open: boolean
  error: ThermalGpsRequiredError | null
  onOpenChange: (open: boolean) => void
}

export function ThermalGpsBlockedDialog({
  open,
  error,
  onOpenChange,
}: ThermalGpsBlockedDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="thermal-gps-blocked-dialog">
        <DialogHeader>
          <DialogTitle>Orthomosaic blocked — no per-image GPS</DialogTitle>
          <DialogDescription>
            ODM needs GPS in each image to align a flight mosaic. This
            thermal dataset has none, so we stopped the submission
            before the worker spent ~10 minutes failing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 text-sm">
          {error && (
            <div className="text-muted-foreground">
              <div>
                Calibration mode:{" "}
                <span className="font-mono">{error.mode}</span>
              </div>
              {error.totalFiles > 0 && (
                <div>
                  Files in dataset:{" "}
                  <span className="font-mono">{error.totalFiles}</span>
                </div>
              )}
            </div>
          )}
          <p>To produce an orthomosaic for this scope, do one of:</p>
          <ul className="ml-5 list-disc space-y-1">
            <li>
              Upload a co-captured RGB stream (e.g. drone imagery) and run
              ODM against that sensor.
            </li>
            <li>
              Attach a per-image GPS log (CSV with frame timestamps)
              alongside the thermal frames. (Not supported in v1 — see
              the thermal-support plan, Phase D open questions.)
            </li>
          </ul>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="thermal-gps-blocked-close"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
