/**
 * The plot images step's results, from either source:
 *  - the orthomosaic, cut by the plot boundaries (PlotImages/);
 *  - the raw frames, each plot's best ones by the camera positions of the
 *    ODM run its boundaries were drawn on (PlotFrames/) — for flights whose
 *    orthomosaic smears in wind. A quick orthomosaic (the Quick preset) is
 *    enough to place the boundaries for this.
 */
import { Images, Loader2, Map as MapIcon } from "lucide-react"
import { useState } from "react"

import type { FileMetadata } from "@/client"
import { Button } from "@/components/ui/button"
import { PlotFramesPanel } from "./PlotFramesPanel"
import { PlotImageGrid } from "./PlotImageGrid"

export function PlotImagesStepPanel({
  plotImageFiles,
  prefix,
  framesPrefix,
  hasFrames,
  hasCameraPositions,
  running,
  onRunFrames,
}: {
  plotImageFiles: FileMetadata[]
  prefix: string
  framesPrefix: string
  /** A frames manifest exists for this date. */
  hasFrames: boolean
  /** The orthomosaic's ODM run kept its camera positions. */
  hasCameraPositions: boolean
  running: boolean
  onRunFrames: () => void
}) {
  const [source, setSource] = useState<"ortho" | "frames">(
    hasFrames && plotImageFiles.length === 0 ? "frames" : "ortho",
  )
  return (
    <div className="space-y-3" data-testid="plot-images-step">
      <div className="inline-flex rounded-md border bg-muted p-0.5 text-sm">
        {(
          [
            ["ortho", "From the orthomosaic", MapIcon],
            ["frames", "From the raw frames", Images],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => setSource(key)}
            data-testid={`plot-source-${key}`}
            className={`flex items-center gap-1.5 rounded px-3 py-1 ${source === key ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>
      {source === "ortho" ? (
        <PlotImageGrid files={plotImageFiles} prefix={prefix} />
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            For each plot, the frames of the flight that show it best (the whole
            plot in frame, then the most top-down view), placed with the camera
            positions of the orthomosaic the boundaries were drawn on. Use it
            when wind smears the orthomosaic: a Quick orthomosaic is enough to
            place the boundaries. You get a crop of each frame, the best frame
            straightened to a top-down view, and the full frames, all named by
            plot and accession.
          </p>
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              disabled={running || !hasCameraPositions}
              onClick={onRunFrames}
              data-testid="plot-frames-run"
            >
              {running && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              )}
              {hasFrames ? "Pick the frames again" : "Pick each plot's frames"}
            </Button>
            {!hasCameraPositions && (
              <span className="text-xs text-amber-600">
                This orthomosaic's ODM run did not keep its camera positions
                (built before this option). Build it again — the Quick preset is
                enough — and place the boundaries on it.
              </span>
            )}
          </div>
          {hasFrames && <PlotFramesPanel prefix={framesPrefix} />}
        </div>
      )}
    </div>
  )
}
