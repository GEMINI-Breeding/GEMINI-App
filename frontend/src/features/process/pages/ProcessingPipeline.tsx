/**
 * ProcessingPipeline — restored 3-step pipeline-creation wizard.
 *
 * Restored from `main`'s 1063-LOC version, with the persistence layer
 * swapped from `PipelinesService` (deleted REST routes) to `runStore`
 * (localStorage-backed Workspace/Pipeline/Run model).
 *
 * Other adjustments vs. main:
 *   - `UtilsService.capabilities()` (gone with the FastAPI backend) →
 *     `navigator.hardwareConcurrency` for the CPU-count hint.
 *   - The visual EdgeCrop tool button is hidden until Phase R6 restores
 *     EdgeCropTool. The four mask_left/right/top/bottom inputs still work
 *     (they're independent number fields).
 */
import { useNavigate, useParams, useSearch } from "@tanstack/react-router"
import {
  ArrowLeft,
  Brain,
  Check,
  ChevronRight,
  Info,
  Map,
  Plus,
  Settings,
  X,
} from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"

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
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  createPipeline,
  updatePipeline,
  usePipeline,
} from "@/features/process/lib/runStore"
import useCustomToast from "@/hooks/useCustomToast"

function InfoTooltip({ text }: { text: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <sup className="cursor-help inline-flex items-center ml-0.5 align-super">
          <Info
            className="text-muted-foreground hover:text-foreground"
            size={11}
          />
        </sup>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs whitespace-normal">
        {text}
      </TooltipContent>
    </Tooltip>
  )
}

interface RoboflowModel {
  label: string
  roboflow_api_key: string
  roboflow_model_id: string
  task_type: "detection" | "segmentation"
}

const EMPTY_MODEL = (): RoboflowModel => ({
  label: "",
  roboflow_api_key: "",
  roboflow_model_id: "",
  task_type: "detection",
})

type Step = 1 | 2 | 3

// ── Ground pipeline ─────────────────────────────────────────────────────

type GroundPlatform = "amiga" | "monopod" | "custom"

interface AgrowstitchParams {
  forward_limit: number
  max_reprojection_error: number
  mask_left: number
  mask_right: number
  mask_top: number
  mask_bottom: number
  batch_size: number
  min_inliers: number
}

const PLATFORM_PRESETS: Record<
  Exclude<GroundPlatform, "custom">,
  AgrowstitchParams
> = {
  amiga: {
    forward_limit: 4,
    max_reprojection_error: 1.0,
    mask_left: 0,
    mask_right: 0,
    mask_top: 0,
    mask_bottom: 0,
    batch_size: 10,
    min_inliers: 20,
  },
  monopod: {
    forward_limit: 8,
    max_reprojection_error: 3.0,
    mask_left: 0,
    mask_right: 0,
    mask_top: 0,
    mask_bottom: 0,
    batch_size: 10,
    min_inliers: 20,
  },
}

const DEFAULT_AGROWSTITCH_PARAMS: AgrowstitchParams = {
  forward_limit: 8,
  max_reprojection_error: 1.0,
  mask_left: 0,
  mask_right: 0,
  mask_top: 0,
  mask_bottom: 0,
  batch_size: 10,
  min_inliers: 20,
}

const PARAM_RECS: Record<
  keyof Pick<AgrowstitchParams, "forward_limit" | "max_reprojection_error">,
  string
> = {
  forward_limit: "Amiga: 4 · Monopod: 5–8",
  max_reprojection_error: "Amiga: 1.0 · Monopod: 3.0",
}

const GROUND_DEFAULT_CONFIG = {
  device: "cpu" as "cpu" | "gpu" | "multiprocessing",
  num_cpu: 0,
  platform: "custom" as GroundPlatform,
  agrowstitch_params: DEFAULT_AGROWSTITCH_PARAMS,
  custom_agrowstitch_options: "",
}

