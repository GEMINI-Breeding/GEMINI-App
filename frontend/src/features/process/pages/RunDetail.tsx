/**
 * RunDetail — wizard run page (R4a slice).
 *
 * Restored from main's 5,356-LOC version, but only the outer shell + the
 * data_sync, gcp_selection, and orthomosaic step rows are wired this
 * phase. Other steps render with their visual treatment intact and an
 * inline "wired in R4b/R4c/R5/R6" note inside the expansion area.
 *
 * Backend wiring goes through:
 *   - runStore  — Workspace/Pipeline/Run/Step state in localStorage
 *   - runApi    — step-execution facade (executeStep, stopStep,
 *                 markStepComplete, markStepSkipped)
 *   - runEvents — wsManager → legacy ProgressEvent shape adapter
 *   - useProcess — bottom ProcessPanel registration
 */
import { useNavigate, useParams } from "@tanstack/react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  ImageIcon,
  Loader2,
  Lock,
  Minus,
  RefreshCw,
  Square,
  TriangleAlert,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  FilesService,
  JobsService,
  type FileMetadata,
  type JobOutput,
} from "@/client"
import { Badge } from "@/components/ui/badge"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useProcess } from "@/contexts/ProcessContext"
import {
  AerialScopePicker,
  buildAerialScope,
  useAerialScopeContext,
  type AerialScopeFields,
} from "@/features/process/components/AerialScopePicker"
import { ImportOrthoDialog } from "@/features/process/components/ImportOrthoDialog"
import { OrthoVersionsPanel } from "@/features/process/components/OrthoVersionsPanel"
import {
  TraitExtractionDialog,
  type TraitDialogState,
} from "@/features/process/components/TraitExtractionDialog"
import { TraitRecordsPanel } from "@/features/process/components/TraitRecordsPanel"
import { usePlotGeometryVersions } from "@/features/process/hooks/usePlotGeometry"
import { buildOrthoVersions } from "@/features/process/lib/orthoVersions"
import { useProcessScope } from "@/features/process/lib/processScope"
import {
  isAerialScopeComplete,
  processedPrefix,
  rawImagesPrefix,
  type AerialScope,
} from "@/features/process/lib/paths"
import {
  executeStep,
  markStepSkipped,
  stopStep,
  type OrthomosaicParams,
} from "@/features/process/lib/runApi"
import {
  closeJobConnection,
  subscribeJobAsRunEvent,
  type RunProgressEvent,
} from "@/features/process/lib/runEvents"
import {
  setStepState,
  updateRun,
  usePipeline,
  useRun,
  useWorkspace,
} from "@/features/process/lib/runStore"
import useCustomToast from "@/hooks/useCustomToast"
import { isLoggedIn } from "@/lib/auth"

// ── Step definitions (mirror main's GROUND_STEPS / AERIAL_STEPS) ────────────

type StepKind = "interactive" | "compute" | "optional"

/** Phases whose step rows are functional (not pending-restoration stubs). */
const LIVE_PHASES = new Set([
  "R4a",
  "R4b",
  "R4c",
  "R5a",
  "R5b",
  "R5c",
  "R6",
])
function isLive(phase?: string): boolean {
  return !phase || LIVE_PHASES.has(phase)
}

interface StepDef {
  key: string
  label: string
  description: string
  kind: StepKind
  /** Phase that fully wires this step. */
  wiredIn?: "R4a" | "R4b" | "R4c" | "R5a" | "R5b" | "R5c" | "R6"
}

const GROUND_STEPS: StepDef[] = [
  {
    key: "data_sync",
    label: "Data Sync",
    description:
      "Extract GPS from image EXIF for accurate positioning. No platform log required — skipped automatically if not present.",
    kind: "compute",
    wiredIn: "R4a",
  },
  {
    key: "plot_marking",
    label: "Plot Marking",
    description:
      "Navigate through raw images and mark the start and end frame for each plot row",
    kind: "interactive",
    wiredIn: "R6",
  },
  {
    key: "stitching",
    label: "Stitching",
    description:
      "AgRowStitch stitches images per plot into panoramic mosaics, then automatically georeferences and creates a combined mosaic",
    kind: "compute",
    wiredIn: "R6",
  },
  {
    key: "plot_boundary_prep",
    label: "Plot Boundary Prep",
    description:
      "Draw the outer field boundary, configure plot grid dimensions, and auto-generate plot polygons from field design",
    kind: "interactive",
    wiredIn: "R5a",
  },
  {
    key: "associate_boundaries",
    label: "Associate Boundaries",
    description:
      "Match each stitched plot to its boundary polygon using GPS containment",
    kind: "compute",
    wiredIn: "R6",
  },
  {
    key: "inference",
    label: "Inference",
    description: "Roboflow detection/segmentation on plot images",
    kind: "interactive",
    wiredIn: "R5c",
  },
]

