/**
 * TraitExtractionDialog — configure + submit an EXTRACT_TRAITS job.
 *
 * R4c slice: ortho version picker, ExG threshold slider, submit button.
 * The plot-boundary version picker is stubbed because PlotBoundaryPrep
 * (R5) doesn't yet exist. Until R5 lands, the dialog warns the user that
 * boundaries must be drawn first and disables the submit button.
 *
 * Live per-plot preview from main's `/trait-extraction-preview` endpoint
 * is not restored — that endpoint doesn't exist on GEMINIbase. Users see
 * results after the job completes via TraitRecordsPanel.
 */
import { AlertTriangle } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { PlotGeometryVersion } from "@/features/process/hooks/usePlotGeometry"
import type { OrthoVersion } from "@/features/process/lib/orthoVersions"

export interface TraitDialogState {
  orthoVersion: number | null
  /** Plot-geometry boundary version (PlotGeometryVersion.version). */
  boundaryVersion: number | null
  exgThreshold: number
}

export interface TraitDialogProps {
  open: boolean
  onClose: () => void
  orthoVersions: OrthoVersion[]
  /** R5a-and-later: list of saved plot-geometry versions for the run's scope. */
  boundaryVersions?: PlotGeometryVersion[]
  state: TraitDialogState
  onChange: (next: TraitDialogState) => void
  onSubmit: () => void
  /** True while EXTRACT_TRAITS submit is in flight. */
  submitting?: boolean
}

export function TraitExtractionDialog({
  open,
  onClose,
  orthoVersions,
  boundaryVersions = [],
  state,
  onChange,
  onSubmit,
  submitting = false,
}: TraitDialogProps) {
  const orthoOptions = orthoVersions.length > 0
  const boundaryOptions = boundaryVersions.length > 0
  const boundaryReady = state.boundaryVersion !== null

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Configure Trait Extraction</DialogTitle>
          <DialogDescription>
            Compute per-plot vegetation fraction (and canopy height when a DEM is
            present) using the chosen orthomosaic and the active plot-boundary
            version.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-sm" htmlFor="trait-ortho-version">
              Orthomosaic version
            </Label>
            {orthoOptions ? (
              <Select
                value={
                  state.orthoVersion != null ? String(state.orthoVersion) : ""
                }
                onValueChange={(v) =>
                  onChange({ ...state, orthoVersion: Number(v) })
                }
              >
                <SelectTrigger
                  id="trait-ortho-version"
                  data-testid="trait-ortho-version"
                >
                  <SelectValue placeholder="Pick an ortho version" />
                </SelectTrigger>
                <SelectContent>
                  {orthoVersions.map((ov) => (
                    <SelectItem key={ov.version} value={String(ov.version)}>
                      {ov.label ? `${ov.label} (v${ov.version})` : `v${ov.version}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-muted-foreground text-xs">
                No orthomosaic versions available. Run the orthomosaic step or
                import one first.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm" htmlFor="trait-boundary-version">
              Plot-boundary version
            </Label>
            {boundaryOptions ? (
              <Select
                value={
                  state.boundaryVersion != null
                    ? String(state.boundaryVersion)
                    : ""
                }
                onValueChange={(v) =>
                  onChange({ ...state, boundaryVersion: Number(v) })
                }
              >
                <SelectTrigger
                  id="trait-boundary-version"
                  data-testid="trait-boundary-version"
                >
                  <SelectValue placeholder="Pick a boundary version" />
                </SelectTrigger>
                <SelectContent>
                  {boundaryVersions.map((bv) => (
                    <SelectItem key={bv.version} value={String(bv.version)}>
                      {bv.name ? `${bv.name} (v${bv.version})` : `v${bv.version}`}
                      {bv.is_active ? " · active" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex items-start gap-2 rounded border border-amber-300 bg-amber-500/5 p-2 text-xs">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                <span className="text-muted-foreground">
                  No plot-boundary versions saved for this scope. Open the
                  plot_boundary_prep tool first, draw a polygon, and save it.
                </span>
              </div>
            )}
          </div>

          {boundaryOptions && !boundaryReady && (
            <p className="text-muted-foreground text-xs">
              Pick a boundary version to enable extraction.
            </p>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm" htmlFor="trait-exg">
                ExG Threshold
              </Label>
              <span className="text-muted-foreground font-mono text-sm">
                {state.exgThreshold.toFixed(2)}
              </span>
            </div>
            <input
              id="trait-exg"
              data-testid="trait-exg-threshold"
              type="range"
              min={0}
              max={0.5}
              step={0.01}
              value={state.exgThreshold}
              onChange={(e) =>
                onChange({
                  ...state,
                  exgThreshold: parseFloat(e.target.value),
                })
              }
              className="w-full accent-green-600"
            />
            <p className="text-muted-foreground text-xs">
              Lower values detect more vegetation; higher values are stricter.
              Worker default is 0.10.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={
              !orthoOptions ||
              state.orthoVersion === null ||
              !boundaryReady ||
              submitting
            }
          >
            Run Trait Extraction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