// Reconstruction-quality vocabulary the GEMINIbase ODM worker accepts.
// Mirrors QUALITY_PRESETS in `backend/gemini/workers/odm/worker.py` —
// keep in sync if you tweak the worker side. The pipeline-level pick is
// the *default* used by every Run; users can still override per-run on
// the orthomosaic step in RunDetail.
type OdmPreset = "Draft" | "Standard" | "High Quality" | "Ultra" | "Custom"

const ODM_PRESETS: Record<OdmPreset, { label: string; desc: string }> = {
  Draft: {
    label: "Draft",
    desc: "Fastest, lowest quality — good for quick previews (5 cm/px, pc-quality lowest, feature-quality low).",
  },
  Standard: {
    label: "Standard",
    desc: "Balanced speed and quality — recommended for most surveys (3 cm/px, pc-quality medium, feature-quality high).",
  },
  "High Quality": {
    label: "High Quality",
    desc: "Slower but detailed — suitable for final deliverables (2 cm/px, pc-quality high, feature-quality ultra).",
  },
  Ultra: {
    label: "Ultra",
    desc: "Maximum quality, very slow — use for critical analysis (1 cm/px, pc-quality ultra, feature-quality ultra).",
  },
  Custom: {
    label: "Custom",
    desc: "Pass raw NodeODM CLI flags below.",
  },
}

const AERIAL_DEFAULT_CONFIG = {
  reconstruction_quality: "Standard" as OdmPreset,
  custom_odm_options: "",
}

