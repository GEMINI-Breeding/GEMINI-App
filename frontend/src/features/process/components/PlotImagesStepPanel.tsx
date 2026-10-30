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
import { Input } from "@/components/ui/input"
import type { PlotChoice } from "@/features/process/lib/plotSelection"
import { PlotFramesPanel } from "./PlotFramesPanel"
import { PlotImageGrid } from "./PlotImageGrid"

export function PlotImagesStepPanel({
  plotImageFiles,
  prefix,
  framesPrefix,
  hasFrames,
  hasCameraPositions,
  offerFrames = true,
  running,
  onRunFrames,
  onRunOrtho,
}: {
  plotImageFiles: FileMetadata[]
  prefix: string
  framesPrefix: string
  /** A frames manifest exists for this date. */
  hasFrames: boolean
  /** The orthomosaic's ODM run kept its camera positions. */
  hasCameraPositions: boolean
  /** An orthomosaic of this run was built here from raw images: false when it
   * was uploaded, and then only the orthomosaic's plot images are offered. */
  offerFrames?: boolean
  running: boolean
  onRunFrames: (plots: PlotChoice) => void
  /** Plot images from the orthomosaic, of the plots chosen. */
  onRunOrtho?: (plots: PlotChoice) => void
}) {
  const [choice, setChoice] = useState<"all" | "missing" | "list">("all")
  const [listText, setListText] = useState("")
  const plotChoice: PlotChoice =
    choice === "list" ? { mode: "list", text: listText } : { mode: choice }
  const choiceReady = choice !== "list" || listText.trim().length > 0
  const plotsPicker = (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs"
      data-testid="plot-images-which"
    >
      <span className="font-medium">Plots:</span>
      {(
        [
          ["all", "All"],
          ["missing", "Those without images yet"],
          ["list", "These:"],
        ] as const
      ).map(([key, label]) => (
        <label key={key} className="flex items-center gap-1">
          <input
            type="radio"
            name="plot-images-which"
            checked={choice === key}
            onChange={() => setChoice(key)}
            data-testid={`plot-images-which-${key}`}
          />
          {label}
        </label>
      ))}
      <Input
        className="h-7 w-48 text-xs"
        placeholder="e.g. 12, 15-18, 106"
        value={listText}
        onFocus={() => setChoice("list")}
        onChange={(e) => setListText(e.target.value)}
        aria-label="Plots to make images of"
        data-testid="plot-images-list"
      />
      <span className="text-muted-foreground">
        Some plots only: added to the earlier images (e.g. a plot just added to
        the boundaries).
      </span>
    </div>
  )
  const [source, setSource] = useState<"ortho" | "frames">(
    hasFrames && plotImageFiles.length === 0 ? "frames" : "ortho",
  )
  if (!offerFrames)
    return (
      <div className="space-y-3" data-testid="plot-images-step">
        {onRunOrtho && plotImageFiles.length > 0 && (
          <div className="space-y-2">
            {plotsPicker}
            <Button
              size="sm"
              variant="outline"
              disabled={running || !choiceReady}
              onClick={() => onRunOrtho(plotChoice)}
              data-testid="plot-ortho-run"
            >
              {running && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              )}
              {choice === "all"
                ? "Cut the plot images again"
                : "Cut these plots' images"}
            </Button>
          </div>
        )}
        <PlotImageGrid files={plotImageFiles} prefix={prefix} />
      </div>
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
        <div className="space-y-3">
          {onRunOrtho && (
            <div className="space-y-2">
              {plotsPicker}
              <Button
                size="sm"
                variant="outline"
                disabled={running || !choiceReady}
                onClick={() => onRunOrtho(plotChoice)}
                data-testid="plot-ortho-run"
              >
                {running && (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                )}
                {choice === "all"
                  ? plotImageFiles.length
                    ? "Cut the plot images again"
                    : "Cut the plot images"
                  : "Cut these plots' images"}
              </Button>
            </div>
          )}
          <PlotImageGrid files={plotImageFiles} prefix={prefix} />
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            For each plot, the frames of the flight that show it best (the whole
            plot in frame, then the most top-down view), placed with the camera
            positions of the orthomosaic the boundaries were drawn on. Use it
            when wind smears the orthomosaic: a Quick orthomosaic is enough to
            place the boundaries. You get a crop of each frame, the best frame
            straightened to a top-down view, and the full frames, all named by
            plot and accession. The flight's other cameras (thermal), uploaded
            for this date as their own sensor, are matched to these frames by
            capture time and cut the same way; a thermal camera also gives each
            plot's canopy temperature.
          </p>
          {hasFrames && plotsPicker}
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              disabled={running || !hasCameraPositions || !choiceReady}
              onClick={() => onRunFrames(plotChoice)}
              data-testid="plot-frames-run"
            >
              {running && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              )}
              {!hasFrames
                ? "Pick each plot's frames"
                : choice === "all"
                  ? "Pick the frames again"
                  : "Pick these plots' frames"}
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