const AERIAL_STEPS: StepDef[] = [
  {
    key: "data_sync",
    label: "Data Sync",
    description:
      "Confirm raw drone images are present at the run's MinIO scope. EXIF-based GPS sync runs as part of orthomosaic generation.",
    kind: "compute",
    wiredIn: "R4a",
  },
  {
    key: "gcp_selection",
    label: "GCP Selection",
    description:
      "Match drone images to ground control points, mark GCP pixels. Optional (highly recommended for a successful orthomosaic)",
    kind: "optional",
    wiredIn: "R5b",
  },
  {
    key: "orthomosaic",
    label: "Orthomosaic Generation",
    description: "Run OpenDroneMap to create orthomosaic and DEM",
    kind: "compute",
    wiredIn: "R4a",
  },
  {
    key: "plot_boundary_prep",
    label: "Plot Boundary Prep",
    description:
      "Draw the outer field boundary, configure plot grid dimensions, and auto-generate plot polygons from field design",
    kind: "interactive",
    wiredIn: "R5a",
  },
  {
    key: "trait_extraction",
    label: "Initial Trait Extraction",
    description:
      "Extract vegetation fraction (and canopy height when a DEM is present) per plot",
    kind: "compute",
    wiredIn: "R4c",
  },
  {
    key: "inference",
    label: "Inference",
    description: "Roboflow detection/segmentation on plot images",
    kind: "interactive",
    wiredIn: "R5c",
  },
]

// ── Step status helpers ─────────────────────────────────────────────────────

type StepStatus = "completed" | "running" | "failed" | "ready" | "locked" | "skipped"

function getStepStatus(
  stepKey: string,
  stepsState: Record<string, { status: string }>,
  steps: StepDef[],
): StepStatus {
  const state = stepsState[stepKey]
  if (state) {
    if (state.status === "completed") return "completed"
    if (state.status === "running") return "running"
    if (state.status === "failed") return "failed"
    if (state.status === "skipped") return "skipped"
  }
  // Not yet attempted: ready iff all preceding non-optional steps are done.
  const idx = steps.findIndex((s) => s.key === stepKey)
  const ready = steps
    .slice(0, idx)
    .filter((s) => s.kind !== "optional")
    .every((s) => {
      const ss = stepsState[s.key]?.status
      return ss === "completed" || ss === "skipped"
    })
  return ready ? "ready" : "locked"
}

function getNextStep(
  steps: StepDef[],
  stepsState: Record<string, { status: string }>,
): string | null {
  for (const step of steps) {
    const ss = stepsState[step.key]?.status
    if (ss === "completed" || ss === "skipped") continue
    if (step.kind !== "optional") return step.key
  }
  return null
}

// ── Progress event buffer (per runId, persists across remounts) ─────────────

const eventBuffer = new Map<string, RunProgressEvent[]>()
const progressBuffer = new Map<string, number | null>()

function ProgressLog({ events }: { events: RunProgressEvent[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" })
  }, [events])

  if (events.length === 0) return null

  return (
    <div
      ref={ref}
      data-testid="progress-log"
      className="bg-muted/40 mt-2 max-h-40 space-y-0.5 overflow-y-auto rounded border p-2 font-mono text-[11px]"
    >
      {events.map((e, i) => {
        const ts = new Date(e.timestamp).toLocaleTimeString()
        const tone =
          e.event === "error"
            ? "text-red-600"
            : e.event === "complete"
              ? "text-green-600"
              : e.event === "cancelled"
                ? "text-amber-600"
                : "text-muted-foreground"
        return (
          <div
            key={i}
            data-testid="progress-log-entry"
            data-event={e.event}
            data-timestamp={e.timestamp}
            className={tone}
          >
            <span className="opacity-60">{ts} </span>
            <span className="font-medium">{e.event}</span>
            {typeof e.progress === "number" && ` (${Math.round(e.progress)}%)`}
            {e.message && ` — ${e.message}`}
          </div>
        )
      })}
    </div>
  )
}

// ── StepRow ─────────────────────────────────────────────────────────────────

interface StepRowProps {
  step: StepDef
  status: StepStatus
  isNext: boolean
  isLast: boolean
  events: RunProgressEvent[]
  lastProgress: number | null
  isExecuting: boolean
  onRunStep: () => void
  onOpenTool: () => void
  onStopStep: () => void
  onSkipStep?: () => void
  warning?: string
  extraContent?: React.ReactNode
}

