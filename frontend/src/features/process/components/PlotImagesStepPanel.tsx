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

/** The source and plots a plot images run was queued with (or the defaults). */
export function queuedChoice(queued: Record<string, unknown> | undefined): {
  source?: "ortho" | "frames"
  plots: PlotChoice
} {
  const source =
    queued?.source === "frames" || queued?.source === "ortho"
      ? queued.source
      : undefined
  const p = queued?.plots as { mode?: unknown; text?: unknown } | undefined
  const plots: PlotChoice =
    p?.mode === "list" && typeof p.text === "string"
      ? { mode: "list", text: p.text }
      : p?.mode === "missing"
        ? { mode: "missing" }
        : { mode: "all" }
  return { source, plots }
}

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
  queued,
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
  /** What the step was last queued with ({source, plots}): the card opens on it. */
  queued?: Record<string, unknown>
}) {
  const last = queuedChoice(queued)
  const [choice, setChoice] = useState<"all" | "missing" | "list">(
    last.plots.mode,
  )
  const [listText, setListText] = useState(
    last.plots.mode === "list" ? last.plots.text : "",
  )
  const plotChoice: PlotChoice =
    choice === "list" ? { mode: "list", text: listText } : { mode: choice }
  const choiceReady = choice !== "list" || listText.trim().length > 0
  const [source, setSource] = useState<"ortho" | "frames">(
    last.source ??
      (hasFrames && plotImageFiles.length === 0 ? "frames" : "ortho"),
  )
  const src: "ortho" | "frames" = offerFrames ? source : "ortho"

  // Which plots, in one row: the explanations are in the hovers.
  const plotsPicker = (
    <span
      className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs"
      data-testid="plot-images-which"
    >
      <span className="font-medium">Plots</span>
      {(
        [
          ["all", "All", "Every plot of the active boundaries"],
          [
            "missing",
            "Without images",
            "Only the plots that have no images yet; added to the earlier ones",
          ],
          [
            "list",
            "These:",
            "Some plots only (e.g. one just added to the boundaries); added to the earlier images",
          ],
        ] as const
      ).map(([key, label, hint]) => (
        <label key={key} className="flex items-center gap-1" title={hint}>
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
        className="h-7 w-36 text-xs"
        placeholder="12, 15-18, 106"
        value={listText}
        onFocus={() => setChoice("list")}
        onChange={(e) => setListText(e.target.value)}
        aria-label="Plots to make images of"
        title="Plot numbers or ranges; added to the earlier images"
        data-testid="plot-images-list"
      />
    </span>
  )

  const framesHint =
    "For each plot, the flight frames that show it best (whole plot in frame, then the most top-down), placed with the camera positions of the orthomosaic the boundaries were drawn on. For flights whose orthomosaic smears in wind: a Quick orthomosaic is enough. You get crops, the best frame straightened top-down, and the full frames, named by plot and accession; the flight's other cameras (thermal) are matched by capture time and cut the same way."

  const runButton =
    src === "ortho" ? (
      onRunOrtho && (
        <Button
          size="sm"
          variant="outline"
          className="h-7"
          disabled={running || !choiceReady}
          onClick={() => onRunOrtho(plotChoice)}
          data-testid="plot-ortho-run"
        >
          {running && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          {choice === "all"
            ? plotImageFiles.length
              ? "Cut the plot images again"
              : "Cut the plot images"
            : "Cut these plots' images"}
        </Button>
      )
    ) : (
      <Button
        size="sm"
        className="h-7"
        disabled={running || !hasCameraPositions || !choiceReady}
        title={framesHint}
        onClick={() => onRunFrames(plotChoice)}
        data-testid="plot-frames-run"
      >
        {running && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        {!hasFrames
          ? "Pick each plot's frames"
          : choice === "all"
            ? "Pick the frames again"
            : "Pick these plots' frames"}
      </Button>
    )

  return (
    <div className="space-y-2" data-testid="plot-images-step">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {offerFrames && (
          <div className="inline-flex rounded-md border bg-muted p-0.5 text-xs">
            {(
              [
                [
                  "ortho",
                  "Orthomosaic",
                  MapIcon,
                  "Cut the orthomosaic by the plot boundaries",
                ],
                ["frames", "Raw frames", Images, framesHint],
              ] as const
            ).map(([key, label, Icon, hint]) => (
              <button
                key={key}
                type="button"
                title={hint}
                onClick={() => setSource(key)}
                data-testid={`plot-source-${key}`}
                className={`flex items-center gap-1.5 rounded px-2.5 py-0.5 ${source === key ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
        )}
        {(src === "frames" || onRunOrtho) && plotsPicker}
        {runButton}
      </div>
      {src === "frames" && !hasCameraPositions && (
        <p className="text-xs text-amber-600">
          This orthomosaic's ODM run did not keep its camera positions. Build it
          again (the Quick preset is enough) and place the boundaries on it.
        </p>
      )}
      {src === "ortho" ? (
        <PlotImageGrid
          files={plotImageFiles}
          prefix={prefix}
          emptyText="No plot images yet: “Cut the plot images” above makes them."
        />
      ) : (
        hasFrames && <PlotFramesPanel prefix={framesPrefix} />
      )}
    </div>
  )
}
