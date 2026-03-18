import {
  ArrowLeft,
  Check,
  Map,
  Brain,
  Settings,
  ChevronRight,
  Plus,
  X,
} from "lucide-react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { PipelinesService, type PipelinePublic } from "@/client";
import useCustomToast from "@/hooks/useCustomToast";

interface RoboflowModel {
  label: string;
  roboflow_api_key: string;
  roboflow_model_id: string;
  task_type: "detection" | "segmentation";
}

const EMPTY_MODEL = (): RoboflowModel => ({
  label: "",
  roboflow_api_key: "",
  roboflow_model_id: "",
  task_type: "detection",
});

type Step = 1 | 2 | 3;

// Step 2 config defaults per type
const GROUND_DEFAULT_CONFIG = {
  device: "cpu" as "cpu" | "gpu" | "multiprocessing",
  num_cpu: 0,
  custom_agrowstitch_options: "",
};

type OdmPreset = "draft" | "standard" | "high" | "ultra" | "custom"

const ODM_PRESETS: Record<OdmPreset, { label: string; desc: string; dem: string; ortho: string; pc: string; feat: string }> = {
  draft:    { label: "Draft",        desc: "Fastest, lowest quality — good for quick previews",         dem: "5",  ortho: "5",  pc: "lowest", feat: "low"   },
  standard: { label: "Standard",     desc: "Balanced speed and quality — recommended for most surveys",  dem: "3",  ortho: "3",  pc: "medium", feat: "high"  },
  high:     { label: "High Quality", desc: "Slower but detailed — suitable for final deliverables",      dem: "2",  ortho: "2",  pc: "high",   feat: "ultra" },
  ultra:    { label: "Ultra",        desc: "Maximum quality, very slow — use for critical analysis",     dem: "1",  ortho: "1",  pc: "ultra",  feat: "ultra" },
  custom:   { label: "Custom",       desc: "Set resolution and quality options manually",                dem: "3",  ortho: "3",  pc: "medium", feat: "high"  },
}

const AERIAL_DEFAULT_CONFIG = {
  odm_preset: "standard" as OdmPreset,
  dem_resolution: "3",
  orthophoto_resolution: "3",
  pc_quality: "medium",
  feature_quality: "high",
  custom_odm_options: "",
};