function StepRow(props: StepRowProps) {
  const {
    step,
    status,
    isNext,
    isLast,
    events,
    lastProgress,
    isExecuting,
    onRunStep,
    onOpenTool,
    onStopStep,
    onSkipStep,
    warning,
    extraContent,
  } = props
  const [expanded, setExpanded] = useState(false)

  const stepEvents = events.filter((e) => !e.step || e.step === step.key)

  const iconEl = (() => {
    switch (status) {
      case "completed":
        return <Check className="h-5 w-5 text-green-600" />
      case "running":
        return <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
      case "failed":
        return <AlertCircle className="h-5 w-5 text-red-600" />
      case "ready":
        return <Clock className="text-primary h-5 w-5" />
      case "skipped":
        return <Minus className="text-muted-foreground h-5 w-5" />
      default:
        return <Lock className="text-muted-foreground h-5 w-5" />
    }
  })()

  const circleCls: Record<StepStatus, string> = {
    completed: "border-green-500 bg-green-500/10",
    running: "border-blue-500 bg-blue-500/10",
    failed: "border-red-500 bg-red-500/10",
    ready: "border-primary bg-primary/10",
    locked: "border-border bg-muted/30",
    skipped: "border-border bg-muted/30",
  }

  const isActive = status === "running"
  const isInteractive = step.kind === "interactive" || step.kind === "optional"
  const canRun =
    (status === "ready" || status === "completed" || status === "failed") &&
    !isExecuting

  const actionLabel = (() => {
    if (isActive) return "Running…"
    if (status === "completed") return isInteractive ? "Re-open Tool" : "Re-run"
    if (status === "skipped") return isInteractive ? "Open Tool" : "Run Step"
    if (isInteractive) return "Open Tool"
    return "Run Step"
  })()

  return (
    <div
      className="relative"
      data-testid={`step-row-${step.key}`}
      data-status={status}
    >
      {!isLast && (
        <div className="bg-border absolute top-[52px] bottom-0 left-[23px] w-0.5" />
      )}
      <div className="flex gap-4">
        <div
          className={`relative z-10 flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border-2 ${circleCls[status]}`}
        >
          {iconEl}
        </div>

        <div className="min-w-0 flex-1 pb-6">
          <div className="flex items-start justify-between gap-2 pt-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`font-medium ${
                  status === "locked" || status === "skipped"
                    ? "text-muted-foreground"
                    : ""
                }`}
              >
                {step.label}
              </span>
              {status === "skipped" && (
                <Badge variant="outline" className="text-muted-foreground text-xs">
                  skipped
                </Badge>
              )}
              {status !== "skipped" && step.kind === "optional" && (
                <Badge variant="outline" className="text-muted-foreground text-xs">
                  optional
                </Badge>
              )}
              {status !== "skipped" && step.kind === "interactive" && (
                <Badge variant="outline" className="text-xs">
                  interactive
                </Badge>
              )}
              {step.wiredIn && !isLive(step.wiredIn) && (
                <Badge variant="outline" className="text-amber-700 border-amber-400 text-xs">
                  {step.wiredIn}
                </Badge>
              )}
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              {isActive && (
                <Button variant="outline" size="sm" onClick={onStopStep}>
                  <Square className="mr-1 h-3 w-3" />
                  Stop
                </Button>
              )}
              {step.kind === "optional" &&
                status !== "completed" &&
                status !== "skipped" &&
                onSkipStep && (
                  <Button variant="outline" size="sm" onClick={onSkipStep}>
                    Skip
                  </Button>
                )}
              <Button
                variant={status === "completed" ? "outline" : "default"}
                size="sm"
                disabled={
                  status === "locked" || isActive || (isExecuting && !isActive)
                }
                title={warning}
                onClick={() => {
                  if (isInteractive) onOpenTool()
                  else if (canRun) onRunStep()
                }}
              >
                {isActive && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                {warning && !isActive && (
                  <TriangleAlert className="mr-1 h-3.5 w-3.5 text-amber-500" />
                )}
                {actionLabel}
              </Button>
              {status === "completed" && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={expanded ? "Collapse details" : "Expand details"}
                  onClick={() => setExpanded(!expanded)}
                >
                  {expanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </Button>
              )}
            </div>
          </div>

          <p
            className={`mt-0.5 text-sm ${
              status === "locked"
                ? "text-muted-foreground/60"
                : "text-muted-foreground"
            }`}
          >
            {step.description}
          </p>

          {isNext && status !== "completed" && !isActive && (
            <p className="text-primary mt-1 text-xs">Ready to start</p>
          )}

          {(isActive || status === "failed") && (
            <div className="mt-2 overflow-hidden">
              {isActive && lastProgress !== null && (
                <div className="bg-secondary mb-1 h-1.5 w-full overflow-hidden rounded-full">
                  <div
                    className="bg-primary h-full rounded-full transition-[width] duration-300"
                    style={{ width: `${lastProgress}%` }}
                  />
                </div>
              )}
              <ProgressLog events={stepEvents} />
            </div>
          )}

          {expanded && status === "completed" && stepEvents.length > 0 && (
            <ProgressLog events={stepEvents} />
          )}

          {extraContent && <div className="mt-2">{extraContent}</div>}
        </div>
      </div>
    </div>
  )
}

// ── Run setup card (pick date/platform/sensor) ──────────────────────────────

function RunSetupCard({
  fields,
  onChange,
}: {
  fields: AerialScopeFields
  onChange: (next: AerialScopeFields) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Run setup</CardTitle>
        <CardDescription>
          Pick the flight date, platform, and sensor for this run. The orthomosaic
          step uses these to locate raw images on MinIO.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AerialScopePicker value={fields} onChange={onChange} />
      </CardContent>
    </Card>
  )
}

// ── Orthomosaic options card (shown next to the orthomosaic step) ───────────

const RECONSTRUCTION_QUALITY = [
  "Default",
  "Lowest",
  "Low",
  "Medium",
  "High",
  "Ultra",
  "Custom",
] as const

const QUALITY_HINTS: Record<(typeof RECONSTRUCTION_QUALITY)[number], string> = {
  Default: "Worker defaults (full-quality reconstruction).",
  Lowest:
    "Memory-friendly: feature/pc/depthmap all 'lowest', max 4 cores. Designed to fit in a 7-8 GiB Docker engine.",
  Low: "feature/pc-quality 'low', depthmap 512px. Faster + lower RAM than Default.",
  Medium:
    "feature/pc-quality 'medium', depthmap 640px. Balanced; the safest first try on large flights.",
  High: "feature/pc-quality 'high'. Higher detail, ~2x more RAM than Default.",
  Ultra:
    "feature/pc-quality 'ultra', depthmap 1280px. Highest detail; needs 16-32 GiB+ RAM headroom.",
  Custom: "Use the textbox below to pass raw NodeODM CLI flags.",
}

function OrthomosaicOptions({
  params,
  onChange,
  onOpenImport,
  hasUploadedOrthos,
}: {
  params: OrthomosaicParams
  onChange: (next: OrthomosaicParams) => void
  onOpenImport: () => void
  hasUploadedOrthos: boolean
}) {
  const quality =
    (params.reconstruction_quality as (typeof RECONSTRUCTION_QUALITY)[number]) ??
    "Default"
  return (
    <div className="space-y-3 rounded-md border bg-card p-3">
      {hasUploadedOrthos && (
        <div className="flex items-center justify-between rounded border border-blue-200 bg-blue-500/5 p-2 text-xs">
          <span className="text-muted-foreground">
            Existing orthomosaic uploads detected at this scope. You can skip
            ODM and import one instead.
          </span>
          <Button size="sm" variant="outline" onClick={onOpenImport}>
            Import existing
          </Button>
        </div>
      )}
      <div>
        <Label htmlFor="ortho-quality" className="mb-1.5 text-xs">
          Reconstruction quality
        </Label>
        <Select
          value={quality}
          onValueChange={(v) =>
            onChange({ ...params, reconstruction_quality: v })
          }
        >
          <SelectTrigger id="ortho-quality" data-testid="ortho-quality">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RECONSTRUCTION_QUALITY.map((q) => (
              <SelectItem key={q} value={q}>
                {q}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p
          className="text-muted-foreground mt-1 text-xs"
          data-testid="ortho-quality-hint"
        >
          {QUALITY_HINTS[quality]}
        </p>
      </div>
      {quality === "Custom" && (
        <div>
          <Label htmlFor="ortho-custom" className="mb-1.5 text-xs">
            Custom NodeODM options
          </Label>
          <Input
            id="ortho-custom"
            data-testid="ortho-custom-options"
            placeholder='e.g. "--fast-orthophoto --skip-3dmodel"'
            value={params.custom_options ?? ""}
            onChange={(e) =>
              onChange({ ...params, custom_options: e.target.value })
            }
          />
          <p className="text-muted-foreground mt-1 text-xs">
            Forwarded as-is to NodeODM. Drop a <code>gcp_list.txt</code> alongside
            your raw images for ground-control points.
          </p>
        </div>
      )}
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

const DEFAULT_BUCKET = "gemini"

export function RunDetail() {
  const navigate = useNavigate()
  const { workspaceId, runId } = useParams({
    from: "/_layout/process/$workspaceId/run/$runId",
  })
  const run = useRun(runId)
  const workspace = useWorkspace(workspaceId)
  const pipeline = usePipeline(run?.pipelineId)
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const { addProcess, updateProcess, processes } = useProcess()
  const ctx = useAerialScopeContext()
  const queryClient = useQueryClient()
  const { experimentId: scopedExperimentId, setExperimentId: setScopedExperimentId } =
    useProcessScope()

  // The workspace owns the experiment; push that into the shared
  // useProcessScope store so AerialScopePicker (and the path-listing
  // queries it drives) target the right experiment instead of inheriting
  // whatever scope the user last picked on another Process page.
  useEffect(() => {
    if (!workspace) return
    if (scopedExperimentId !== workspace.experimentId) {
      setScopedExperimentId(workspace.experimentId)
    }
  }, [workspace, scopedExperimentId, setScopedExperimentId])

  // Local state for the aerial-fields setup if the Run doesn't have them yet.
  const [aerialFields, setAerialFields] = useState<AerialScopeFields>(
    () =>
      run?.aerialFields ?? {
        date: "",
        platform: "",
        sensor: "",
      },
  )
  // Persist scope picks back to the Run record so they survive reload.
  useEffect(() => {
    if (!run) return
    if (
      run.aerialFields?.date !== aerialFields.date ||
      run.aerialFields?.platform !== aerialFields.platform ||
      run.aerialFields?.sensor !== aerialFields.sensor
    ) {
      updateRun(runId, { aerialFields })
    }
  }, [aerialFields, run, runId])

  // Per-step ortho options. Seeded from the pipeline's default once the
  // pipeline record loads (it's a hook, so it can be undefined on first
  // render). The user can still override per-run on this page.
  const [orthoParams, setOrthoParams] = useState<OrthomosaicParams>({
    reconstruction_quality: "Default",
  })
  const orthoSeededRef = useRef(false)
  useEffect(() => {
    if (orthoSeededRef.current || !pipeline) return
    orthoSeededRef.current = true
    const cfg = pipeline.params
    setOrthoParams({
      reconstruction_quality:
        (cfg.reconstruction_quality as string) ?? "Default",
      ...(typeof cfg.custom_odm_options === "string" &&
      (cfg.custom_odm_options as string).trim()
        ? { custom_options: cfg.custom_odm_options as string }
        : {}),
    })
  }, [pipeline])

  // Derived AerialScope (path strings) once the user has picked everything.
  const scope: AerialScope | null = useMemo(() => {
    if (!aerialFields.date || !aerialFields.platform || !aerialFields.sensor)
      return null
    const built = buildAerialScope(ctx, aerialFields)
    return isAerialScopeComplete(built) ? built : null
  }, [ctx, aerialFields])

  // Confirm raw images exist (drives data_sync's "complete" signal too).
  const rawImagesQuery = useQuery<FileMetadata[], Error>({
    queryKey: ["files", "list", scope ? rawImagesPrefix(scope) : null],
    queryFn: async () => {
      if (!scope) return []
      const res = await FilesService.apiFilesListFilePathListFiles({
        filePath: `${DEFAULT_BUCKET}/${rawImagesPrefix(scope)}`,
      })
      return (res as FileMetadata[] | null) ?? []
    },
    enabled: isLoggedIn() && Boolean(scope),
    staleTime: 30_000,
  })
  const imageFiles = useMemo(
    () =>
      (rawImagesQuery.data ?? []).filter((f) =>
        /\.(jpe?g|png|tif?f)$/i.test(f.object_name ?? ""),
      ),
    [rawImagesQuery.data],
  )

  // List the Processed/ prefix so OrthoVersionsPanel can derive the
  // version table from on-disk files. Refetch on RUN_ODM completion via
  // the WS terminal handler below.
  const processedFilesQuery = useQuery<FileMetadata[], Error>({
    queryKey: ["files", "list", scope ? processedPrefix(scope) : null],
    queryFn: async () => {
      if (!scope) return []
      const res = await FilesService.apiFilesListFilePathListFiles({
        filePath: `${DEFAULT_BUCKET}/${processedPrefix(scope)}`,
      })
      return (res as FileMetadata[] | null) ?? []
    },
    enabled: isLoggedIn() && Boolean(scope),
    staleTime: 30_000,
  })

  // Imported orthos live at Raw/{scope}/Orthomosaic/. Merge with the
  // Processed/ listing for buildOrthoVersions so the panel sees both.
  const uploadedOrthosQuery = useQuery<FileMetadata[], Error>({
    queryKey: [
      "files",
      "list",
      scope
        ? `Raw/${scope.year}/${scope.experiment}/${scope.location}/${scope.population}/${scope.date}/${scope.platform}/${scope.sensor}/Orthomosaic/`
        : null,
    ],
    queryFn: async () => {
      if (!scope) return []
      const path = `${DEFAULT_BUCKET}/Raw/${scope.year}/${scope.experiment}/${scope.location}/${scope.population}/${scope.date}/${scope.platform}/${scope.sensor}/Orthomosaic/`
      const res = await FilesService.apiFilesListFilePathListFiles({
        filePath: path,
      })
      return (res as FileMetadata[] | null) ?? []
    },
    enabled: isLoggedIn() && Boolean(scope),
    staleTime: 30_000,
  })

  const orthoFiles = useMemo(
    () => [
      ...(processedFilesQuery.data ?? []),
      ...(uploadedOrthosQuery.data ?? []),
    ],
    [processedFilesQuery.data, uploadedOrthosQuery.data],
  )

  // Plot-geometry versions for the trait dialog's boundary picker.
  const { data: boundaryVersions = [] } = usePlotGeometryVersions(
    scope ? processedPrefix(scope) : null,
  )

  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [traitDialogOpen, setTraitDialogOpen] = useState(false)
  const [traitDialogState, setTraitDialogState] = useState<TraitDialogState>({
    orthoVersion: null,
    boundaryVersion: null,
    exgThreshold: 0.1,
  })

  // Run-level WS subscription: any step that has a *running* job gets its
  // events fed into the per-runId buffer so the StepRow log + progress bar
  // animate. We re-subscribe when the running job changes.
  const [events, setEvents] = useState<RunProgressEvent[]>(
    () => eventBuffer.get(runId) ?? [],
  )
  const [lastProgress, setLastProgress] = useState<number | null>(
    () => progressBuffer.get(runId) ?? null,
  )
  const activeSubsRef = useRef<Map<string, () => void>>(new Map())

  useEffect(() => {
    if (!run) return
    const desired = new Map<string, string>() // jobId → stepKey
    for (const [stepKey, st] of Object.entries(run.steps)) {
      if (st.status === "running" && st.jobIds.length > 0) {
        desired.set(st.jobIds[st.jobIds.length - 1], stepKey)
      }
    }
    // Subscribe to new jobs.
    for (const [jobId, stepKey] of desired) {
      if (activeSubsRef.current.has(jobId)) continue
      // Belt-and-suspenders: if the page reloaded after the job already
      // terminated, the live WebSocket may not replay its last frame
      // (wsManager's `lastEvent` cache is in-memory and gone after reload).
      // Poll the job once on subscribe so we can settle the runStore step
      // even if no further WS event arrives.
      JobsService.apiJobsJobIdGetJob({ jobId })
        .then((job) => {
          const j = job as JobOutput | null
          if (!j) return
          const status = String(j.status ?? "")
          if (status === "COMPLETED") {
            setStepState(runId, stepKey, {
              status: "completed",
              completedAt: new Date().toISOString(),
            })
          } else if (status === "FAILED") {
            setStepState(runId, stepKey, {
              status: "failed",
              error: String(
                (j as { error_message?: string }).error_message ?? "Failed",
              ),
              completedAt: new Date().toISOString(),
            })
          } else if (status === "CANCELLED") {
            setStepState(runId, stepKey, {
              status: "failed",
              error: "Cancelled",
              completedAt: new Date().toISOString(),
            })
          }
        })
        .catch(() => {
          // Best-effort — the live WS subscription below is the primary path.
        })
      const unsub = subscribeJobAsRunEvent(jobId, stepKey, (evt) => {
        setEvents((prev) => {
          const next = [...prev, evt]
          eventBuffer.set(runId, next)
          return next
        })
        if (typeof evt.progress === "number") {
          progressBuffer.set(runId, evt.progress)
          setLastProgress(evt.progress)
        }
        // Terminal frame: persist the step's outcome back to runStore so
        // getStepStatus flips off "running" and the StepRow's spinner /
        // disabled state clear. Without this the WebSocket update only
        // moves the bottom ProcessPanel forward — the step row stays stuck.
        if (evt.terminal) {
          if (evt.event === "complete") {
            setStepState(runId, stepKey, {
              status: "completed",
              completedAt: new Date(evt.timestamp).toISOString(),
            })
            // RUN_ODM landed: refetch the Processed/ listing so the
            // new ortho TIF appears in OrthoVersionsPanel without a
            // page reload.
            if (stepKey === "orthomosaic") {
              queryClient.invalidateQueries({
                queryKey: [
                  "files",
                  "list",
                  scope ? processedPrefix(scope) : null,
                ],
              })
            }
          } else if (evt.event === "error") {
            setStepState(runId, stepKey, {
              status: "failed",
              error: evt.message ?? "Failed",
              completedAt: new Date(evt.timestamp).toISOString(),
            })
          } else if (evt.event === "cancelled") {
            setStepState(runId, stepKey, {
              status: "failed",
              error: "Cancelled",
              completedAt: new Date(evt.timestamp).toISOString(),
            })
          }
        }
      })
      activeSubsRef.current.set(jobId, unsub)
    }
    // Unsubscribe from jobs no longer active.
    for (const [jobId, unsub] of activeSubsRef.current) {
      if (!desired.has(jobId)) {
        unsub()
        activeSubsRef.current.delete(jobId)
        closeJobConnection(jobId)
      }
    }
  }, [run, runId, queryClient, scope])

  const steps = pipeline?.type === "ground" ? GROUND_STEPS : AERIAL_STEPS
  const stepsState: Record<string, { status: string }> = run?.steps ?? {}
  const nextKey = getNextStep(steps, stepsState)
  const isAnyExecuting = Object.values(stepsState).some(
    (s) => s.status === "running",
  )

  const handleRunStep = useCallback(
    async (stepKey: string) => {
      if (!run || !workspace) return
      const wired = steps.find((s) => s.key === stepKey)?.wiredIn
      if (wired && !isLive(wired)) {
        showErrorToast(`This step is being restored in ${wired}.`)
        return
      }
      if (stepKey === "orthomosaic" && (!scope || imageFiles.length === 0)) {
        showErrorToast(
          !scope
            ? "Pick a flight date, platform, and sensor first."
            : "No raw images found at the configured scope.",
        )
        return
      }
      if (stepKey === "data_sync" && !scope) {
        showErrorToast("Pick a flight date, platform, and sensor first.")
        return
      }
      if (stepKey === "trait_extraction") {
        // Open the trait dialog instead of submitting; submission happens
        // via TraitExtractionDialog → handleSubmitTraits.
        const versions = buildOrthoVersions(run, scope, orthoFiles)
        const activeBv =
          boundaryVersions.find((b) => b.is_active)?.version ??
          boundaryVersions[0]?.version ??
          null
        setTraitDialogState({
          orthoVersion: versions[0]?.version ?? null,
          boundaryVersion: activeBv,
          exgThreshold: 0.1,
        })
        setTraitDialogOpen(true)
        return
      }
      // Ground stitching: fan-in all raw images. Per-plot fan-out is
      // tracked by PlotMarker (R6 deferred); for MVP we pass every image
      // as one stitch sequence.
      let stitchingParams: Parameters<typeof executeStep>[0]["stitching"] | undefined
      if (stepKey === "stitching") {
        if (!scope) {
          showErrorToast("Pick a flight date, platform, and sensor first.")
          return
        }
        if (imageFiles.length < 2) {
          showErrorToast(
            "RUN_STITCH needs at least 2 images at the configured scope.",
          )
          return
        }
        const imagePaths = imageFiles
          .map((f) => f.object_name ?? "")
          .filter(Boolean)
        const cfg = (pipeline?.params.agrowstitch_params ?? {}) as Record<
          string,
          unknown
        >
        const cpuCount = pipeline?.params.num_cpu as number | undefined
        stitchingParams = {
          imagePaths,
          outputMosaicPath: `${processedPrefix(scope)}stitched/mosaic.tif`,
          config: {
            ...cfg,
            stitching_direction: "RIGHT",
          },
          cpuCount,
        }
      }
      try {
        const result = await executeStep({
          runId: run.id,
          stepKey,
          scope: scope ?? ({} as AerialScope),
          experimentId: workspace.experimentId,
          orthomosaic: stepKey === "orthomosaic" ? orthoParams : undefined,
          stitching: stitchingParams,
        })
        if (result.jobId) {
          // Register with the bottom ProcessPanel so it streams progress.
          const existing = processes.find(
            (p) => p.runId === result.jobId && (p.status === "running" || p.status === "pending"),
          )
          if (existing) {
            updateProcess(existing.id, {
              link: `/process/${workspaceId}/run/${run.id}`,
            })
          } else {
            addProcess({
              type: "processing",
              title: `${stepKey} — ${pipeline?.name ?? "pipeline"}`,
              status: "running",
              items: [],
              runId: result.jobId,
              link: `/process/${workspaceId}/run/${run.id}`,
            })
          }
          showSuccessToast(`${stepKey} job submitted`)
        }
      } catch (err) {
        showErrorToast(
          err instanceof Error ? err.message : `Failed to run ${stepKey}`,
        )
      }
    },
    [
      run,
      workspace,
      steps,
      scope,
      imageFiles.length,
      orthoParams,
      processes,
      addProcess,
      updateProcess,
      showErrorToast,
      showSuccessToast,
      workspaceId,
      pipeline?.name,
      pipeline?.params,
      orthoFiles,
      boundaryVersions,
    ],
  )

  const handleStopStep = useCallback(
    async (stepKey: string) => {
      if (!run) return
      try {
        await stopStep(run.id, stepKey)
      } catch (err) {
        showErrorToast(err instanceof Error ? err.message : "Failed to stop step")
      }
    },
    [run, showErrorToast],
  )

  const handleSkipStep = useCallback(
    (stepKey: string) => {
      if (!run) return
      markStepSkipped(run.id, stepKey)
    },
    [run],
  )

  const handleOpenTool = useCallback(
    (stepKey: string) => {
      if (!run) return
      navigate({
        to: "/process/$workspaceId/tool",
        params: { workspaceId },
        search: { runId: run.id, step: stepKey },
      })
    },
    [run, navigate, workspaceId],
  )

  const handleSubmitTraits = useCallback(async () => {
    if (!run || !workspace || !scope) return
    if (traitDialogState.orthoVersion === null) return
    if (traitDialogState.boundaryVersion === null) {
      showErrorToast("Pick a plot-boundary version (R5)")
      return
    }
    const versions = buildOrthoVersions(run, scope, orthoFiles)
    const ortho = versions.find(
      (v) => v.version === traitDialogState.orthoVersion,
    )
    if (!ortho) {
      showErrorToast("Selected ortho version not found")
      return
    }
    // Strip leading bucket segment for the worker (it adds the bucket
    // back from STORAGE_BUCKET).
    const orthoMinioPath = ortho.path.replace(/^[^/]+\//, "")
    // Output path lives next to the ortho with a versioned suffix.
    const outputPath = `${processedPrefix(scope)}traits/v${traitDialogState.orthoVersion}-b${traitDialogState.boundaryVersion}-traits.geojson`
    // Boundary path will be filled in by R5 (PlotBoundaryPrep writes the
    // versioned GeoJSON). For now use the placeholder path our backend
    // expects; R5 will replace this with the real version-resolved path.
    const boundaryPath = `${processedPrefix(scope)}plot-boundaries/v${traitDialogState.boundaryVersion}.geojson`

    try {
      const result = await executeStep({
        runId: run.id,
        stepKey: "trait_extraction",
        scope,
        experimentId: workspace.experimentId,
        traitExtraction: {
          orthomosaicPath: orthoMinioPath,
          boundaryGeojsonPath: boundaryPath,
          outputTraitsGeojsonPath: outputPath,
          exgThreshold: traitDialogState.exgThreshold,
        },
      })
      if (result.jobId) {
        addProcess({
          type: "processing",
          title: `trait_extraction — ${pipeline?.name ?? "pipeline"}`,
          status: "running",
          items: [],
          runId: result.jobId,
          link: `/process/${workspaceId}/run/${run.id}`,
        })
        showSuccessToast("Trait extraction job submitted")
      }
      setTraitDialogOpen(false)
    } catch (err) {
      showErrorToast(
        err instanceof Error ? err.message : "Failed to submit trait extraction",
      )
    }
  }, [
    run,
    workspace,
    scope,
    traitDialogState,
    orthoFiles,
    addProcess,
    showSuccessToast,
    showErrorToast,
    workspaceId,
    pipeline?.name,
  ])

  if (!workspace) {
    return (
      <div className="bg-background min-h-screen">
        <div className="mx-auto max-w-5xl p-8 text-center text-muted-foreground">
          Workspace not found.
        </div>
      </div>
    )
  }
  if (!run) {
    return (
      <div className="bg-background min-h-screen">
        <div className="mx-auto max-w-5xl p-8 text-center text-muted-foreground">
          Run not found.
        </div>
      </div>
    )
  }

  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto max-w-5xl p-8">
        <div className="mb-6 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back to workspace"
            onClick={() =>
              navigate({ to: "/process/$workspaceId", params: { workspaceId } })
            }
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-semibold">
              {run.name ?? `Run ${run.id.slice(0, 8)}`}
            </h1>
            <p className="text-muted-foreground text-sm">
              {pipeline?.name ?? "Pipeline"} ·{" "}
              <span className="capitalize">{pipeline?.type ?? "?"}</span> · Created{" "}
              {new Date(run.createdAt).toLocaleString()}
            </p>
          </div>
          <Button
            variant="outline"
            size="icon"
            aria-label="Refresh"
            onClick={() => rawImagesQuery.refetch()}
            disabled={rawImagesQuery.isFetching}
          >
            <RefreshCw
              className={`h-4 w-4 ${rawImagesQuery.isFetching ? "animate-spin" : ""}`}
            />
          </Button>
        </div>

        {/* Both aerial + ground pipelines need a flight scope (date /
            platform / sensor) to find raw images at the right MinIO
            prefix. The ground pipeline path naming is the same as the
            aerial one — `rawImagesPrefix(scope)` works for both. */}
        {(pipeline?.type === "aerial" || pipeline?.type === "ground") && (
          <div className="mb-6 space-y-4">
            <RunSetupCard fields={aerialFields} onChange={setAerialFields} />
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Inputs</CardTitle>
                <CardDescription>
                  Raw images expected at the prefix below.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {scope ? (
                  <>
                    <code className="bg-muted block break-all rounded px-2 py-1 text-xs">
                      {rawImagesPrefix(scope)}
                    </code>
                    <p className="text-muted-foreground flex items-center gap-2">
                      <ImageIcon className="h-4 w-4" />
                      {rawImagesQuery.isLoading
                        ? "Looking for images…"
                        : `${imageFiles.length} image${
                            imageFiles.length === 1 ? "" : "s"
                          } found`}
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground">
                    Pick a flight date, platform, and sensor above to locate raw
                    images.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Processing Steps</CardTitle>
            <CardDescription>
              {pipeline?.type === "aerial"
                ? "Drone imagery → orthomosaic → plot boundaries → traits."
                : "Ground rover data → stitching → plot boundaries → inference."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-0">
              {steps.map((step, idx) => {
                const status = getStepStatus(step.key, stepsState, steps)
                const isLast = idx === steps.length - 1
                return (
                  <StepRow
                    key={step.key}
                    step={step}
                    status={status}
                    isNext={step.key === nextKey}
                    isLast={isLast}
                    events={events}
                    lastProgress={lastProgress}
                    isExecuting={isAnyExecuting}
                    onRunStep={() => handleRunStep(step.key)}
                    onOpenTool={() => handleOpenTool(step.key)}
                    onStopStep={() => handleStopStep(step.key)}
                    onSkipStep={
                      step.kind === "optional"
                        ? () => handleSkipStep(step.key)
                        : undefined
                    }
                    extraContent={
                      step.key === "orthomosaic" ? (
                        status === "completed" ? (
                          <OrthoVersionsPanel
                            run={run}
                            scope={scope}
                            files={orthoFiles}
                            onOpenImport={() => setImportDialogOpen(true)}
                          />
                        ) : (
                          <OrthomosaicOptions
                            params={orthoParams}
                            onChange={setOrthoParams}
                            onOpenImport={() => setImportDialogOpen(true)}
                            hasUploadedOrthos={
                              (uploadedOrthosQuery.data ?? []).some((f) =>
                                /\.tiff?$/i.test(f.object_name ?? ""),
                              )
                            }
                          />
                        )
                      ) : step.key === "trait_extraction" ? (
                        <TraitRecordsPanel run={run} />
                      ) : step.wiredIn && !isLive(step.wiredIn) ? (
                        <p className="text-muted-foreground rounded border bg-muted/30 p-2 text-xs">
                          This step's panels and dialogs are restored in{" "}
                          <strong>{step.wiredIn}</strong>. The step row is shown
                          here so the wizard order is visible.
                        </p>
                      ) : null
                    }
                  />
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <ImportOrthoDialog
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        run={run}
        scope={scope}
      />

      <TraitExtractionDialog
        open={traitDialogOpen}
        onClose={() => setTraitDialogOpen(false)}
        orthoVersions={buildOrthoVersions(run, scope, orthoFiles)}
        boundaryVersions={boundaryVersions}
        state={traitDialogState}
        onChange={setTraitDialogState}
        onSubmit={handleSubmitTraits}
      />
    </div>
  )
}