export function ProcessingPipeline() {
  const navigate = useNavigate()
  const { workspaceId } = useParams({
    from: "/_layout/process/$workspaceId/pipeline",
  })
  const search = useSearch({ from: "/_layout/process/$workspaceId/pipeline" })
  const pipelineType = search.type === "ground" ? "ground" : "aerial"
  const editingPipelineId = search.pipelineId ?? null

  const { showErrorToast } = useCustomToast()

  const [currentStep, setCurrentStep] = useState<Step>(1)
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set())

  const [pipelineName, setPipelineName] = useState("")
  const [groundConfig, setGroundConfig] = useState(GROUND_DEFAULT_CONFIG)
  const [aerialConfig, setAerialConfig] = useState(AERIAL_DEFAULT_CONFIG)
  const [roboflowModels, setRoboflowModels] = useState<RoboflowModel[]>([
    EMPTY_MODEL(),
  ])
  const [inferenceMode, setInferenceMode] = useState<"cloud" | "local">("cloud")
  const [localServerUrl, setLocalServerUrl] = useState("http://localhost:9002")

  // Replaces UtilsService.capabilities — the browser knows how many cores
  // the user has; fine for a UX hint. Defaults to 0 when unsupported so
  // the "max recommended" badge just hides itself.
  const systemCpuCount: number =
    typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 0 : 0

  const existingPipeline = usePipeline(editingPipelineId ?? undefined)

  useEffect(() => {
    if (!existingPipeline) return
    const cfg = existingPipeline.params
    setPipelineName(existingPipeline.name)
    if (existingPipeline.type === "ground") {
      const savedParams =
        (cfg.agrowstitch_params as Partial<AgrowstitchParams>) ?? {}
      setGroundConfig({
        device: (cfg.device as "cpu" | "gpu" | "multiprocessing") ?? "cpu",
        num_cpu: (cfg.num_cpu as number) ?? 0,
        platform: (cfg.platform as GroundPlatform) ?? "custom",
        agrowstitch_params: { ...DEFAULT_AGROWSTITCH_PARAMS, ...savedParams },
        custom_agrowstitch_options:
          (cfg.custom_agrowstitch_options as string) ?? "",
      })
    } else {
      // Migrate legacy {odm_preset: "standard", dem_resolution, ...} shapes
      // saved by the pre-Apr 2026 wizard into the new single-string preset.
      // Also map the short-lived "Lowest/Low/Medium/High" labels that
      // shipped briefly on this branch before the rename to match main.
      const legacyPreset = cfg.odm_preset as string | undefined
      const legacyMap: Record<string, OdmPreset> = {
        draft: "Draft",
        standard: "Standard",
        high: "High Quality",
        ultra: "Ultra",
        custom: "Custom",
        Lowest: "Draft",
        Low: "Standard",
        Default: "Standard",
        Medium: "Standard",
        High: "High Quality",
      }
      const fromLegacy = legacyPreset ? legacyMap[legacyPreset] : undefined
      const rawQuality = cfg.reconstruction_quality as string | undefined
      const migratedQuality =
        rawQuality && rawQuality in legacyMap
          ? legacyMap[rawQuality]
          : (rawQuality as OdmPreset | undefined)
      setAerialConfig({
        reconstruction_quality: migratedQuality ?? fromLegacy ?? "Standard",
        custom_odm_options:
          (cfg.custom_odm_options as string) ??
          (cfg.custom_options as string) ??
          "",
      })
    }
    const rfModels = cfg.roboflow_models as RoboflowModel[] | null | undefined
    if (rfModels && rfModels.length > 0) {
      setRoboflowModels(
        rfModels.map((m) => ({
          label: m.label,
          roboflow_api_key: m.roboflow_api_key ?? "",
          roboflow_model_id: m.roboflow_model_id ?? "",
          task_type: m.task_type,
        })),
      )
    }
    setInferenceMode((cfg.inference_mode as "cloud" | "local") ?? "cloud")
    setLocalServerUrl(
      (cfg.local_server_url as string) ?? "http://localhost:9002",
    )
  }, [existingPipeline])

  const steps = [
    {
      number: 1,
      title: "Pipeline Setup",
      description: "Name and configure the pipeline",
      icon: Map,
    },
    {
      number: 2,
      title: pipelineType === "aerial" ? "ODM Settings" : "Stitch Settings",
      description:
        pipelineType === "aerial"
          ? "Configure orthomosaic generation"
          : "Configure AgRowStitch",
      icon: Settings,
    },
    {
      number: 3,
      title: "Roboflow",
      description: "Set up inference model",
      icon: Brain,
    },
  ]

  const configPayload = (): Record<string, unknown> => ({
    ...(pipelineType === "ground" ? groundConfig : aerialConfig),
    roboflow_models: roboflowModels.filter((m) => m.roboflow_model_id.trim()),
    inference_mode: inferenceMode,
    ...(inferenceMode === "local" && { local_server_url: localServerUrl }),
  })

  const handleSave = () => {
    try {
      if (editingPipelineId) {
        updatePipeline(editingPipelineId, {
          name: pipelineName,
          type: pipelineType,
          params: configPayload(),
        })
      } else {
        createPipeline({
          workspaceId,
          name: pipelineName,
          type: pipelineType,
          params: configPayload(),
        })
      }
      navigate({ to: "/process/$workspaceId", params: { workspaceId } })
    } catch (err) {
      showErrorToast(
        editingPipelineId
          ? `Failed to update pipeline: ${(err as Error).message}`
          : `Failed to create pipeline: ${(err as Error).message}`,
      )
    }
  }

  const handleNext = () => {
    setCompletedSteps(new Set([...completedSteps, currentStep]))
    if (currentStep < 3) {
      setCurrentStep((currentStep + 1) as Step)
    } else {
      handleSave()
    }
  }

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep((currentStep - 1) as Step)
    }
  }

  const isStepComplete = (step: number) => {
    if (step === 1) return !!pipelineName.trim()
    if (step === 2) {
      if (pipelineType === "aerial")
        return !!aerialConfig.reconstruction_quality
      return !!groundConfig.device
    }
    return true
  }

  return (
    <div className="bg-background">
      <div className="mx-auto max-w-5xl p-8">
        <div className="mb-8 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() =>
              navigate({ to: "/process/$workspaceId", params: { workspaceId } })
            }
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold">
              {editingPipelineId ? "Edit" : "New"}{" "}
              {pipelineType === "aerial" ? "Aerial" : "Ground"} Pipeline
            </h1>
            <p className="text-muted-foreground text-sm">
              Configure your {pipelineType} processing pipeline
            </p>
          </div>
        </div>

        <div className="mb-8">
          <div className="mb-4 flex items-center justify-between">
            {steps.map((step, index) => (
              <div key={step.number} className="flex flex-1 items-center">
                <div className="flex flex-1 flex-col items-center">
                  <div
                    className={`flex h-12 w-12 items-center justify-center rounded-full border-2 transition-colors ${
                      completedSteps.has(step.number)
                        ? "bg-primary border-primary text-primary-foreground"
                        : currentStep === step.number
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-background text-muted-foreground"
                    }`}
                  >
                    {completedSteps.has(step.number) ? (
                      <Check className="h-6 w-6" />
                    ) : (
                      <step.icon className="h-6 w-6" />
                    )}
                  </div>
                  <div className="mt-2 text-center">
                    <p
                      className={`text-sm font-medium ${
                        currentStep === step.number
                          ? "text-foreground"
                          : "text-muted-foreground"
                      }`}
                    >
                      {step.title}
                    </p>
                    <p className="text-muted-foreground hidden text-xs md:block">
                      {step.description}
                    </p>
                  </div>
                </div>
                {index < steps.length - 1 && (
                  <div
                    className={`mx-4 h-0.5 flex-1 transition-colors ${
                      completedSteps.has(step.number)
                        ? "bg-primary"
                        : "bg-border"
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
          <Progress value={(currentStep / 3) * 100} className="h-2" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              Step {currentStep}: {steps[currentStep - 1].title}
            </CardTitle>
            <CardDescription>
              {steps[currentStep - 1].description}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {currentStep === 1 && (
              <div className="space-y-2">
                <Label htmlFor="pipeline-name">Pipeline Name</Label>
                <Input
                  id="pipeline-name"
                  placeholder="e.g., North Field Spring Survey"
                  value={pipelineName}
                  onChange={(e) => setPipelineName(e.target.value)}
                  onKeyDown={(e) =>
                    e.key === "Enter" && isStepComplete(1) && handleNext()
                  }
                />
                <p className="text-muted-foreground text-xs">
                  Plot boundaries and settings defined here will be reused when
                  you run this pipeline on new dates.
                </p>
              </div>
            )}

            {currentStep === 2 && pipelineType === "aerial" && (
              <>
                <div className="space-y-2">
                  <Label>Default reconstruction quality</Label>
                  <p className="text-muted-foreground text-xs">
                    Pre-fills the orthomosaic step's quality dropdown for every
                    Run on this pipeline. You can still override per-run.
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {(
                      Object.entries(ODM_PRESETS) as [
                        OdmPreset,
                        (typeof ODM_PRESETS)[OdmPreset],
                      ][]
                    ).map(([key, preset]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() =>
                          setAerialConfig({
                            ...aerialConfig,
                            reconstruction_quality: key,
                          })
                        }
                        className={`text-left rounded-lg border p-3 transition-colors ${
                          aerialConfig.reconstruction_quality === key
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/50"
                        }`}
                      >
                        <p className="text-sm font-medium">{preset.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {preset.desc}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>

                {aerialConfig.reconstruction_quality === "Custom" && (
                  <div className="space-y-2">
                    <Label>Custom NodeODM options</Label>
                    <Input
                      placeholder='e.g. "--fast-orthophoto --skip-3dmodel"'
                      value={aerialConfig.custom_odm_options}
                      onChange={(e) =>
                        setAerialConfig({
                          ...aerialConfig,
                          custom_odm_options: e.target.value,
                        })
                      }
                    />
                    <p className="text-muted-foreground text-xs">
                      Forwarded as-is to NodeODM. Drop a{" "}
                      <code>gcp_list.txt</code> alongside your raw images for
                      ground-control points.
                    </p>
                  </div>
                )}
              </>
            )}

            {currentStep === 2 && pipelineType === "ground" && (
              <>
                <div className="space-y-2">
                  <Label>Platform</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {(["amiga", "monopod", "custom"] as GroundPlatform[]).map(
                      (p) => {
                        const labels: Record<GroundPlatform, [string, string]> =
                          {
                            amiga: ["Amiga", "Farm-ng ground robot"],
                            monopod: ["Monopod", "Handheld / rolling"],
                            custom: ["Custom", "Configure manually"],
                          }
                        return (
                          <button
                            key={p}
                            type="button"
                            onClick={() => {
                              const preset =
                                p !== "custom"
                                  ? PLATFORM_PRESETS[p]
                                  : groundConfig.agrowstitch_params
                              setGroundConfig({
                                ...groundConfig,
                                platform: p,
                                agrowstitch_params: preset,
                              })
                            }}
                            className={`text-left rounded-lg border p-3 transition-colors ${
                              groundConfig.platform === p
                                ? "border-primary bg-primary/5"
                                : "border-border hover:border-primary/50"
                            }`}
                          >
                            <p className="text-sm font-medium">
                              {labels[p][0]}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {labels[p][1]}
                            </p>
                          </button>
                        )
                      },
                    )}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    Selecting a platform fills in recommended defaults below.
                    You can adjust any value afterward.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>
                    Processing Device
                    <InfoTooltip text="GPU significantly speeds up stitching. Multiprocessing runs plots in parallel across CPU cores. Stitch direction is set per-plot during the plot marking step." />
                  </Label>
                  <Select
                    value={groundConfig.device}
                    onValueChange={(v: "cpu" | "gpu" | "multiprocessing") =>
                      setGroundConfig({ ...groundConfig, device: v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cpu">CPU (single-threaded)</SelectItem>
                      <SelectItem value="multiprocessing">
                        CPU (multiprocessing)
                      </SelectItem>
                      <SelectItem value="gpu">GPU (CUDA)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {groundConfig.device === "multiprocessing" && (
                  <div className="space-y-2">
                    <Label>
                      Number of CPU Workers
                      <InfoTooltip
                        text={`Leave blank (0) to use all cores minus one automatically.${
                          systemCpuCount > 0
                            ? ` Max recommended: ${systemCpuCount}.`
                            : ""
                        }`}
                      />
                      {systemCpuCount > 0 && (
                        <span className="text-muted-foreground ml-2 font-normal">
                          (browser reports {systemCpuCount} logical cores)
                        </span>
                      )}
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      max={systemCpuCount || undefined}
                      placeholder={
                        systemCpuCount > 0
                          ? `0 = auto (${Math.max(1, systemCpuCount - 1)} cores)`
                          : "0 = auto"
                      }
                      value={
                        groundConfig.num_cpu === 0 ? "" : groundConfig.num_cpu
                      }
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10)
                        setGroundConfig({
                          ...groundConfig,
                          num_cpu: Number.isNaN(v) ? 0 : Math.max(0, v),
                        })
                      }}
                    />
                  </div>
                )}

                <div className="border-t pt-4 space-y-5">
                  <p className="text-sm font-semibold">Stitching Parameters</p>

                  <div className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <Label>
                        Look-ahead Frames
                        <InfoTooltip text="How many images ahead to search for matching features. Higher values help when images have less overlap or when the robot moves quickly. Range: 3–8." />
                      </Label>
                      <span className="text-[11px] text-muted-foreground shrink-0">
                        {PARAM_RECS.forward_limit}
                      </span>
                    </div>
                    <Input
                      type="number"
                      min={1}
                      max={20}
                      value={groundConfig.agrowstitch_params.forward_limit}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10)
                        setGroundConfig({
                          ...groundConfig,
                          platform: "custom",
                          agrowstitch_params: {
                            ...groundConfig.agrowstitch_params,
                            forward_limit: Number.isNaN(v) ? 4 : v,
                          },
                        })
                      }}
                    />
                    {(groundConfig.agrowstitch_params.forward_limit < 2 ||
                      groundConfig.agrowstitch_params.forward_limit > 15) && (
                      <p className="text-amber-600 dark:text-amber-400 text-xs">
                        ⚠ Value outside typical range (3–8) — results may be
                        unpredictable.
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <Label>
                        Alignment Tolerance
                        <InfoTooltip text="How many pixels of error are allowed when aligning two images. Higher = more forgiving of imperfect matches. Higher-resolution cameras (e.g. Monopod) often need a higher value. Range: 0.25–5.0." />
                      </Label>
                      <span className="text-[11px] text-muted-foreground shrink-0">
                        {PARAM_RECS.max_reprojection_error}
                      </span>
                    </div>
                    <Input
                      type="number"
                      min={0.1}
                      max={10}
                      step={0.25}
                      value={
                        groundConfig.agrowstitch_params.max_reprojection_error
                      }
                      onChange={(e) => {
                        const v = parseFloat(e.target.value)
                        setGroundConfig({
                          ...groundConfig,
                          platform: "custom",
                          agrowstitch_params: {
                            ...groundConfig.agrowstitch_params,
                            max_reprojection_error: Number.isNaN(v) ? 1.0 : v,
                          },
                        })
                      }}
                    />
                    {groundConfig.agrowstitch_params.max_reprojection_error >
                      5 && (
                      <p className="text-amber-600 dark:text-amber-400 text-xs">
                        ⚠ Very high tolerance — may allow poor image alignments.
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Label>
                        Edge Crop (pixels)
                        <InfoTooltip text="Removes a fixed number of pixels from each image edge before stitching — useful for camera mounts, lens rigs, or static obstructions. Default is 0 for all platforms — only change if your camera has a fixed obstruction." />
                      </Label>
                    </div>
                    <div className="grid grid-cols-4 gap-2 mt-1">
                      {(
                        [
                          "mask_left",
                          "mask_right",
                          "mask_top",
                          "mask_bottom",
                        ] as const
                      ).map((side) => (
                        <div key={side} className="space-y-1">
                          <p className="text-[11px] text-muted-foreground capitalize">
                            {side.replace("mask_", "")}
                          </p>
                          <Input
                            type="number"
                            min={0}
                            value={groundConfig.agrowstitch_params[side]}
                            onChange={(e) => {
                              const v = parseInt(e.target.value, 10)
                              setGroundConfig({
                                ...groundConfig,
                                platform: "custom",
                                agrowstitch_params: {
                                  ...groundConfig.agrowstitch_params,
                                  [side]: Number.isNaN(v) ? 0 : Math.max(0, v),
                                },
                              })
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <details className="group">
                    <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground select-none list-none flex items-center gap-1">
                      <span className="group-open:rotate-90 transition-transform inline-block">
                        ▶
                      </span>
                      Advanced Settings
                    </summary>
                    <div className="mt-4 space-y-5 pl-1 border-l-2 border-border">
                      <div className="space-y-1.5">
                        <Label>
                          Batch Size
                          <InfoTooltip text="Number of images processed together in each round of feature matching. Larger batches use more RAM. Keep between 10 and 20 unless you have limited memory." />
                        </Label>
                        <Input
                          type="number"
                          min={1}
                          max={50}
                          value={groundConfig.agrowstitch_params.batch_size}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10)
                            setGroundConfig({
                              ...groundConfig,
                              platform: "custom",
                              agrowstitch_params: {
                                ...groundConfig.agrowstitch_params,
                                batch_size: Number.isNaN(v) ? 10 : v,
                              },
                            })
                          }}
                        />
                        {groundConfig.agrowstitch_params.batch_size > 20 && (
                          <p className="text-amber-600 dark:text-amber-400 text-xs">
                            ⚠ Large batch size may exhaust memory on some
                            systems.
                          </p>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <Label>
                          Min Feature Matches
                          <InfoTooltip text="Minimum number of confirmed matching points required between two adjacent images for them to be stitched together. Raise this if stitches look smeared or distorted. Recommended: 20–50." />
                        </Label>
                        <Input
                          type="number"
                          min={5}
                          max={200}
                          value={groundConfig.agrowstitch_params.min_inliers}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10)
                            setGroundConfig({
                              ...groundConfig,
                              platform: "custom",
                              agrowstitch_params: {
                                ...groundConfig.agrowstitch_params,
                                min_inliers: Number.isNaN(v) ? 20 : v,
                              },
                            })
                          }}
                        />
                      </div>
                    </div>
                  </details>
                </div>

                <div className="space-y-1.5 border-t pt-4">
                  <Label>
                    Additional Overrides{" "}
                    <span className="font-normal text-muted-foreground">
                      (optional)
                    </span>
                    <InfoTooltip text="Raw YAML key-value pairs that override any AgRowStitch setting not exposed above. Applied last — takes precedence over everything else." />
                  </Label>
                  <Input
                    placeholder="e.g.  final_size: [71628, 0]"
                    value={groundConfig.custom_agrowstitch_options}
                    onChange={(e) =>
                      setGroundConfig({
                        ...groundConfig,
                        custom_agrowstitch_options: e.target.value,
                      })
                    }
                  />
                  <p className="text-muted-foreground text-xs">
                    <a
                      href="https://github.com/GEMINI-Breeding/AgRowStitch/blob/opencv/config.yaml"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-foreground"
                    >
                      See all available settings ↗
                    </a>
                  </p>
                </div>
              </>
            )}

            {currentStep === 3 && (
              <>
                <p className="text-muted-foreground text-sm">
                  Add one or more Roboflow models for inference on your plot
                  images. Leave empty to skip — you can configure and run
                  inference later from the run view.
                </p>

                <div className="space-y-3">
                  {roboflowModels.map((model, idx) => (
                    <div
                      key={idx}
                      className="grid grid-cols-[1fr_1fr_1fr_auto_auto] items-end gap-2"
                    >
                      <div className="space-y-1">
                        {idx === 0 && (
                          <Label className="text-muted-foreground text-xs">
                            Name
                          </Label>
                        )}
                        <Input
                          placeholder="e.g. Wheat Detection"
                          value={model.label}
                          onChange={(e) =>
                            setRoboflowModels((prev) =>
                              prev.map((m, i) =>
                                i === idx ? { ...m, label: e.target.value } : m,
                              ),
                            )
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        {idx === 0 && (
                          <Label className="text-muted-foreground text-xs">
                            API Key
                          </Label>
                        )}
                        <Input
                          type="password"
                          placeholder="rf_xxxxxxxxxxxx"
                          value={model.roboflow_api_key}
                          onChange={(e) =>
                            setRoboflowModels((prev) =>
                              prev.map((m, i) =>
                                i === idx
                                  ? { ...m, roboflow_api_key: e.target.value }
                                  : m,
                              ),
                            )
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        {idx === 0 && (
                          <Label className="text-muted-foreground text-xs">
                            Model ID
                          </Label>
                        )}
                        <Input
                          placeholder="my-project/3"
                          value={model.roboflow_model_id}
                          onChange={(e) =>
                            setRoboflowModels((prev) =>
                              prev.map((m, i) =>
                                i === idx
                                  ? { ...m, roboflow_model_id: e.target.value }
                                  : m,
                              ),
                            )
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        {idx === 0 && (
                          <Label className="text-muted-foreground text-xs">
                            Task
                          </Label>
                        )}
                        <Select
                          value={model.task_type}
                          onValueChange={(v: "detection" | "segmentation") =>
                            setRoboflowModels((prev) =>
                              prev.map((m, i) =>
                                i === idx ? { ...m, task_type: v } : m,
                              ),
                            )
                          }
                        >
                          <SelectTrigger className="w-36">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="detection">Detection</SelectItem>
                            <SelectItem value="segmentation">
                              Segmentation
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="mb-0.5"
                        onClick={() =>
                          setRoboflowModels((prev) =>
                            prev.filter((_, i) => i !== idx),
                          )
                        }
                        disabled={roboflowModels.length === 1}
                      >
                        <X className="text-muted-foreground h-4 w-4" />
                      </Button>
                    </div>
                  ))}

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setRoboflowModels((prev) => [...prev, EMPTY_MODEL()])
                    }
                  >
                    <Plus className="mr-1 h-4 w-4" />
                    Add Model
                  </Button>
                </div>

                <div className="space-y-2">
                  <Label>Inference Mode</Label>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <input
                        type="radio"
                        value="cloud"
                        checked={inferenceMode === "cloud"}
                        onChange={() => setInferenceMode("cloud")}
                        className="accent-primary"
                      />
                      Cloud (Roboflow)
                    </label>
                    <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <input
                        type="radio"
                        value="local"
                        checked={inferenceMode === "local"}
                        onChange={() => setInferenceMode("local")}
                        className="accent-primary"
                      />
                      Local server
                    </label>
                  </div>
                  {inferenceMode === "local" && (
                    <div className="space-y-1 pt-1">
                      <Label className="text-xs">Server URL</Label>
                      <Input
                        className="h-8 text-sm font-mono"
                        value={localServerUrl}
                        onChange={(e) => setLocalServerUrl(e.target.value)}
                        placeholder="http://localhost:9002"
                      />
                      <p className="text-xs text-muted-foreground">
                        The server will be auto-started if not already running.
                      </p>
                    </div>
                  )}
                </div>

                <div className="bg-muted/50 space-y-2 rounded-lg p-4">
                  <h4 className="text-sm font-medium">Pipeline Summary</h4>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Name:</span>
                      <span className="font-medium">{pipelineName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Type:</span>
                      <span className="font-medium capitalize">
                        {pipelineType}
                      </span>
                    </div>
                    {pipelineType === "aerial" && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          Default quality:
                        </span>
                        <span className="font-medium">
                          {
                            ODM_PRESETS[aerialConfig.reconstruction_quality]
                              .label
                          }
                        </span>
                      </div>
                    )}
                    {pipelineType === "ground" && (
                      <>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Device:</span>
                          <span className="font-medium">
                            {groundConfig.device === "multiprocessing"
                              ? `Multiprocessing (${
                                  groundConfig.num_cpu > 0
                                    ? `${groundConfig.num_cpu} workers`
                                    : "auto"
                                })`
                              : groundConfig.device.toUpperCase()}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">
                            Stitch config:
                          </span>
                          <span className="font-medium capitalize">
                            {groundConfig.platform}
                          </span>
                        </div>
                      </>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Roboflow models:
                      </span>
                      <span className="font-medium">
                        {roboflowModels.filter((m) =>
                          m.roboflow_model_id.trim(),
                        ).length > 0
                          ? roboflowModels
                              .filter((m) => m.roboflow_model_id.trim())
                              .map((m) => m.label || m.roboflow_model_id)
                              .join(", ")
                          : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Inference mode:
                      </span>
                      <span className="font-medium capitalize">
                        {inferenceMode === "local"
                          ? `Local (${localServerUrl})`
                          : "Cloud"}
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <div className="mt-6 flex items-center justify-between">
          <Button
            variant="outline"
            onClick={handlePrevious}
            disabled={currentStep === 1}
          >
            Previous
          </Button>
          <div className="text-muted-foreground text-sm">
            Step {currentStep} of {steps.length}
          </div>
          <Button onClick={handleNext} disabled={!isStepComplete(currentStep)}>
            {currentStep === 3
              ? editingPipelineId
                ? "Save Changes"
                : "Create Pipeline"
              : "Next"}
            {currentStep < 3 && <ChevronRight className="ml-2 h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  )
}
