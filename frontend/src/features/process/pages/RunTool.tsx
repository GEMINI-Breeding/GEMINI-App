/**
 * RunTool — full-page interactive tool wrapper.
 *
 * Dispatches on `?step=` to the matching interactive component. R5a wires
 * plot_boundary_prep; gcp_selection (R5b), inference (R5c), and
 * plot_marking (R6) are still placeholders until their phases land.
 */
import { useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { ArrowLeft } from "lucide-react"
import { useMemo } from "react"

import { Button } from "@/components/ui/button"
import { EdgeCropTool } from "@/features/process/components/EdgeCropTool"
import { GcpPicker } from "@/features/process/components/GcpPicker"
import { ImageReviewer } from "@/features/process/components/ImageReviewer"
import { InferenceTool } from "@/features/process/components/InferenceTool"
import { PlotBoundaryPrep } from "@/features/process/components/PlotBoundaryPrep"
import { PlotMarker } from "@/features/process/components/PlotMarker"
import {
  type AerialScope,
  isAerialScopeComplete,
} from "@/features/process/lib/paths"
import {
  usePipeline,
  useRun,
  useWorkspace,
} from "@/features/process/lib/runStore"

const STEP_LABELS: Record<string, string> = {
  plot_marking: "Plot Marking",
  gcp_selection: "GCP Selection",
  image_review: "Image Exclusion",
  plot_boundary_prep: "Plot Boundary Prep",
  edge_crop: "Edge Crop",
  inference: "Inference",
}

const STEP_DESCRIPTIONS: Record<string, string> = {
  plot_marking:
    "Navigate through raw images and mark the start and end frame for each plot row.",
  gcp_selection:
    "Select each ground control point in a drone image and mark its pixel location.",
  image_review:
    "Open a satellite map of the raw images and exclude any you don't want fed to ODM.",
  plot_boundary_prep:
    "Draw the outer field boundary, configure plot grid dimensions, and save as a versioned plot-boundary record.",
  edge_crop:
    "Configure the per-side pixel margin AgRowStitch trims from each input image before matching features.",
  inference:
    "Run Roboflow detection or segmentation on plot images and view results.",
}

const STEP_PHASE: Record<string, string> = {}

function ToolPlaceholder({ step, runId }: { step: string; runId: string }) {
  const phase = STEP_PHASE[step] ?? "a later phase"
  return (
    <div className="border rounded-md bg-muted/30 p-6 flex flex-col items-center gap-3">
      <p className="font-medium text-sm">{STEP_LABELS[step] ?? step}</p>
      <p className="text-muted-foreground text-xs max-w-md text-center">
        This interactive tool is being restored in {phase}. Run id: {runId}
      </p>
    </div>
  )
}

export function RunTool() {
  const navigate = useNavigate()
  const { workspaceId } = useParams({
    from: "/_layout/process/$workspaceId/tool",
  })
  const { runId, step } = useSearch({
    from: "/_layout/process/$workspaceId/tool",
  })
  const run = useRun(runId)
  const workspace = useWorkspace(workspaceId)
  const pipeline = usePipeline(run?.pipelineId)

  // The run's scope is locked to the uploaded dataset picked at
  // run-creation time (see NewRunDialog + RunUploadScope). All path
  // listings the interactive tools drive read from this snapshot —
  // no global useProcessScope plumbing.
  const scope: AerialScope | null = useMemo(() => {
    const u = run?.uploadScope
    if (!u) return null
    const built: AerialScope = {
      year: u.year,
      experiment: u.experiment,
      location: u.location,
      population: u.population,
      date: u.date,
      platform: u.platform,
      sensor: u.sensor,
    }
    return isAerialScopeComplete(built) ? built : null
  }, [run?.uploadScope])

  function goBack() {
    navigate({
      to: "/process/$workspaceId/run/$runId",
      params: { workspaceId, runId },
    })
  }

  const label = STEP_LABELS[step] ?? step
  const description = STEP_DESCRIPTIONS[step] ?? ""

  return (
    <div className="bg-background">
      <div className="mx-auto max-w-[1600px] px-6 py-6">
        <div className="mb-6 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back to run"
            onClick={goBack}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold">{label}</h1>
            {description && (
              <p className="text-muted-foreground text-sm mt-0.5">
                {description}
              </p>
            )}
          </div>
        </div>

        {!run ? (
          <div className="border rounded-md bg-muted/30 p-6 flex flex-col items-center gap-3">
            <p className="text-muted-foreground text-sm">
              Run not found. It may have been deleted on this browser.
            </p>
          </div>
        ) : !scope ? (
          <div className="border rounded-md bg-muted/30 p-6 flex flex-col items-center gap-3">
            <p className="text-muted-foreground text-sm">
              The run is missing a flight date / platform / sensor. Pick those
              in the Run Setup card on the run page first.
            </p>
            <Button variant="outline" onClick={goBack}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to run
            </Button>
          </div>
        ) : step === "plot_boundary_prep" ? (
          <PlotBoundaryPrep
            run={run}
            scope={scope}
            onSaved={goBack}
            onCancel={goBack}
          />
        ) : step === "gcp_selection" && workspace ? (
          <GcpPicker
            workspace={workspace}
            run={run}
            scope={scope}
            onSaved={goBack}
            onCancel={goBack}
          />
        ) : step === "image_review" ? (
          <ImageReviewer
            run={run}
            scope={scope}
            onSaved={goBack}
            onCancel={goBack}
          />
        ) : step === "inference" && workspace && pipeline ? (
          <InferenceTool
            pipeline={pipeline}
            run={run}
            scope={scope}
            onSaved={goBack}
            onCancel={goBack}
          />
        ) : step === "edge_crop" ? (
          <EdgeCropTool
            run={run}
            scope={scope}
            onSaved={goBack}
            onCancel={goBack}
          />
        ) : step === "plot_marking" ? (
          <PlotMarker onCancel={goBack} />
        ) : (
          <ToolPlaceholder step={step} runId={runId} />
        )}
      </div>
    </div>
  )
}
