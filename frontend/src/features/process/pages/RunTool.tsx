/**
 * RunTool — full-page interactive tool view.
 *
 * Opened when the user clicks "Open Tool" on an interactive step in RunDetail.
 * Renders the tool at full width with a back button; "Save" navigates back.
 */

import { ArrowLeft } from "lucide-react"
import { useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { useQueryClient } from "@tanstack/react-query"
import { useRef, useEffect } from "react"
import { useProcess } from "@/contexts/ProcessContext"
import { subscribe } from "@/lib/sseManager"

import { PipelinesService, type PipelineRunPublic, type PipelinePublic } from "@/client"
import { Button } from "@/components/ui/button"
import { GcpPicker } from "@/features/process/components/GcpPicker"
import { PlotBoundaryPrep } from "@/features/process/components/PlotBoundaryPrep"
import { PlotMarker } from "@/features/process/components/PlotMarker"
import {
  InferenceTool,
  type InferenceRunConfig,
  type StitchVersionOption,
  type AssociationVersionOption,
  type TraitVersionOption,
} from "@/features/process/components/InferenceTool"
import { analyzeApi, type TraitRecord } from "@/features/analyze/api"
import { ProcessingService } from "@/client"
import { useMutation } from "@tanstack/react-query"
import useCustomToast from "@/hooks/useCustomToast"

const STEP_LABELS: Record<string, string> = {
  plot_marking: "Plot Marking",
  gcp_selection: "GCP Selection",
  plot_boundary_prep: "Plot Boundary Prep",
  inference: "Inference",
}

const STEP_DESCRIPTIONS: Record<string, string> = {
  plot_marking: "Navigate through raw images and mark the start and end frame for each plot row.",
  gcp_selection: "Select each ground control point in a drone image and mark its pixel location.",
  plot_boundary_prep: "Draw the outer field boundary and configure plot grid dimensions. The grid is auto-generated from the field design CSV.",
  inference: "Run Roboflow detection or segmentation on plot images and view results.",
}

const apiUrl = (path: string) => {
  const base = (window as any).__GEMI_BACKEND_URL__ ?? ""
  return base ? `${base}${path}` : path
}

export function RunTool() {
  const navigate = useNavigate()
  const { workspaceId } = useParams({
    from: "/_layout/process/$workspaceId/tool",
  })
  const { runId, step } = useSearch({
    from: "/_layout/process/$workspaceId/tool",
  })
  const queryClient = useQueryClient()
  const { showErrorToast } = useCustomToast()
  const { addProcess, updateProcess, processes } = useProcess()
  const autoRegisteredRef = useRef<string | null>(null)
  const stopFnRef = useRef<(() => void) | null>(null)

  const { data: run } = useQuery<PipelineRunPublic>({
    queryKey: ["pipeline-runs", runId],
    queryFn: () => PipelinesService.readRun({ id: runId }),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })

  const { data: pipeline } = useQuery<PipelinePublic>({
    queryKey: ["pipelines", run?.pipeline_id],
    queryFn: () => PipelinesService.readOne({ id: run!.pipeline_id }),
    enabled: !!run?.pipeline_id,
    staleTime: Infinity,
  })

  const isGround = pipeline?.type === "ground"
  const isAerial = pipeline?.type === "aerial"

  // Ground-only: fetch stitch versions and association versions for inference version selection
  const { data: stitchVersions } = useQuery<StitchVersionOption[]>({
    queryKey: ["stitch-versions", runId],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/stitchings`))
      if (!res.ok) return []
      return res.json()
    },
    enabled: isGround && step === "inference",
    staleTime: 30_000,
  })

  const { data: associationVersions } = useQuery<AssociationVersionOption[]>({
    queryKey: ["associations", runId],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/associations`))
      if (!res.ok) return []
      return res.json()
    },
    enabled: isGround && step === "inference",
    staleTime: 30_000,
  })

  // Aerial-only: fetch trait records for inference version selection
  const { data: traitRecords } = useQuery<TraitRecord[]>({
    queryKey: ["trait-records-run", runId],
    queryFn: () => analyzeApi.listTraitRecordsByRun(runId),
    enabled: isAerial && step === "inference",
    staleTime: 30_000,
  })

  // Map TraitRecord → TraitVersionOption
  const traitVersions: TraitVersionOption[] | undefined = isAerial && traitRecords
    ? traitRecords.map((r) => ({
        version: r.version,
        ortho_version: r.ortho_version ?? null,
        ortho_name: r.ortho_name ?? null,
        boundary_version: r.boundary_version ?? null,
        boundary_name: r.boundary_name ?? null,
        plot_count: r.plot_count ?? 0,
      }))
    : undefined

  const pipelineConfig = (pipeline?.config ?? {}) as Record<string, any>
  const pipelineRoboflowModels: import("@/features/process/components/InferenceTool").ModelConfig[] | undefined =
    pipelineConfig.roboflow_models ?? undefined
  const pipelineInferenceMode: string | undefined = pipelineConfig.inference_mode ?? undefined
  const pipelineLocalServerUrl: string | undefined = pipelineConfig.local_server_url ?? undefined

  const executeMutation = useMutation({
    mutationFn: (body: {
      step: string
      models?: { label: string; roboflow_api_key: string; roboflow_model_id: string; task_type: string }[]
      stitch_version?: number
      association_version?: number
      trait_version?: number
      inference_mode?: string
      local_server_url?: string
    }) =>
      ProcessingService.executeStep({ id: runId, requestBody: body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pipeline-runs", runId] }),
    onError: () => showErrorToast("Failed to start step"),
  })

  const stopMutation = useMutation({
    mutationFn: () => ProcessingService.stopStep({ id: runId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pipeline-runs", runId] }),
    onError: () => showErrorToast("Failed to stop step"),
  })

  function goBack() {
    navigate({
      to: "/process/$workspaceId/run/$runId",
      params: { workspaceId, runId: runId as string },
    })
  }

  function onSaved() {
    queryClient.invalidateQueries({ queryKey: ["pipeline-runs", runId] })
    queryClient.invalidateQueries({ queryKey: ["plot-boundaries", runId] })
    goBack()
  }

  const label = STEP_LABELS[step] ?? step
  const description = STEP_DESCRIPTIONS[step] ?? ""
  const isRunning = run?.status === "running" && run.current_step === step

  // Keep stopFnRef current so the cancel callback never goes stale
  useEffect(() => {
    stopFnRef.current = () => stopMutation.mutate()
  })

  // Reset guard when run stops so a re-run can re-register
  useEffect(() => {
    if (!isRunning) autoRegisteredRef.current = null
  }, [isRunning])

  // Register / update the process panel entry while inference is running from this tool
  useEffect(() => {
    if (!isRunning || !run || !pipeline) return
    if (autoRegisteredRef.current === runId) return
    autoRegisteredRef.current = runId
    const toolLink = `/process/${workspaceId}/tool?runId=${runId}&step=${step}`
    const cancel = () => stopFnRef.current?.()
    const existing = processes.find(
      (p) => p.runId === runId && (p.status === "running" || p.status === "pending"),
    )
    if (existing) {
      updateProcess(existing.id, { link: toolLink, cancel })
    } else {
      addProcess({
        type: "processing",
        title: `${run.current_step ?? "Processing"} (${pipeline.name} · ${run.date})`,
        status: "running",
        items: [],
        runId,
        link: toolLink,
        cancel,
      })
    }
  }, [isRunning, run, pipeline, runId, step, workspaceId, processes, addProcess, updateProcess])

  // When a step finishes (complete/cancelled/error), refresh the run so
  // isRunning updates and InferenceTool's EventSource closes cleanly.
  useEffect(() => {
    if (!isRunning) return
    const unsub = subscribe(runId, (evt) => {
      if (evt.event === "complete" || evt.event === "cancelled" || evt.event === "error") {
        queryClient.invalidateQueries({ queryKey: ["pipeline-runs", runId] })
      }
    })
    return unsub
  }, [isRunning, runId, queryClient])

  // Plot marking needs extra width for the 3-column GPS layout
  const maxWidth = step === "plot_marking" ? "max-w-7xl" : "max-w-5xl"

  return (
    <div className="bg-background min-h-screen">
      <div className={`mx-auto ${maxWidth} p-8`}>
        {/* Header */}
        <div className="mb-6 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={goBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold">{label}</h1>
            {description && (
              <p className="text-muted-foreground text-sm mt-0.5">{description}</p>
            )}
          </div>
        </div>

        {/* Tool content */}
        {step === "plot_marking" && (
          <PlotMarker
            runId={runId}
            onSaved={onSaved}
            onCancel={goBack}
          />
        )}

        {step === "gcp_selection" && (
          <GcpPicker
            runId={runId}
            onSaved={onSaved}
            onCancel={goBack}
          />
        )}

        {step === "plot_boundary_prep" && (
          <PlotBoundaryPrep
            runId={runId}
            pipelineType={pipeline?.type as "aerial" | "ground" | undefined}
            onSaved={onSaved}
            onCancel={goBack}
          />
        )}

        {step === "inference" && (
          <InferenceTool
            runId={runId}
            inferenceComplete={!!run?.steps_completed?.inference}
            isRunning={isRunning}
            isStopping={stopMutation.isPending}
            onRunInference={(cfg: InferenceRunConfig) => {
              executeMutation.mutate({
                step: "inference",
                models: cfg.models,
                stitch_version: cfg.stitch_version,
                association_version: cfg.association_version,
                trait_version: cfg.trait_version,
                inference_mode: cfg.inference_mode,
                local_server_url: cfg.local_server_url,
              } as any)
            }}
            onStop={() => stopMutation.mutate()}
            onCancel={goBack}
            initialModels={pipelineRoboflowModels}
            inferenceMode={pipelineInferenceMode}
            localServerUrl={pipelineLocalServerUrl}
            stitchVersions={isGround ? (stitchVersions ?? []) : undefined}
            associationVersions={isGround ? (associationVersions ?? []) : undefined}
            traitVersions={isAerial ? (traitVersions ?? []) : undefined}
          />
        )}
      </div>
    </div>
  )
}