export function ProcessingPipeline() {
  const navigate = useNavigate();
  const { workspaceId } = useParams({
    from: "/_layout/process/$workspaceId/pipeline",
  });
  const search = useSearch({ from: "/_layout/process/$workspaceId/pipeline" });
  const pipelineType = search.type === "ground" ? "ground" : "aerial";
  const editingPipelineId = search.pipelineId ?? null;

  const queryClient = useQueryClient();
  const { showErrorToast } = useCustomToast();

  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  // Step 1
  const [pipelineName, setPipelineName] = useState("");

  // System capabilities (for CPU count hint)
  const { data: capabilities } = useQuery({
    queryKey: ["capabilities"],
    queryFn: () => import("@/client").then((m) => m.UtilsService.capabilities()),
    staleTime: Infinity,
  });
  const systemCpuCount: number = (capabilities as any)?.cpu_count ?? 0;

  // Step 2 — ground
  const [groundConfig, setGroundConfig] = useState(GROUND_DEFAULT_CONFIG);

  // Step 2 — aerial
  const [aerialConfig, setAerialConfig] = useState(AERIAL_DEFAULT_CONFIG);

  // Step 3 — Roboflow models (optional, multi-model)
  const [roboflowModels, setRoboflowModels] = useState<RoboflowModel[]>([
    EMPTY_MODEL(),
  ]);
  const [inferenceMode, setInferenceMode] = useState<"cloud" | "local">("cloud");
  const [localServerUrl, setLocalServerUrl] = useState("http://localhost:9001");

  // Load existing pipeline when editing
  const { data: existingPipeline } = useQuery<PipelinePublic>({
    queryKey: ["pipelines-single", editingPipelineId],
    queryFn: () => PipelinesService.readOne({ id: editingPipelineId! }),
    enabled: !!editingPipelineId,
  });

  useEffect(() => {
    if (!existingPipeline) return;
    const cfg = (existingPipeline.config ?? {}) as Record<string, unknown>;
    setPipelineName(existingPipeline.name);
    if (existingPipeline.type === "ground") {
      setGroundConfig({
        device: (cfg.device as "cpu" | "gpu" | "multiprocessing") ?? "cpu",
        num_cpu: (cfg.num_cpu as number) ?? 0,
        custom_agrowstitch_options:
          (cfg.custom_agrowstitch_options as string) ?? "",
      });
    } else {
      setAerialConfig({
        odm_preset: (cfg.odm_preset as OdmPreset) ?? "standard",
        dem_resolution: String(cfg.dem_resolution ?? "3"),
        orthophoto_resolution: String(cfg.orthophoto_resolution ?? "3"),
        pc_quality: (cfg.pc_quality as string) ?? "medium",
        feature_quality: (cfg.feature_quality as string) ?? "high",
        custom_odm_options: (cfg.custom_odm_options as string) ?? "",
      });
    }
    // Support new roboflow_models array and old single roboflow object
    const rfModels = cfg.roboflow_models as RoboflowModel[] | null | undefined;
    const rf = cfg.roboflow as Record<string, string> | null | undefined;
    if (rfModels && rfModels.length > 0) {
      // Migrate old api_key/model_id field names if needed
      setRoboflowModels(rfModels.map((m) => ({
        label: m.label,
        roboflow_api_key: m.roboflow_api_key ?? (m as any).api_key ?? "",
        roboflow_model_id: m.roboflow_model_id ?? (m as any).model_id ?? "",
        task_type: m.task_type,
      })));
    } else if (rf?.api_key) {
      setRoboflowModels([{
        label: "Default",
        roboflow_api_key: rf.api_key ?? "",
        roboflow_model_id: rf.model_id ?? "",
        task_type: (rf.task_type as "detection" | "segmentation") ?? "detection",
      }]);
    }
    setInferenceMode((cfg.inference_mode as "cloud" | "local") ?? "cloud");
    setLocalServerUrl((cfg.local_server_url as string) ?? "http://localhost:9001");
  }, [existingPipeline]);

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
  ];

  const configPayload = () => ({
    ...(pipelineType === "ground" ? groundConfig : aerialConfig),
    roboflow_models: roboflowModels.filter((m) => m.roboflow_model_id.trim()),
    inference_mode: inferenceMode,
    ...(inferenceMode === "local" && { local_server_url: localServerUrl }),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      editingPipelineId
        ? PipelinesService.update({
            id: editingPipelineId,
            requestBody: { name: pipelineName, config: configPayload() },
          })
        : PipelinesService.create({
            workspaceId,
            requestBody: {
              name: pipelineName,
              type: pipelineType,
              workspace_id: workspaceId,
              config: configPayload(),
            },
          }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipelines", workspaceId] });
      navigate({ to: "/process/$workspaceId", params: { workspaceId } });
    },
    onError: () =>
      showErrorToast(
        editingPipelineId
          ? "Failed to update pipeline"
          : "Failed to create pipeline"
      ),
  });

  const handleNext = () => {
    setCompletedSteps(new Set([...completedSteps, currentStep]));
    if (currentStep < 3) {
      setCurrentStep((currentStep + 1) as Step);
    } else {
      saveMutation.mutate();
    }
  };

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep((currentStep - 1) as Step);
    }
  };

  const isStepComplete = (step: number) => {
    if (step === 1) return !!pipelineName.trim();
    if (step === 2) {
      if (pipelineType === "aerial") {
        return !!aerialConfig.odm_preset
      }
      return !!groundConfig.device;
    }
    // Step 3 is optional — always completable
    return true;
  };

  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto max-w-5xl p-8">
        <div className="mb-8 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() =>
              navigate({
                to: "/process/$workspaceId",
                params: { workspaceId },
              })
            }
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">
              {editingPipelineId ? "Edit" : "New"}{" "}
              {pipelineType === "aerial" ? "Aerial" : "Ground"} Pipeline
            </h1>
            <p className="text-muted-foreground text-sm">
              Configure your {pipelineType} processing pipeline
            </p>
          </div>
        </div>

        {/* Progress Steps */}
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

        {/* Step Content */}
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
            {/* Step 1: Name */}
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

            {/* Step 2: Processing settings */}
            {currentStep === 2 && pipelineType === "aerial" && (
              <>
                <div className="space-y-2">
                  <Label>Processing Quality</Label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {(Object.entries(ODM_PRESETS) as [OdmPreset, typeof ODM_PRESETS[OdmPreset]][]).map(([key, preset]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setAerialConfig({
                            ...aerialConfig,
                            odm_preset: key,
                            ...(key !== "custom" && {
                              dem_resolution: preset.dem,
                              orthophoto_resolution: preset.ortho,
                              pc_quality: preset.pc,
                              feature_quality: preset.feat,
                            }),
                          })
                        }}
                        className={`text-left rounded-lg border p-3 transition-colors ${
                          aerialConfig.odm_preset === key
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/50"
                        }`}
                      >
                        <p className="text-sm font-medium">{preset.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{preset.desc}</p>
                        {key !== "custom" && (
                          <p className="text-xs text-muted-foreground mt-1 font-mono">
                            {preset.ortho} cm/px · {preset.pc} quality
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {aerialConfig.odm_preset === "custom" && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>DEM Resolution (cm/px)</Label>
                        <Select
                          value={aerialConfig.dem_resolution}
                          onValueChange={(v) =>
                            setAerialConfig({ ...aerialConfig, dem_resolution: v })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">1 cm</SelectItem>
                            <SelectItem value="2">2 cm</SelectItem>
                            <SelectItem value="3">3 cm</SelectItem>
                            <SelectItem value="5">5 cm</SelectItem>
                            <SelectItem value="10">10 cm</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Orthophoto Resolution (cm/px)</Label>
                        <Select
                          value={aerialConfig.orthophoto_resolution}
                          onValueChange={(v) =>
                            setAerialConfig({ ...aerialConfig, orthophoto_resolution: v })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">1 cm</SelectItem>
                            <SelectItem value="2">2 cm</SelectItem>
                            <SelectItem value="3">3 cm</SelectItem>
                            <SelectItem value="5">5 cm</SelectItem>
                            <SelectItem value="10">10 cm</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Point Cloud Quality</Label>
                        <Select
                          value={aerialConfig.pc_quality}
                          onValueChange={(v) =>
                            setAerialConfig({ ...aerialConfig, pc_quality: v })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="lowest">Lowest</SelectItem>
                            <SelectItem value="low">Low</SelectItem>
                            <SelectItem value="medium">Medium</SelectItem>
                            <SelectItem value="high">High</SelectItem>
                            <SelectItem value="ultra">Ultra</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Feature Quality</Label>
                        <Select
                          value={aerialConfig.feature_quality}
                          onValueChange={(v) =>
                            setAerialConfig({ ...aerialConfig, feature_quality: v })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="lowest">Lowest</SelectItem>
                            <SelectItem value="low">Low</SelectItem>
                            <SelectItem value="medium">Medium</SelectItem>
                            <SelectItem value="high">High</SelectItem>
                            <SelectItem value="ultra">Ultra</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Additional ODM Options (optional)</Label>
                      <Input
                        placeholder="e.g., --rolling-shutter --matcher-neighbors 8"
                        value={aerialConfig.custom_odm_options}
                        onChange={(e) =>
                          setAerialConfig({
                            ...aerialConfig,
                            custom_odm_options: e.target.value,
                          })
                        }
                      />
                      <p className="text-muted-foreground text-xs">
                        Raw ODM CLI flags appended to the command. Overrides resolution/quality settings above.
                      </p>
                    </div>
                  </>
                )}
              </>
            )}

            {currentStep === 2 && pipelineType === "ground" && (
              <>
                <div className="space-y-2">
                  <Label>Processing Device</Label>
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
                      <SelectItem value="multiprocessing">CPU (multiprocessing)</SelectItem>
                      <SelectItem value="gpu">GPU (CUDA)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground text-xs">
                    GPU significantly speeds up stitching. Multiprocessing runs
                    plots in parallel across CPU cores. Stitch direction is set
                    per-plot during the plot marking step.
                  </p>
                </div>

                {groundConfig.device === "multiprocessing" && (
                  <div className="space-y-2">
                    <Label>
                      Number of CPU Workers
                      {systemCpuCount > 0 && (
                        <span className="text-muted-foreground ml-2 font-normal">
                          (system has {systemCpuCount} logical cores)
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
                      value={groundConfig.num_cpu === 0 ? "" : groundConfig.num_cpu}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        setGroundConfig({
                          ...groundConfig,
                          num_cpu: isNaN(v) ? 0 : Math.max(0, v),
                        });
                      }}
                    />
                    <p className="text-muted-foreground text-xs">
                      Leave blank (0) to use all cores minus one automatically.
                      {systemCpuCount > 0 &&
                        ` Max recommended: ${systemCpuCount}.`}
                    </p>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Additional AgRowStitch Options (optional)</Label>
                  <Input
                    placeholder="Custom YAML overrides"
                    value={groundConfig.custom_agrowstitch_options}
                    onChange={(e) =>
                      setGroundConfig({
                        ...groundConfig,
                        custom_agrowstitch_options: e.target.value,
                      })
                    }
                  />
                </div>
              </>
            )}

            {/* Step 3: Roboflow models (optional) */}
            {currentStep === 3 && (
              <>
                <p className="text-muted-foreground text-sm">
                  Add one or more Roboflow models for inference on your plot
                  images. Leave empty to skip — you can configure and run
                  inference later from the run view.
                </p>

                <div className="space-y-3">
                  {/* Column headers */}
                  <div className="grid grid-cols-[1fr_1fr_1fr_auto_auto] gap-2">
                    <Label className="text-muted-foreground text-xs">
                      Name
                    </Label>
                    <Label className="text-muted-foreground text-xs">
                      API Key
                    </Label>
                    <Label className="text-muted-foreground text-xs">
                      Model ID
                    </Label>
                    <Label className="text-muted-foreground text-xs">
                      Task
                    </Label>
                    <span />
                  </div>

                  {roboflowModels.map((model, idx) => (
                    <div
                      key={idx}
                      className="grid grid-cols-[1fr_1fr_1fr_auto_auto] items-center gap-2"
                    >
                      <Input
                        placeholder="e.g. Wheat Detection"
                        value={model.label}
                        onChange={(e) =>
                          setRoboflowModels((prev) =>
                            prev.map((m, i) =>
                              i === idx ? { ...m, label: e.target.value } : m
                            )
                          )
                        }
                      />
                      <Input
                        type="password"
                        placeholder="rf_xxxxxxxxxxxx"
                        value={model.roboflow_api_key}
                        onChange={(e) =>
                          setRoboflowModels((prev) =>
                            prev.map((m, i) =>
                              i === idx ? { ...m, roboflow_api_key: e.target.value } : m
                            )
                          )
                        }
                      />
                      <Input
                        placeholder="my-project/3"
                        value={model.roboflow_model_id}
                        onChange={(e) =>
                          setRoboflowModels((prev) =>
                            prev.map((m, i) =>
                              i === idx ? { ...m, roboflow_model_id: e.target.value } : m
                            )
                          )
                        }
                      />
                      <Select
                        value={model.task_type}
                        onValueChange={(v: "detection" | "segmentation") =>
                          setRoboflowModels((prev) =>
                            prev.map((m, i) =>
                              i === idx ? { ...m, task_type: v } : m
                            )
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
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          setRoboflowModels((prev) =>
                            prev.filter((_, i) => i !== idx)
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

                {/* Inference mode */}
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
                        placeholder="http://localhost:9001"
                      />
                      <p className="text-xs text-muted-foreground">
                        The server will be auto-started if not already running.
                      </p>
                    </div>
                  )}
                </div>

                {/* Summary */}
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
                        <span className="text-muted-foreground">Quality:</span>
                        <span className="font-medium">
                          {ODM_PRESETS[aerialConfig.odm_preset].label}
                          {aerialConfig.odm_preset !== "custom" && ` · ${aerialConfig.orthophoto_resolution} cm/px`}
                        </span>
                      </div>
                    )}
                    {pipelineType === "ground" && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Device:</span>
                        <span className="font-medium">
                          {groundConfig.device === "multiprocessing"
                            ? `Multiprocessing (${groundConfig.num_cpu > 0 ? `${groundConfig.num_cpu} workers` : "auto"})`
                            : groundConfig.device.toUpperCase()}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Roboflow models:
                      </span>
                      <span className="font-medium">
                        {roboflowModels.filter((m) => m.roboflow_model_id.trim()).length > 0
                          ? roboflowModels
                              .filter((m) => m.roboflow_model_id.trim())
                              .map((m) => m.label || m.roboflow_model_id)
                              .join(", ")
                          : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Inference mode:</span>
                      <span className="font-medium capitalize">
                        {inferenceMode === "local" ? `Local (${localServerUrl})` : "Cloud"}
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Navigation */}
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
          <Button
            onClick={handleNext}
            disabled={!isStepComplete(currentStep) || saveMutation.isPending}
          >
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
  );
}
