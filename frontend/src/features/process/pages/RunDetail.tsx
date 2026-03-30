import {
  ArrowLeft,
  Check,
  Clock,
  AlertCircle,
  Loader2,
  Lock,
  ChevronDown,
  ChevronRight,
  FileText,
  Square,
  Download,
  Eye,
  TriangleAlert,
  Trash2,
  ImageIcon,
  Zap,
  Pencil,
  Settings,
  X,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  RefreshCw,
  FolderOpen,
} from "lucide-react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { subscribe } from "@/lib/sseManager";
import { downloadFile, openUrl } from "@/lib/platform";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ProcessingService,
  PipelinesService,
  SettingsService,
  UtilsService,
  type PipelineRunPublic,
  type PipelinePublic,
} from "@/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import useCustomToast from "@/hooks/useCustomToast";
import { useProcess } from "@/contexts/ProcessContext";
import {
  analyzeApi,
  versionLabel,
  type TraitRecord,
} from "@/features/analyze/api";

// Resolve a relative /api path to an absolute URL using the backend base
// injected by the Tauri sidecar, or fall back to a same-origin relative path.
function apiUrl(path: string): string {
  const base = (window as any).__GEMI_BACKEND_URL__ ?? "";
  return base ? `${base}${path}` : path;
}

/** Always returns a full http:// URL — for use with Rust/reqwest which needs absolute URLs. */
function absoluteApiUrl(path: string): string {
  const base = (window as any).__GEMI_BACKEND_URL__ ?? "http://127.0.0.1:8000";
  return path.startsWith("http") ? path : `${base}${path}`;
}

/** Download a URL — shows a native save dialog in Tauri, triggers browser download otherwise. */
async function tauriDownload(
  url: string,
  filename: string,
  method: "GET" | "POST" = "GET",
  filters?: { name: string; extensions: string[] }[]
): Promise<boolean> {
  return downloadFile(absoluteApiUrl(url), filename, method, filters);
}

// ── Step definitions ──────────────────────────────────────────────────────────

type StepKind = "interactive" | "compute" | "optional";

interface StepDef {
  key: string;
  label: string;
  description: string;
  kind: StepKind;
}

const GROUND_STEPS: StepDef[] = [
  {
    key: "data_sync",
    label: "Data Sync",
    description:
      "Extract GPS from image EXIF for accurate positioning. No platform log required — skipped automatically if not present.",
    kind: "compute",
  },
  {
    key: "plot_marking",
    label: "Plot Marking",
    description:
      "Navigate through raw images and mark the start and end frame for each plot row",
    kind: "interactive",
  },
  {
    key: "stitching",
    label: "Stitching",
    description:
      "AgRowStitch stitches images per plot into panoramic mosaics, then automatically georeferences and creates a combined mosaic",
    kind: "compute",
  },
  {
    key: "plot_boundary_prep",
    label: "Plot Boundary Prep",
    description:
      "Draw the outer field boundary, configure plot grid dimensions, and auto-generate plot polygons from field design",
    kind: "interactive",
  },
  {
    key: "associate_boundaries",
    label: "Associate Boundaries",
    description:
      "Match each stitched plot to its boundary polygon using GPS containment",
    kind: "compute",
  },
  {
    key: "inference",
    label: "Inference",
    description: "Roboflow detection/segmentation on plot images",
    kind: "interactive",
  },
];

const AERIAL_STEPS: StepDef[] = [
  {
    key: "data_sync",
    label: "Data Sync",
    description:
      "Extract GPS from image EXIF and sync with platform log for accurate positioning",
    kind: "compute",
  },
  {
    key: "gcp_selection",
    label: "GCP Selection",
    description:
      "Match drone images to ground control points, mark GCP pixels. Optional (highly recommended for a successful orthomosaic)",
    kind: "optional",
  },
  {
    key: "orthomosaic",
    label: "Orthomosaic Generation",
    description: "Run OpenDroneMap to create orthomosaic and DEM",
    kind: "compute",
  },
  {
    key: "plot_boundary_prep",
    label: "Plot Boundary Prep",
    description:
      "Draw the outer field boundary, configure plot grid dimensions, and auto-generate plot polygons from field design",
    kind: "interactive",
  },
  {
    key: "trait_extraction",
    label: "Initial Trait Extraction",
    description: "Extract vegetation fraction and height per plot",
    kind: "compute",
  },
  {
    key: "inference",
    label: "Inference",
    description: "Roboflow detection/segmentation on plot images",
    kind: "interactive",
  },
];

// ── SSE progress hook ─────────────────────────────────────────────────────────

interface ProgressEvent {
  event: string;
  step?: string;
  message?: string;
  index?: number;
  total?: number;
  progress?: number;
  outputs?: Record<string, string>;
}

// Module-level buffers — survive component unmounts so logs persist when
// the user navigates away and back.
const eventBuffer = new Map<string, ProgressEvent[]>();
const progressBuffer = new Map<string, number | null>();

function useStepProgress(runId: string, isRunning: boolean, onStepComplete?: (step: string) => void) {
  const [events, setEvents] = useState<ProgressEvent[]>(
    () => eventBuffer.get(runId) ?? []
  );
  const [lastProgress, setLastProgress] = useState<number | null>(
    () => progressBuffer.get(runId) ?? null
  );
  const queryClient = useQueryClient();
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!isRunning) {
      unsubRef.current?.();
      unsubRef.current = null;
      return;
    }

    // Subscribe via the module-level SSE manager so the connection
    // persists even if this component unmounts (user navigates away).
    const unsub = subscribe(runId, (evt) => {
      if (evt.event === "start") {
        eventBuffer.set(runId, [evt as ProgressEvent]);
        progressBuffer.set(runId, null);
        setEvents([evt as ProgressEvent]);
        setLastProgress(null);
      } else {
        const next = [...(eventBuffer.get(runId) ?? []), evt as ProgressEvent];
        eventBuffer.set(runId, next);
        setEvents(next);
      }

      if (typeof evt.progress === "number") {
        progressBuffer.set(runId, evt.progress);
        setLastProgress(evt.progress);
      }

      if (
        evt.event === "complete" ||
        evt.event === "error" ||
        evt.event === "cancelled"
      ) {
        queryClient.invalidateQueries({ queryKey: ["pipeline-runs", runId] });
        if (evt.event === "complete") {
          if (evt.step === "stitching") {
            queryClient.invalidateQueries({
              queryKey: ["stitch-outputs", runId],
            });
            queryClient.invalidateQueries({
              queryKey: ["stitch-versions", runId],
            });
            // Mosaic background + stitch version dropdown in PlotBoundaryPrep
            queryClient.invalidateQueries({
              queryKey: ["orthomosaic-info", runId],
            });
            queryClient.invalidateQueries({
              queryKey: ["auto-boundary", runId],
            });
            queryClient.invalidateQueries({
              queryKey: ["plot-boundaries", runId],
            });
            // Full refresh so the run card and all panels reflect the new state
            onStepComplete?.("stitching");
          }
          if (evt.step === "plot_boundary_prep") {
            queryClient.invalidateQueries({
              queryKey: ["orthomosaic-info", runId],
            });
            queryClient.invalidateQueries({
              queryKey: ["plot-boundaries", runId],
            });
          }
          if (evt.step === "orthomosaic") {
            queryClient.invalidateQueries({
              queryKey: ["orthomosaic-versions", runId],
            });
            queryClient.invalidateQueries({
              queryKey: ["orthomosaic-info", runId],
            });
          }
          if (evt.step === "trait_extraction") {
            queryClient.invalidateQueries({
              queryKey: ["trait-records-run", runId],
            });
            queryClient.invalidateQueries({ queryKey: ["trait-records"] });
          }
        }
      }
    });

    unsubRef.current = unsub;
    return () => {
      // Unregister this component's listener but leave the SSE connection
      // alive for ProcessContext (which has its own listener on the same connection).
      unsub();
      unsubRef.current = null;
    };
  }, [isRunning, runId, queryClient]);

  // Sync from buffer when remounting (isRunning=true but no new events yet)
  useEffect(() => {
    const buffered = eventBuffer.get(runId);
    if (buffered?.length) setEvents(buffered);
    const prog = progressBuffer.get(runId);
    if (prog != null) setLastProgress(prog);
  }, [runId]);

  const clearEvents = () => {
    eventBuffer.delete(runId);
    progressBuffer.delete(runId);
    setEvents([]);
    setLastProgress(null);
  };

  return { events, lastProgress, clearEvents };
}

// ── Step status helpers ───────────────────────────────────────────────────────

type StepStatus = "completed" | "running" | "failed" | "ready" | "locked";

function getStepStatus(
  stepKey: string,
  currentStep: string | null | undefined,
  stepsCompleted: Record<string, boolean> | null | undefined,
  runStatus: string
): StepStatus {
  // current_step takes priority — a re-run sets it even when steps_completed still shows true
  if (currentStep === stepKey) {
    return runStatus === "failed" ? "failed" : "running";
  }
  if (stepsCompleted?.[stepKey]) return "completed";
  return "locked";
}

function getNextStep(
  steps: StepDef[],
  stepsCompleted: Record<string, boolean> | null | undefined,
  runStatus: string
): string | null {
  if (runStatus === "running" || runStatus === "failed") return null;
  // Optional steps don't block the sequence — skip over them
  for (const step of steps) {
    if (!stepsCompleted?.[step.key] && step.kind !== "optional")
      return step.key;
  }
  return null;
}

function isOptionalReady(
  stepKey: string,
  steps: StepDef[],
  stepsCompleted: Record<string, boolean> | null | undefined
): boolean {
  const idx = steps.findIndex((s) => s.key === stepKey);
  // All preceding non-optional steps must be completed
  return steps
    .slice(0, idx)
    .filter((s) => s.kind !== "optional")
    .every((s) => stepsCompleted?.[s.key]);
}

// ── Progress log ──────────────────────────────────────────────────────────────

function ProgressLog({ events }: { events: ProgressEvent[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [showRaw, setShowRaw] = useState(false);

  const visibleEvents = showRaw
    ? events
    : events.filter((e) => e.event !== "log");

  useEffect(() => {
    ref.current?.scrollTo({
      top: ref.current.scrollHeight,
      behavior: "smooth",
    });
  }, [visibleEvents]);

  if (events.length === 0) return null;

  const hasLogs = events.some((e) => e.event === "log");

  return (
    <div className="mt-3 space-y-1">
      {hasLogs && (
        <button
          type="button"
          onClick={() => setShowRaw((v) => !v)}
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
        >
          <ChevronRight
            className={`h-3 w-3 transition-transform ${showRaw ? "rotate-90" : ""}`}
          />
          {showRaw ? "Hide" : "Show"} raw output
        </button>
      )}
      <div
        ref={ref}
        className="bg-muted/60 max-h-48 space-y-0.5 overflow-x-hidden overflow-y-auto rounded-md p-3 font-mono text-xs"
      >
        {visibleEvents.map((e, i) => (
          <div
            key={i}
            className={`break-all ${
              e.event === "error"
                ? "text-red-500"
                : e.event === "complete"
                  ? "text-green-500"
                  : e.event === "log"
                    ? "text-muted-foreground/60"
                    : "text-foreground"
            }`}
          >
            {e.event === "log"
              ? e.message
              : e.event === "progress"
                ? `▶ ${e.message}`
                : `[${e.event}] ${e.message ?? e.step ?? JSON.stringify(e)}`}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Step row ──────────────────────────────────────────────────────────────────

interface StepRowProps {
  step: StepDef;
  status: StepStatus;
  isNext: boolean;
  isLast: boolean;
  runId: string;
  runStatus: string;
  progressEvents: ProgressEvent[];
  lastProgress: number | null;
  onRunStep: (step: string) => void;
  onOpenTool: (step: string) => void;
  onStopStep: () => void;
  isExecuting: boolean;
  isStopping: boolean;
  isStarting?: boolean;
  warning?: string;
  extraContent?: React.ReactNode;
  extraButtons?: React.ReactNode;
  hideDefaultButton?: boolean;
}

// ── Shared confirm-delete dialog ──────────────────────────────────────────────

function ConfirmDeleteDialog({
  open,
  title,
  description,
  onConfirm,
  onCancel,
  isDeleting,
}: {
  open: boolean;
  title: string;
  description: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDeleting?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-1.5 h-4 w-4" />
            )}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Trait records panel (shown under Initial Trait Extraction) ────────────────

function TraitRecordsPanel({
  runId,
  onDelete,
  isDeleting,
}: {
  runId: string;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const { data: records = [], isLoading } = useQuery({
    queryKey: ["trait-records-run", runId],
    queryFn: () => analyzeApi.listTraitRecordsByRun(runId),
    staleTime: 30_000,
  });

  const { data: inferenceResults = [] } = useQuery<InferenceResult[]>({
    queryKey: ["inference-summary", runId],
    queryFn: async () => {
      const res = await fetch(
        apiUrl(`/api/v1/pipeline-runs/${runId}/inference-summary`)
      );
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });

  // Count inference results per trait version
  const inferenceCountByTraitVersion = inferenceResults.reduce<
    Record<number, number>
  >((acc, r) => {
    if (r.trait_version != null) {
      acc[r.trait_version] = (acc[r.trait_version] ?? 0) + 1;
    }
    return acc;
  }, {});

  if (isLoading) {
    return (
      <div className="text-muted-foreground mt-3 flex items-center gap-2 text-xs">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading trait records…
      </div>
    );
  }

  if (records.length === 0) return null;

  const confirmRecord = records.find((r: TraitRecord) => r.id === confirmId);

  return (
    <>
      <div className="mt-3 overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="text-xs">
              <TableHead className="w-10 py-2 text-xs">v</TableHead>
              <TableHead className="py-2 text-xs">Ortho / Stitch</TableHead>
              <TableHead className="py-2 text-xs">Boundary</TableHead>
              <TableHead className="py-2 text-right text-xs">Plots</TableHead>
              <TableHead className="py-2 text-right text-xs">
                Inferences
              </TableHead>
              <TableHead className="py-2 text-right text-xs">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map((r: TraitRecord) => (
              <TableRow key={r.id} className="text-xs">
                <TableCell className="text-muted-foreground py-1.5 font-mono">
                  v{r.version}
                </TableCell>
                <TableCell className="py-1.5 font-mono">
                  {r.pipeline_type === "ground"
                    ? versionLabel(r.stitch_version, r.stitch_name)
                    : versionLabel(r.ortho_version, r.ortho_name)}
                </TableCell>
                <TableCell className="py-1.5 font-mono">
                  {r.boundary_version != null
                    ? versionLabel(r.boundary_version, r.boundary_name)
                    : "default"}
                </TableCell>
                <TableCell className="py-1.5 text-right font-mono">
                  {r.plot_count}
                </TableCell>
                <TableCell className="py-1.5 text-right font-mono">
                  {inferenceCountByTraitVersion[r.version] ?? 0}
                </TableCell>
                <TableCell className="py-1.5 text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-red-500 hover:text-red-600"
                    disabled={isDeleting}
                    onClick={() => setConfirmId(r.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ConfirmDeleteDialog
        open={confirmId !== null}
        title="Delete trait record?"
        description={
          confirmRecord
            ? `This will permanently delete the traits GeoJSON for Ortho ${versionLabel(confirmRecord.ortho_version, confirmRecord.ortho_name)} / Boundary ${versionLabel(confirmRecord.boundary_version, confirmRecord.boundary_name)} (${confirmRecord.plot_count} plots). This cannot be undone.`
            : "This will permanently delete the trait record. This cannot be undone."
        }
        isDeleting={isDeleting}
        onConfirm={() => {
          if (confirmId) onDelete(confirmId);
          setConfirmId(null);
        }}
        onCancel={() => setConfirmId(null)}
      />
    </>
  );
}

// ── Ground: stitch outputs panel ──────────────────────────────────────────────

interface StitchPlot {
  name: string;
  url: string;
}

interface StitchVersion {
  version: number;
  name: string | null;
  dir: string;
  config: Record<string, any>;
  plot_count: number;
  created_at: string | null;
  plot_marking_version: number | null;
}

function StitchConfigDialog({
  open,
  onClose,
  version,
}: {
  open: boolean;
  onClose: () => void;
  version: StitchVersion | null;
}) {
  if (!version) return null;
  const label = version.name
    ? `${version.name} (v${version.version})`
    : `v${version.version}`;
  const config = version.config ?? {};
  const entries = Object.entries(config);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Config — {label}
          </DialogTitle>
          <DialogDescription>
            Parameters used for this stitching run
          </DialogDescription>
        </DialogHeader>
        <div className="bg-muted/40 max-h-96 overflow-y-auto rounded-md border p-3 font-mono text-xs">
          {entries.length === 0 ? (
            <span className="text-muted-foreground">No config recorded</span>
          ) : (
            entries.map(([k, v]) => (
              <div key={k} className="flex gap-2 py-0.5">
                <span className="text-muted-foreground min-w-[140px] shrink-0">
                  {k}
                </span>
                <span className="break-all">{JSON.stringify(v)}</span>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StitchImagesDialog({
  open,
  onClose,
  plots,
  versionLabel,
}: {
  open: boolean;
  onClose: () => void;
  plots: StitchPlot[];
  versionLabel: string;
}) {
  const [pageIndex, setPageIndex] = useState(0);
  const plot = plots[pageIndex];

  // Reset to first plot when dialog opens
  useEffect(() => {
    if (open) setPageIndex(0);
  }, [open]);

  if (!open || plots.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="p-3" style={{ maxWidth: "95vw", width: "95vw" }}>
        <DialogHeader className="px-1">
          <DialogTitle className="text-sm">
            {versionLabel} — {plots.length} plots
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <div className="text-muted-foreground flex items-center justify-between text-xs">
            <span className="font-mono">{plot?.name}</span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                disabled={pageIndex === 0}
                onClick={() => setPageIndex((p) => p - 1)}
              >
                <ChevronDown className="h-3.5 w-3.5 rotate-90" />
              </Button>
              <span className="w-16 text-center">
                {pageIndex + 1} / {plots.length}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                disabled={pageIndex === plots.length - 1}
                onClick={() => setPageIndex((p) => p + 1)}
              >
                <ChevronDown className="h-3.5 w-3.5 -rotate-90" />
              </Button>
            </div>
          </div>
          {plot && (
            <ZoomableImage
              key={plot.url}
              src={apiUrl(plot.url)}
              alt={plot.name}
              maxHeight="calc(90vh - 100px)"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StitchPanel({
  runId,
  isRunning,
  onDelete,
  onRename,
  isDeleting,
}: {
  runId: string;
  isRunning: boolean;
  onDelete: (version: number) => void;
  onRename: (version: number, name: string | null) => void;
  isDeleting: boolean;
}) {
  const [pageIndex, setPageIndex] = useState(0);
  // When the user manually navigates, stop auto-advancing to the latest plot
  const [userBrowsing, setUserBrowsing] = useState(false);
  const [viewingConfig, setViewingConfig] = useState<StitchVersion | null>(
    null
  );
  const [viewingImages, setViewingImages] = useState<{
    version: StitchVersion;
    plots: StitchPlot[];
  } | null>(null);
  const [editingVersion, setEditingVersion] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [confirmDeleteVersion, setConfirmDeleteVersion] = useState<
    number | null
  >(null);
  const [downloadingVersion, setDownloadingVersion] = useState<number | null>(
    null
  );
  const [downloadDialog, setDownloadDialog] = useState<{
    stitch: StitchVersion;
    selectedAssocVersion: number | null;
  } | null>(null);

  // Plot marking versions (for displaying marker label in the stitch table)
  const { data: plotMarkings = [] } = useQuery<{ version: number; name: string }[]>({
    queryKey: ["plot-markings", runId],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/plot-markings`), {
        headers: { Authorization: `Bearer ${localStorage.getItem("access_token") || ""}` },
      });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });

  // Associations (for download naming)
  const { data: associations = [] } = useQuery<AssociationVersion[]>({
    queryKey: ["associations", runId],
    queryFn: async () => {
      const res = await fetch(
        apiUrl(`/api/v1/pipeline-runs/${runId}/associations`)
      );
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });

  // Live plots during run (polled every 5s)
  const { data: liveData } = useQuery<{ plots: StitchPlot[]; version: number }>(
    {
      queryKey: ["stitch-outputs", runId],
      queryFn: async () => {
        const res = await fetch(
          apiUrl(`/api/v1/pipeline-runs/${runId}/stitch-outputs`)
        );
        if (!res.ok) return { plots: [], version: 1 };
        return res.json();
      },
      staleTime: 0,
      refetchInterval: isRunning ? 5_000 : false,
    }
  );

  // Completed versions (after run)
  const { data: versions = [], isLoading: versionsLoading } = useQuery<
    StitchVersion[]
  >({
    queryKey: ["stitch-versions", runId],
    queryFn: async () => {
      const res = await fetch(
        apiUrl(`/api/v1/pipeline-runs/${runId}/stitchings`)
      );
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });

  // When a new run starts: immediately wipe the stale cache so old plots don't
  // flash, then trigger a fresh fetch right away rather than waiting for the
  // next 5-second interval tick.
  const queryClient = useQueryClient();
  useEffect(() => {
    if (isRunning) {
      queryClient.setQueryData(["stitch-outputs", runId], { plots: [], version: 0 });
      queryClient.refetchQueries({ queryKey: ["stitch-outputs", runId] });
      setPageIndex(0);
      setUserBrowsing(false);
    }
  }, [isRunning, runId, queryClient]);

  const livePlots = liveData?.plots ?? [];
  useEffect(() => {
    if (isRunning && livePlots.length > 0 && !userBrowsing) {
      setPageIndex(livePlots.length - 1);
    }
  }, [isRunning, livePlots.length, userBrowsing]);

  // When run finishes, reset browsing lock so the next run starts at latest
  useEffect(() => {
    if (!isRunning) setUserBrowsing(false);
  }, [isRunning]);

  // Fetch images for a specific version to show in dialog.
  // Append a cache-bust timestamp so the browser doesn't serve stale images
  // from a previous stitch run that wrote to the same file paths.
  async function viewVersionImages(v: StitchVersion) {
    const res = await fetch(
      apiUrl(`/api/v1/pipeline-runs/${runId}/stitch-outputs?version=${v.version}`)
    );
    const data = res.ok ? await res.json() : { plots: [] };
    const ts = Date.now();
    const plots = (data.plots ?? []).map((p: StitchPlot) => ({
      ...p,
      url: `${p.url}${p.url.includes("?") ? "&" : "?"}t=${ts}`,
    }));
    setViewingImages({ version: v, plots });
  }

  function startRename(v: StitchVersion) {
    setEditingVersion(v.version);
    setEditingName(v.name ?? "");
  }

  function commitRename() {
    if (editingVersion !== null) {
      onRename(editingVersion, editingName.trim() || null);
    }
    setEditingVersion(null);
  }

  function openDownloadDialog(v: StitchVersion) {
    // Default to latest association matching this stitch version
    const matching = associations
      .filter((a) => a.stitch_version === v.version)
      .sort((a, b) => a.version - b.version);
    const defaultAssoc =
      matching.length > 0 ? matching[matching.length - 1].version : null;
    setDownloadDialog({ stitch: v, selectedAssocVersion: defaultAssoc });
  }

  async function confirmDownload() {
    if (!downloadDialog) return;
    const { stitch, selectedAssocVersion } = downloadDialog;
    setDownloadDialog(null);
    setDownloadingVersion(stitch.version);
    const label = stitch.name
      ? `${stitch.name}_v${stitch.version}`
      : `v${stitch.version}`;
    const assocParam =
      selectedAssocVersion != null
        ? `?association_version=${selectedAssocVersion}`
        : "";
    await tauriDownload(
      `/api/v1/pipeline-runs/${runId}/stitchings/${stitch.version}/download${assocParam}`,
      `stitching_${label}.zip`,
      "GET",
      [{ name: "ZIP Archive", extensions: ["zip"] }]
    );
    setDownloadingVersion(null);
  }

  // ── During run: page viewer ────────────────────────────────────────────────

  if (isRunning) {
    if (livePlots.length === 0) {
      return (
        <div className="text-muted-foreground mt-3 text-xs">
          Stitching in progress — plots will appear here as they complete.
        </div>
      );
    }
    const plot = livePlots[pageIndex] ?? livePlots[livePlots.length - 1];
    return (
      <div className="mt-3 space-y-2">
        <div className="text-muted-foreground flex items-center justify-between text-xs">
          <span>
            {livePlots.length} plot{livePlots.length !== 1 ? "s" : ""} stitched
            · v{liveData?.version ?? 1}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={pageIndex === 0}
              onClick={() => { setUserBrowsing(true); setPageIndex((p) => p - 1); }}
            >
              <ChevronDown className="h-3.5 w-3.5 rotate-90" />
            </Button>
            <span className="w-16 text-center">
              {pageIndex + 1} / {livePlots.length}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={pageIndex === livePlots.length - 1}
              onClick={() => {
                const next = pageIndex + 1;
                setPageIndex(next);
                // Re-enable auto-advance if the user scrolled back to the latest
                if (next >= livePlots.length - 1) setUserBrowsing(false);
                else setUserBrowsing(true);
              }}
            >
              <ChevronDown className="h-3.5 w-3.5 -rotate-90" />
            </Button>
            {userBrowsing && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={() => { setUserBrowsing(false); setPageIndex(livePlots.length - 1); }}
              >
                Latest
              </Button>
            )}
          </div>
        </div>
        <img
          src={apiUrl(plot.url)}
          alt={plot.name}
          className="w-full rounded border"
        />
        <p className="text-muted-foreground font-mono text-xs">{plot.name}</p>
      </div>
    );
  }

  // ── After run: version table ───────────────────────────────────────────────

  if (versionsLoading) {
    return (
      <div className="text-muted-foreground mt-3 flex items-center gap-2 text-xs">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading stitching versions…
      </div>
    );
  }

  if (versions.length === 0) return null;

  const confirmDeleteEntry = versions.find(
    (v) => v.version === confirmDeleteVersion
  );

  return (
    <>
      <div className="mt-3 overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="py-2 text-xs">Version</TableHead>
              <TableHead className="py-2 text-right text-xs">Plots</TableHead>
              <TableHead className="py-2 text-xs">Markers</TableHead>
              <TableHead className="py-2 text-xs">Created</TableHead>
              <TableHead className="py-2 text-right text-xs">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {versions.map((v) => (
              <TableRow key={v.version} className="text-xs">
                <TableCell className="py-1.5">
                  {editingVersion === v.version ? (
                    <div className="flex items-center gap-1">
                      <Input
                        className="h-7 w-32 text-xs"
                        value={editingName}
                        autoFocus
                        placeholder={`v${v.version}`}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") setEditingVersion(null);
                        }}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={commitRename}
                      >
                        <Check className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => setEditingVersion(null)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <button
                      className="flex items-center gap-1 hover:underline"
                      onClick={() => startRename(v)}
                      title="Click to rename"
                    >
                      <span className="font-medium">
                        {v.name ?? `v${v.version}`}
                      </span>
                      {v.name && (
                        <span className="text-muted-foreground">
                          v{v.version}
                        </span>
                      )}
                    </button>
                  )}
                </TableCell>
                <TableCell className="py-1.5 text-right font-mono">
                  {v.plot_count}
                </TableCell>
                <TableCell className="py-1.5 text-muted-foreground text-xs">
                  {v.plot_marking_version != null ? (() => {
                    const pm = plotMarkings.find((m) => m.version === v.plot_marking_version);
                    return pm?.name ? `${pm.name} (v${v.plot_marking_version})` : `v${v.plot_marking_version}`;
                  })() : "—"}
                </TableCell>
                <TableCell className="text-muted-foreground py-1.5">
                  {v.created_at ? new Date(v.created_at).toLocaleString() : "—"}
                </TableCell>
                <TableCell className="py-1.5 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      title="View config"
                      onClick={() => setViewingConfig(v)}
                    >
                      <FileText className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      title="View plots"
                      onClick={() => viewVersionImages(v)}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      title="Download plots as ZIP"
                      disabled={downloadingVersion === v.version}
                      onClick={() => openDownloadDialog(v)}
                    >
                      {downloadingVersion === v.version ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive h-6 w-6"
                      title="Delete"
                      disabled={isDeleting}
                      onClick={() => setConfirmDeleteVersion(v.version)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <StitchConfigDialog
        open={viewingConfig !== null}
        onClose={() => setViewingConfig(null)}
        version={viewingConfig}
      />

      <StitchImagesDialog
        open={viewingImages !== null}
        onClose={() => setViewingImages(null)}
        plots={viewingImages?.plots ?? []}
        versionLabel={
          viewingImages?.version.name
            ? `${viewingImages.version.name} (v${viewingImages.version.version})`
            : `v${viewingImages?.version.version}`
        }
      />

      <ConfirmDeleteDialog
        open={confirmDeleteVersion !== null}
        title="Delete stitching version?"
        description={
          confirmDeleteEntry
            ? `Delete stitching ${confirmDeleteEntry.name ? `"${confirmDeleteEntry.name}" (v${confirmDeleteEntry.version})` : `v${confirmDeleteEntry.version}`} and its ${confirmDeleteEntry.plot_count} plot image${confirmDeleteEntry.plot_count !== 1 ? "s" : ""}? This cannot be undone.`
            : "Delete this stitching version? This cannot be undone."
        }
        isDeleting={isDeleting}
        onConfirm={() => {
          if (confirmDeleteVersion !== null) onDelete(confirmDeleteVersion);
          setConfirmDeleteVersion(null);
        }}
        onCancel={() => setConfirmDeleteVersion(null)}
      />

      {/* Download association selection dialog */}
      <Dialog
        open={downloadDialog !== null}
        onOpenChange={(o) => !o && setDownloadDialog(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Download Stitching{" "}
              {downloadDialog?.stitch.name
                ? `"${downloadDialog.stitch.name}" (v${downloadDialog.stitch.version})`
                : `v${downloadDialog?.stitch.version}`}
            </DialogTitle>
            <DialogDescription>
              Select which association version to use for file naming.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {(() => {
              const sv = downloadDialog?.stitch.version;
              const matching = associations.filter(
                (a) => a.stitch_version === sv
              );
              const others = associations.filter(
                (a) => a.stitch_version !== sv
              );
              const allOptions = [
                ...matching.sort((a, b) => b.version - a.version),
                ...others.sort((a, b) => b.version - a.version),
              ];
              if (allOptions.length === 0) {
                return (
                  <p className="text-muted-foreground text-xs">
                    No association versions found. Images will be named by plot
                    index.
                  </p>
                );
              }
              return (
                <div className="space-y-1">
                  <Label className="text-xs">Association Version</Label>
                  <select
                    className="border-input bg-background w-full rounded border px-2 py-1.5 text-sm"
                    value={downloadDialog?.selectedAssocVersion ?? ""}
                    onChange={(e) =>
                      setDownloadDialog((d) =>
                        d
                          ? {
                              ...d,
                              selectedAssocVersion: e.target.value
                                ? Number(e.target.value)
                                : null,
                            }
                          : d
                      )
                    }
                  >
                    <option value="">None (use plot index only)</option>
                    {allOptions.map((a) => {
                      const isMatch = a.stitch_version === sv;
                      const label = `v${a.version} — stitch v${a.stitch_version ?? "?"} · boundary v${a.boundary_version ?? "?"}${isMatch ? " ✓" : ""}`;
                      return (
                        <option key={a.version} value={a.version}>
                          {label}
                        </option>
                      );
                    })}
                  </select>
                  {matching.length === 0 && (
                    <p className="text-xs text-amber-600">
                      No association matches stitch v{sv}. Using a different
                      version may produce incorrect names.
                    </p>
                  )}
                </div>
              );
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDownloadDialog(null)}>
              Cancel
            </Button>
            <Button onClick={confirmDownload}>Download</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Ground inference results panel ────────────────────────────────────────────

interface InferenceResult {
  label: string;
  csv_rel_path: string;
  stitch_version: number | null;
  association_version: number | null;
  trait_version: number | null;
  created_at: string | null;
  plot_count: number;
  total_predictions: number;
  classes: Record<string, number>;
}

function GroundInferencePanel({
  runId,
  onDelete,
  isDeleting,
}: {
  runId: string;
  onDelete: (label: string) => void;
  isDeleting: boolean;
}) {
  const [confirmLabel, setConfirmLabel] = useState<string | null>(null);

  const { data: results = [], isLoading } = useQuery<InferenceResult[]>({
    queryKey: ["inference-summary", runId],
    queryFn: async () => {
      const res = await fetch(
        apiUrl(`/api/v1/pipeline-runs/${runId}/inference-summary`)
      );
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : (data?.results ?? []);
    },
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="text-muted-foreground mt-3 flex items-center gap-2 text-xs">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading inference results…
      </div>
    );
  }

  if (results.length === 0) return null;

  return (
    <>
      <div className="mt-3 overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="py-2 text-xs">Label</TableHead>
              <TableHead className="py-2 text-xs">Stitch</TableHead>
              <TableHead className="py-2 text-xs">Assoc</TableHead>
              <TableHead className="py-2 text-right text-xs">Plots</TableHead>
              <TableHead className="py-2 text-right text-xs">
                Predictions
              </TableHead>
              <TableHead className="py-2 text-xs">Classes</TableHead>
              <TableHead className="py-2 text-right text-xs">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {results.map((r) => (
              <TableRow key={r.label} className="text-xs">
                <TableCell className="py-2 font-medium">{r.label}</TableCell>
                <TableCell className="text-muted-foreground py-2 font-mono">
                  {r.stitch_version != null ? `v${r.stitch_version}` : "—"}
                </TableCell>
                <TableCell className="text-muted-foreground py-2 font-mono">
                  {r.association_version != null
                    ? `v${r.association_version}`
                    : "—"}
                </TableCell>
                <TableCell className="py-2 text-right">
                  {r.plot_count}
                </TableCell>
                <TableCell className="py-2 text-right">
                  {r.total_predictions}
                </TableCell>
                <TableCell className="py-2">
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(r.classes).map(([cls, count]) => (
                      <Badge
                        key={cls}
                        variant="outline"
                        className="px-1 py-0 text-[10px]"
                      >
                        {cls}: {count}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="py-2 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      title="Download CSV"
                      onClick={() =>
                        tauriDownload(
                          `/api/v1/files/serve?path=${encodeURIComponent(r.csv_rel_path)}`,
                          `${r.label}_predictions.csv`,
                          "GET",
                          [{ name: "CSV", extensions: ["csv"] }]
                        )
                      }
                    >
                      <Download className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive h-6 w-6"
                      title="Delete"
                      disabled={isDeleting}
                      onClick={() => setConfirmLabel(r.label)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ConfirmDeleteDialog
        open={!!confirmLabel}
        title="Delete inference results"
        description={`Delete inference results for "${confirmLabel}"? This will remove the predictions CSV.`}
        isDeleting={isDeleting}
        onConfirm={() => {
          if (confirmLabel) onDelete(confirmLabel);
          setConfirmLabel(null);
        }}
        onCancel={() => setConfirmLabel(null)}
      />
    </>
  );
}

// ── Ground: plot marking versions panel ──────────────────────────────────────

function PlotMarkingVersionsPanel({
  runId,
  onDelete,
  isDeleting,
}: {
  runId: string;
  onDelete: (version: number) => void;
  isDeleting: boolean;
}) {
  const queryClient = useQueryClient();
  const [confirmDeleteVersion, setConfirmDeleteVersion] = useState<number | null>(null);
  const [renamingVersion, setRenamingVersion] = useState<number | null>(null);
  const [renameInput, setRenameInput] = useState("");

  const { data: versions = [], isLoading } = useQuery<{ version: number; name: string; created_at: string; run_label: string; is_active: boolean }[]>({
    queryKey: ["plot-markings", runId],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/plot-markings`), {
        headers: { Authorization: `Bearer ${localStorage.getItem("access_token") || ""}` },
      });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });

  function startRename(v: { version: number; name: string }) {
    setRenamingVersion(v.version);
    setRenameInput(v.name ?? "");
  }

  async function confirmRename(version: number) {
    await fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/plot-markings/${version}/rename`), {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
      },
      body: JSON.stringify({ name: renameInput }),
    });
    setRenamingVersion(null);
    queryClient.invalidateQueries({ queryKey: ["plot-markings", runId] });
  }

  if (isLoading) {
    return (
      <div className="text-muted-foreground mt-3 flex items-center gap-2 text-xs">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading plot marking versions…
      </div>
    );
  }

  if (versions.length === 0) return null;

  return (
    <>
      <div className="mt-3 overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="py-2 text-xs">Version</TableHead>
              <TableHead className="py-2 text-xs">Dataset</TableHead>
              <TableHead className="py-2 text-xs">Created</TableHead>
              <TableHead className="py-2 text-right text-xs">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {versions.map((v) => (
              <TableRow key={v.version} className="text-xs">
                <TableCell className="py-1.5">
                  {renamingVersion === v.version ? (
                    <div className="flex items-center gap-1">
                      <input
                        className="border rounded px-1.5 py-0.5 text-xs w-32"
                        value={renameInput}
                        onChange={(e) => setRenameInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") confirmRename(v.version);
                          if (e.key === "Escape") setRenamingVersion(null);
                        }}
                        autoFocus
                      />
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => confirmRename(v.version)}>
                        <Check className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setRenamingVersion(null)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <button
                      className="flex items-center gap-1 hover:underline"
                      onClick={() => startRename(v)}
                      title="Click to rename"
                    >
                      <span className="font-medium">{v.name || `v${v.version}`}</span>
                      {v.name && <span className="text-muted-foreground">v{v.version}</span>}
                    </button>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground py-1.5 text-xs max-w-[200px] truncate">
                  {v.run_label || "—"}
                </TableCell>
                <TableCell className="text-muted-foreground py-1.5">
                  {v.created_at ? new Date(v.created_at).toLocaleString() : "—"}
                </TableCell>
                <TableCell className="py-1.5 text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-red-500 hover:text-red-600"
                    disabled={isDeleting || versions.length <= 1}
                    title={versions.length <= 1 ? "Cannot delete the only version" : "Delete version"}
                    onClick={() => setConfirmDeleteVersion(v.version)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ConfirmDeleteDialog
        open={confirmDeleteVersion !== null}
        title="Delete plot marking version?"
        description={`Delete plot marking v${confirmDeleteVersion ?? ""}? This cannot be undone.`}
        isDeleting={isDeleting}
        onConfirm={() => {
          if (confirmDeleteVersion !== null) onDelete(confirmDeleteVersion);
          setConfirmDeleteVersion(null);
        }}
        onCancel={() => setConfirmDeleteVersion(null)}
      />
    </>
  );
}

// ── Ground: association versions panel ───────────────────────────────────────

interface AssociationVersion {
  version: number;
  stitch_version: number | null;
  boundary_version: number | null;
  association_path: string;
  matched: number;
  total: number;
  created_at: string | null;
}

function AssociationVersionsPanel({
  runId,
  stitchVersions,
  boundaryVersions,
  onDelete,
  isDeleting,
}: {
  runId: string;
  stitchVersions: StitchVersion[];
  boundaryVersions: PlotBoundaryVersion[];
  onDelete: (version: number) => void;
  isDeleting: boolean;
}) {
  const [confirmDeleteVersion, setConfirmDeleteVersion] = useState<
    number | null
  >(null);

  const { data: versions = [], isLoading } = useQuery<AssociationVersion[]>({
    queryKey: ["associations", runId],
    queryFn: async () => {
      const res = await fetch(
        apiUrl(`/api/v1/pipeline-runs/${runId}/associations`)
      );
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="text-muted-foreground mt-3 flex items-center gap-2 text-xs">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading associations…
      </div>
    );
  }

  if (versions.length === 0) return null;

  const confirmEntry = versions.find((v) => v.version === confirmDeleteVersion);

  function stitchLabel(sv: number | null) {
    if (sv === null) return "—";
    const entry = stitchVersions.find((s) => s.version === sv);
    return entry?.name ? `${entry.name} (v${sv})` : `v${sv}`;
  }

  function boundaryLabel(bv: number | null) {
    if (bv === null) return "—";
    const entry = boundaryVersions.find((b) => b.version === bv);
    return entry?.name ? `${entry.name} (v${bv})` : `v${bv}`;
  }

  return (
    <>
      <div className="mt-3 overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="py-2 text-xs">Version</TableHead>
              <TableHead className="py-2 text-xs">Stitch Used</TableHead>
              <TableHead className="py-2 text-xs">Boundary Used</TableHead>
              <TableHead className="py-2 text-right text-xs">Matched</TableHead>
              <TableHead className="py-2 text-xs">Created</TableHead>
              <TableHead className="py-2 text-right text-xs">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {versions.map((v) => (
              <TableRow key={v.version} className="text-xs">
                <TableCell className="py-1.5 font-medium">
                  v{v.version}
                </TableCell>
                <TableCell className="text-muted-foreground py-1.5 font-mono">
                  {stitchLabel(v.stitch_version)}
                </TableCell>
                <TableCell className="text-muted-foreground py-1.5 font-mono">
                  {boundaryLabel(v.boundary_version)}
                </TableCell>
                <TableCell className="py-1.5 text-right font-mono">
                  {v.matched}/{v.total}
                </TableCell>
                <TableCell className="text-muted-foreground py-1.5">
                  {v.created_at ? new Date(v.created_at).toLocaleString() : "—"}
                </TableCell>
                <TableCell className="py-1.5 text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive h-6 w-6"
                    title="Delete"
                    disabled={isDeleting}
                    onClick={() => setConfirmDeleteVersion(v.version)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ConfirmDeleteDialog
        open={confirmDeleteVersion !== null}
        title="Delete association version?"
        description={
          confirmEntry
            ? `Delete association v${confirmEntry.version} (${confirmEntry.matched}/${confirmEntry.total} plots matched)? The CSV file will be removed.`
            : "Delete this association version?"
        }
        isDeleting={isDeleting}
        onConfirm={() => {
          if (confirmDeleteVersion !== null) onDelete(confirmDeleteVersion);
          setConfirmDeleteVersion(null);
        }}
        onCancel={() => setConfirmDeleteVersion(null)}
      />
    </>
  );
}

function StepRow({
  step,
  status,
  isNext,
  isLast,
  progressEvents,
  lastProgress,
  onRunStep,
  onOpenTool,
  onStopStep,
  isExecuting,
  isStopping,
  isStarting = false,
  warning,
  extraContent,
  extraButtons,
  hideDefaultButton,
}: StepRowProps) {
  const [expanded, setExpanded] = useState(false);

  // Only show progress events relevant to this step
  const stepEvents = progressEvents.filter(
    (e) => !e.step || e.step === step.key
  );

  const iconEl = (() => {
    switch (status) {
      case "completed":
        return <Check className="h-5 w-5 text-green-600" />;
      case "running":
        return <Loader2 className="h-5 w-5 animate-spin text-blue-600" />;
      case "failed":
        return <AlertCircle className="h-5 w-5 text-red-600" />;
      case "ready":
        return <Clock className="text-primary h-5 w-5" />;
      default:
        return <Lock className="text-muted-foreground h-5 w-5" />;
    }
  })();

  const circleCls = {
    completed: "border-green-500 bg-green-500/10",
    running: "border-blue-500 bg-blue-500/10",
    failed: "border-red-500 bg-red-500/10",
    ready: "border-primary bg-primary/10",
    locked: "border-border bg-muted/30",
  }[status];

  const isActive = status === "running";
  const canRun =
    (status === "ready" || status === "completed" || status === "failed") &&
    !isExecuting;
  const isInteractive = step.kind === "interactive" || step.kind === "optional";

  const actionLabel = (() => {
    if (isActive) return isStopping ? "Stopping…" : "Running…";
    if (status === "completed")
      return isInteractive ? "Re-open Tool" : "Re-run";
    if (isInteractive) return "Open Tool";
    return "Run Step";
  })();

  return (
    <div className="relative">
      {!isLast && (
        <div className="bg-border absolute top-[52px] bottom-0 left-[23px] w-0.5" />
      )}
      <div className="flex gap-4">
        <div
          className={`relative z-10 flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border-2 ${circleCls}`}
        >
          {iconEl}
        </div>

        <div className="min-w-0 flex-1 pb-6">
          <div className="flex items-start justify-between gap-2 pt-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`font-medium ${status === "locked" ? "text-muted-foreground" : ""}`}
              >
                {step.label}
              </span>
              {step.kind === "optional" && (
                <Badge
                  variant="outline"
                  className="text-muted-foreground text-xs"
                >
                  optional
                </Badge>
              )}
              {step.kind === "interactive" && (
                <Badge variant="outline" className="text-xs">
                  interactive
                </Badge>
              )}
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              {extraButtons}
              {isActive && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onStopStep}
                  disabled={isStopping}
                >
                  <Square className="mr-1 h-3 w-3" />
                  Stop
                </Button>
              )}
              {!hideDefaultButton && (
                <Button
                  variant={status === "completed" ? "outline" : "default"}
                  size="sm"
                  disabled={
                    status === "locked" || isActive || (isExecuting && !isActive)
                  }
                  title={warning}
                  onClick={() => {
                    if (isInteractive) onOpenTool(step.key);
                    else if (canRun) onRunStep(step.key);
                  }}
                >
                  {isActive && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  {warning && !isActive && (
                    <TriangleAlert className="mr-1 h-3.5 w-3.5 text-amber-500" />
                  )}
                  {actionLabel}
                </Button>
              )}
              {status === "completed" && (
                <Button
                  variant="ghost"
                  size="icon"
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
            className={`mt-0.5 text-sm ${status === "locked" ? "text-muted-foreground/60" : "text-muted-foreground"}`}
          >
            {step.description}
          </p>

          {isNext && status !== "completed" && !isActive && (
            <p className="text-primary mt-1 text-xs">Ready to start</p>
          )}

          {/* Live progress for running step, or persisted log for failed step */}
          {(isActive || isStarting || status === "failed") && (
            <div className="mt-2 overflow-hidden">
              {(isActive || isStarting) && lastProgress !== null && (
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

          {/* Completed step log (collapsible) */}
          {expanded && status === "completed" && stepEvents.length > 0 && (
            <ProgressLog events={stepEvents} />
          )}

          {/* Extra inline content — always visible when provided */}
          {extraContent && <div>{extraContent}</div>}
        </div>
      </div>
    </div>
  );
}

// ── Zoomable image component ─────────────────────────────────────────────────

function ZoomableImage({
  src,
  alt,
  onLoad,
  maxHeight = "60vh",
}: {
  src: string;
  alt: string;
  onLoad?: () => void;
  maxHeight?: string;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  function clampPan(z: number, px: number, py: number) {
    // Allow panning only within image bounds
    const maxPan = ((z - 1) / 2) * 100;
    return {
      x: Math.max(-maxPan, Math.min(maxPan, px)),
      y: Math.max(-maxPan, Math.min(maxPan, py)),
    };
  }

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    setZoom((prev) => {
      const next = Math.max(
        1,
        Math.min(8, prev * (e.deltaY < 0 ? 1.15 : 1 / 1.15))
      );
      if (next === 1) setPan({ x: 0, y: 0 });
      else setPan((p) => clampPan(next, p.x, p.y));
      return next;
    });
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (zoom <= 1) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    e.preventDefault();
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    const container = containerRef.current;
    const w = container?.clientWidth ?? 600;
    const h = container?.clientHeight ?? 400;
    const newPan = clampPan(
      zoom,
      dragRef.current.panX + (dx / w) * 100,
      dragRef.current.panY + (dy / h) * 100
    );
    setPan(newPan);
  }

  function handleMouseUp() {
    dragRef.current = null;
  }

  function reset() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  return (
    <div className="space-y-1.5">
      {/* Zoom controls */}
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-7 p-0"
          onClick={() =>
            setZoom((z) => {
              const next = Math.min(8, z * 1.5);
              setPan((p) => clampPan(next, p.x, p.y));
              return next;
            })
          }
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-7 p-0"
          onClick={() =>
            setZoom((z) => {
              const next = Math.max(1, z / 1.5);
              if (next === 1) setPan({ x: 0, y: 0 });
              else setPan((p) => clampPan(next, p.x, p.y));
              return next;
            })
          }
          disabled={zoom <= 1}
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <span className="text-muted-foreground text-xs tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        {zoom > 1 && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={reset}
          >
            <RotateCcw className="mr-1 h-3 w-3" />
            Reset
          </Button>
        )}
        <span className="text-muted-foreground ml-auto text-xs">
          Scroll or use buttons to zoom · Drag to pan
        </span>
      </div>
      {/* Image container */}
      <div
        ref={containerRef}
        className="bg-muted/40 overflow-hidden rounded-lg border"
        style={{ maxHeight, cursor: zoom > 1 ? "grab" : "default" }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <img
          src={src}
          alt={alt}
          className="w-full object-contain select-none"
          style={{
            maxHeight,
            transform: `scale(${zoom}) translate(${pan.x / zoom}%, ${pan.y / zoom}%)`,
            transformOrigin: "center center",
            transition: dragRef.current ? "none" : "transform 0.1s ease",
            pointerEvents: "none",
          }}
          draggable={false}
          onLoad={onLoad}
        />
      </div>
    </div>
  );
}

// ── Orthomosaic version viewer + inline panel ────────────────────────────────

interface OrthoVersion {
  version: number;
  name: string | null;
  rgb: string | null;
  dem: string | null;
  pyramid: string | null;
  created_at: string | null;
  active: boolean;
  has_crops: boolean;
}

interface PlotBoundaryVersion {
  version: number;
  name: string | null;
  geojson_path: string;
  ortho_version: number | null;
  stitch_version: number | null;
  created_at: string | null;
  active: boolean;
  run_meta?: {
    experiment?: string;
    location?: string;
    population?: string;
    platform?: string;
    sensor?: string;
    date?: string;
    stitch_version?: number | null;
    ortho_version?: number | null;
  } | null;
}

function OrthoViewerDialog({
  open,
  onClose,
  runId,
  version,
}: {
  open: boolean;
  onClose: () => void;
  runId: string;
  version: OrthoVersion | null;
}) {
  const [highResLoaded, setHighResLoaded] = useState(false);
  const [highResLoading, setHighResLoading] = useState(false);

  if (!version) return null;
  const v = version; // narrowed non-null reference for use in callbacks

  const previewUrl = apiUrl(
    `/api/v1/pipeline-runs/${runId}/orthomosaics/${version.version}/preview?max_size=2000`
  );
  const highResUrl = apiUrl(
    `/api/v1/pipeline-runs/${runId}/orthomosaics/${version.version}/preview?max_size=8000`
  );

  function downloadTif() {
    const rel = v.rgb;
    if (!rel) return;
    const url = apiUrl(
      `/api/v1/files/serve?path=${encodeURIComponent(rel)}&download=1`
    );
    const filename = rel.split("/").pop() ?? `ortho_v${v.version}.tif`;
    tauriDownload(url, filename, "GET", [
      { name: "GeoTIFF", extensions: ["tif", "tiff"] },
    ]);
  }

  function downloadJpeg(hires = false) {
    const url = hires ? highResUrl : previewUrl;
    const filename = `ortho_v${v.version}${hires ? "_hires" : "_preview"}.jpg`;
    tauriDownload(url, filename, "GET", [
      { name: "JPEG Image", extensions: ["jpg", "jpeg"] },
    ]);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {version.name ? version.name : `Orthomosaic v${version.version}`}
            {version.name && (
              <span className="text-muted-foreground ml-2 text-sm font-normal">
                v{version.version}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {version.created_at
              ? `Generated ${new Date(version.created_at).toLocaleString()}`
              : "Orthomosaic preview"}
            {version.active && " · Active version"}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="preview">
          <div className="flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="preview">
                <ImageIcon className="mr-1.5 h-3.5 w-3.5" />
                Preview
              </TabsTrigger>
              <TabsTrigger value="hires">
                <Zap className="mr-1.5 h-3.5 w-3.5" />
                High-res
              </TabsTrigger>
            </TabsList>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadJpeg(false)}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" />
                JPEG
              </Button>
              {version.rgb && (
                <Button variant="outline" size="sm" onClick={downloadTif}>
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  GeoTIFF
                </Button>
              )}
            </div>
          </div>

          <TabsContent value="preview" className="mt-3">
            <ZoomableImage
              src={previewUrl}
              alt={`Orthomosaic v${version.version} preview`}
            />
            <p className="text-muted-foreground mt-1.5 text-xs">
              Low-res preview (≤ 2000 px). Switch to High-res tab for a sharper
              image.
            </p>
          </TabsContent>

          <TabsContent value="hires" className="mt-3">
            {!highResLoaded ? (
              <div className="bg-muted/40 flex flex-col items-center justify-center gap-3 rounded-lg border py-16">
                <Zap className="text-muted-foreground h-8 w-8" />
                <p className="text-sm font-medium">
                  High-res preview not generated yet
                </p>
                <p className="text-muted-foreground text-xs">
                  Rendering at up to 8000 px may take a moment for large
                  orthomosaics.
                </p>
                <Button
                  size="sm"
                  disabled={highResLoading}
                  onClick={() => {
                    setHighResLoading(true);
                    setHighResLoaded(true);
                  }}
                >
                  {highResLoading ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Zap className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Generate High-res Preview
                </Button>
              </div>
            ) : (
              <div className="relative">
                <ZoomableImage
                  src={highResUrl}
                  alt={`Orthomosaic v${version.version} high-res`}
                  onLoad={() => setHighResLoading(false)}
                />
                {highResLoading && (
                  <div className="text-muted-foreground absolute inset-0 flex items-center justify-center gap-2 rounded-lg bg-black/20 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Rendering…
                  </div>
                )}
              </div>
            )}
            {highResLoaded && (
              <p className="text-muted-foreground mt-1.5 text-xs">
                High-res preview (≤ 8000 px).{" "}
                <button
                  className="underline hover:no-underline"
                  onClick={() => downloadJpeg(true)}
                >
                  Download as JPEG
                </button>
              </p>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function OrthoVersionsPanel({
  runId,
  versions,
  onDelete,
  onRename,
  isDeleting,
}: {
  runId: string;
  versions: OrthoVersion[];
  onDelete: (version: number) => void;
  onRename: (version: number, name: string) => void;
  isDeleting: boolean;
}) {
  const [viewingVersion, setViewingVersion] = useState<OrthoVersion | null>(
    null
  );
  const [editingVersion, setEditingVersion] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");

  const sorted = [...versions].sort((a, b) => b.version - a.version);

  function startRename(v: OrthoVersion) {
    setEditingVersion(v.version);
    setEditingName(v.name ?? "");
  }

  function commitRename() {
    if (editingVersion !== null) {
      onRename(editingVersion, editingName);
    }
    setEditingVersion(null);
  }

  return (
    <>
      <div className="mt-3 rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Version</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((v) => (
              <TableRow key={v.version}>
                <TableCell className="font-medium">
                  {editingVersion === v.version ? (
                    <div className="flex items-center gap-1">
                      <Input
                        className="h-7 w-36 text-sm"
                        value={editingName}
                        autoFocus
                        placeholder={`v${v.version}`}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") setEditingVersion(null);
                        }}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={commitRename}
                      >
                        <Check className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => setEditingVersion(null)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <button
                      className="flex items-center gap-1 hover:underline"
                      onClick={() => startRename(v)}
                      title="Click to rename"
                    >
                      <span>{v.name ?? `v${v.version}`}</span>
                      {v.name && (
                        <span className="text-muted-foreground text-xs">
                          v{v.version}
                        </span>
                      )}
                    </button>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {v.created_at ? new Date(v.created_at).toLocaleString() : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="View orthomosaic"
                      onClick={() => setViewingVersion(v)}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="Rename"
                      onClick={() => startRename(v)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-red-500 hover:text-red-600"
                      disabled={isDeleting}
                      onClick={() => onDelete(v.version)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <OrthoViewerDialog
        open={viewingVersion !== null}
        onClose={() => setViewingVersion(null)}
        runId={runId}
        version={viewingVersion}
      />
    </>
  );
}

// ── Plot boundary versions panel ──────────────────────────────────────────────

function PlotBoundaryVersionsPanel({
  versions,
  orthoVersions,
  pipelineType = "aerial",
  onRename,
  onDelete,
  downloadingCropsBv,
  onDownloadCrops,
  isDeleting,
}: {
  versions: PlotBoundaryVersion[];
  orthoVersions: OrthoVersion[];
  pipelineType?: "aerial" | "ground";
  onRename: (version: number, name: string) => void;
  onDelete: (version: number) => void;
  downloadingCropsBv: number | null;
  onDownloadCrops: (boundaryVersion: number, orthoVersion: number) => void;
  isDeleting: boolean;
}) {
  const [editingVersion, setEditingVersion] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [confirmVersion, setConfirmVersion] = useState<number | null>(null);
  const [cropDialog, setCropDialog] = useState<{
    boundaryVersion: number;
  } | null>(null);
  const [selectedOrthoForCrop, setSelectedOrthoForCrop] = useState<
    number | null
  >(null);

  const sorted = [...versions].sort((a, b) => b.version - a.version);

  function startRename(v: PlotBoundaryVersion) {
    setEditingVersion(v.version);
    setEditingName(v.name ?? "");
  }

  function commitRename() {
    if (editingVersion !== null) onRename(editingVersion, editingName);
    setEditingVersion(null);
  }

  function openCropDialog(bv: number) {
    setCropDialog({ boundaryVersion: bv });
    setSelectedOrthoForCrop(orthoVersions[0]?.version ?? null);
  }

  function confirmCropDownload() {
    if (!cropDialog || selectedOrthoForCrop == null) return;
    onDownloadCrops(cropDialog.boundaryVersion, selectedOrthoForCrop);
    setCropDialog(null);
  }

  return (
    <>
      <div className="mt-3 rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Version</TableHead>
              {pipelineType === "aerial" ? (
                <TableHead>Ortho Used</TableHead>
              ) : (
                <TableHead>Stitch Used</TableHead>
              )}
              <TableHead>Dataset</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((v) => (
              <TableRow key={v.version}>
                <TableCell className="font-medium">
                  {editingVersion === v.version ? (
                    <div className="flex items-center gap-1">
                      <Input
                        className="h-7 w-36 text-sm"
                        value={editingName}
                        autoFocus
                        placeholder={`v${v.version}`}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") setEditingVersion(null);
                        }}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={commitRename}
                      >
                        <Check className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => setEditingVersion(null)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <button
                      className="flex items-center gap-1 hover:underline"
                      onClick={() => startRename(v)}
                      title="Click to rename"
                    >
                      <span>{v.name ?? `v${v.version}`}</span>
                      {v.name && (
                        <span className="text-muted-foreground text-xs">
                          v{v.version}
                        </span>
                      )}
                    </button>
                  )}
                </TableCell>
                {pipelineType === "aerial" ? (
                  <TableCell className="text-muted-foreground text-sm">
                    {v.ortho_version != null ? `v${v.ortho_version}` : "—"}
                  </TableCell>
                ) : (
                  <TableCell className="text-muted-foreground text-sm">
                    {v.stitch_version != null ? `v${v.stitch_version}` : "—"}
                  </TableCell>
                )}
                <TableCell className="text-muted-foreground max-w-[200px] text-sm">
                  {v.run_meta ? (
                    <div className="flex flex-col gap-0.5">
                      {v.run_meta.experiment && (
                        <span className="truncate font-medium text-foreground/80">
                          {v.run_meta.experiment}
                        </span>
                      )}
                      <span className="truncate text-xs">
                        {[v.run_meta.date, v.run_meta.platform, v.run_meta.sensor]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                  ) : (
                    <span>—</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {v.created_at ? new Date(v.created_at).toLocaleString() : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    {pipelineType === "aerial" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Download crops"
                        disabled={
                          downloadingCropsBv === v.version ||
                          orthoVersions.length === 0
                        }
                        onClick={() => openCropDialog(v.version)}
                      >
                        {downloadingCropsBv === v.version ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="Rename"
                      onClick={() => startRename(v)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-red-500 hover:text-red-600"
                      title="Delete"
                      disabled={isDeleting}
                      onClick={() => setConfirmVersion(v.version)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ConfirmDeleteDialog
        open={confirmVersion !== null}
        title="Delete plot boundary?"
        description={`This will permanently delete plot boundary v${confirmVersion} and its GeoJSON file. This cannot be undone.`}
        isDeleting={isDeleting}
        onConfirm={() => {
          if (confirmVersion !== null) onDelete(confirmVersion);
          setConfirmVersion(null);
        }}
        onCancel={() => setConfirmVersion(null)}
      />

      {/* Ortho selection dialog for crop download */}
      <Dialog
        open={cropDialog !== null}
        onOpenChange={(open) => !open && setCropDialog(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Select Orthomosaic</DialogTitle>
            <DialogDescription>
              Choose which orthomosaic version to use for cropping the plots.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <select
              className="border-input bg-background w-full rounded border px-3 py-2 text-sm"
              value={selectedOrthoForCrop ?? ""}
              onChange={(e) => setSelectedOrthoForCrop(Number(e.target.value))}
            >
              {orthoVersions.map((ov) => (
                <option key={ov.version} value={ov.version}>
                  {ov.name ? `${ov.name} (v${ov.version})` : `v${ov.version}`}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCropDialog(null)}>
              Cancel
            </Button>
            <Button
              onClick={confirmCropDownload}
              disabled={selectedOrthoForCrop == null}
            >
              <Download className="mr-1.5 h-4 w-4" />
              Download Crops
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Outputs table ─────────────────────────────────────────────────────────────

const VIEWABLE_EXTS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".tif",
  ".tiff",
  ".webp",
]);
const DOWNLOADABLE_EXTS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".tif",
  ".tiff",
  ".webp",
  ".geojson",
  ".csv",
  ".zip",
]);

function isViewable(path: string) {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  return VIEWABLE_EXTS.has(ext);
}

function isDownloadable(path: string) {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  return DOWNLOADABLE_EXTS.has(ext);
}

function OutputsTable({
  outputs,
  dataRoot,
}: {
  outputs: Record<string, unknown> | null | undefined;
  dataRoot?: string;
}) {
  if (!outputs || Object.keys(outputs).length === 0) {
    return (
      <div className="text-muted-foreground flex flex-col items-center gap-2 py-8">
        <FileText className="h-8 w-8" />
        <p className="text-sm">
          No outputs yet. Run steps above to generate files.
        </p>
      </div>
    );
  }

  const rows: { key: string; value: string }[] = Object.entries(outputs)
    .filter(([, v]) => typeof v === "string")
    .map(([k, v]) => ({ key: k, value: String(v) }));

  // Resolve relative path to absolute using data_root
  function absPath(relPath: string) {
    if (!dataRoot || relPath.startsWith("/")) return relPath;
    return `${dataRoot}/${relPath}`;
  }

  function handleView(relPath: string) {
    const abs = absPath(relPath);
    const url = apiUrl(`/api/v1/files/serve?path=${encodeURIComponent(abs)}`);
    window.open(url, "_blank");
  }

  function handleDownload(relPath: string) {
    const abs = absPath(relPath);
    const url = apiUrl(`/api/v1/files/serve?path=${encodeURIComponent(abs)}`);
    const filename = relPath.split("/").pop() ?? relPath;
    tauriDownload(url, filename, "GET");
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Step</TableHead>
          <TableHead>File</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key}>
            <TableCell className="text-sm whitespace-nowrap capitalize">
              {row.key.replace(/_/g, " ")}
            </TableCell>
            <TableCell className="text-muted-foreground font-mono text-sm break-all">
              {row.value.split("/").pop()}
            </TableCell>
            <TableCell className="text-right whitespace-nowrap">
              {isViewable(row.value) && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => handleView(row.value)}
                >
                  <Eye className="h-3.5 w-3.5" />
                </Button>
              )}
              {isDownloadable(row.value) && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => handleDownload(row.value)}
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

function RunStatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    pending: "bg-gray-500/10 text-gray-700",
    running: "bg-blue-500/10 text-blue-700",
    completed: "bg-green-500/10 text-green-700",
    failed: "bg-red-500/10 text-red-700",
  };
  return <Badge className={cls[status] ?? cls.pending}>{status}</Badge>;
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function RunDetail() {
  const navigate = useNavigate();
  const { workspaceId, runId } = useParams({
    from: "/_layout/process/$workspaceId/run/$runId",
  });
  const { showErrorToast } = useCustomToast();
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { addProcess, updateProcess, processes } = useProcess();
  const orthoProcessIdRef = useRef<string | null>(null);
  const traitProcessIdRef = useRef<string | null>(null);
  // Set when the user clicks Stop — so DB sync effects know to show "Cancelled" not "Done"
  const stopWasRequestedRef = useRef(false);

  const {
    data: run,
    isLoading: runLoading,
    isFetching: runFetching,
  } = useQuery<PipelineRunPublic>({
    queryKey: ["pipeline-runs", runId],
    queryFn: () => PipelinesService.readRun({ id: runId }),
    // Poll every 3s while running so status stays fresh even without SSE
    refetchInterval: (query) =>
      query.state.data?.status === "running" ? 3000 : false,
  });

  const { data: pipeline } = useQuery<PipelinePublic>({
    queryKey: ["pipelines", run?.pipeline_id],
    queryFn: () => PipelinesService.readOne({ id: run!.pipeline_id }),
    enabled: !!run,
  });

  const { data: settingsData } = useQuery({
    queryKey: ["settings", "data-root"],
    queryFn: () => SettingsService.readDataRoot(),
    staleTime: Infinity,
  });
  const dataRoot = settingsData?.value;

  const runStatus = run?.status ?? "pending";
  const isRunning = runStatus === "running";
  const pipelineType = pipeline?.type ?? "ground";

  async function handleRefresh() {
    setIsRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ["pipeline-runs", runId] });
      await queryClient.invalidateQueries({ queryKey: ["stitch-versions", runId] });
      await queryClient.invalidateQueries({ queryKey: ["stitch-outputs", runId] });
      await queryClient.invalidateQueries({ queryKey: ["orthomosaic-info", runId] });
      await queryClient.invalidateQueries({ queryKey: ["auto-boundary", runId] });
      await queryClient.invalidateQueries({ queryKey: ["plot-boundaries", runId] });
      await queryClient.invalidateQueries({ queryKey: ["orthomosaic-versions", runId] });
      await queryClient.invalidateQueries({ queryKey: ["trait-records-run", runId] });
      await queryClient.invalidateQueries({ queryKey: ["inference-summary", runId] });
      await queryClient.invalidateQueries({ queryKey: ["associations", runId] });
    } finally {
      setIsRefreshing(false);
    }
  }

  // Check for an uploaded orthomosaic (aerial only, before ortho step completes)
  const { data: uploadedOrthoCheck } = useQuery<{
    available: boolean;
    filename: string | null;
    rgb_files: string[];
    dem_files: string[];
    needs_selection: boolean;
  }>({
    queryKey: ["check-uploaded-ortho", runId],
    queryFn: () =>
      fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/check-uploaded-ortho`), {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
        },
      }).then((r) => r.json()),
    enabled:
      !!run && pipelineType === "aerial" && !run?.steps_completed?.orthomosaic,
    staleTime: 60_000,
  });
  // Orthomosaic versions (aerial only)
  const { data: orthoVersions, refetch: refetchOrthoVersions } = useQuery<
    OrthoVersion[]
  >({
    queryKey: ["orthomosaic-versions", runId],
    queryFn: () =>
      fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/orthomosaics`), {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
        },
      }).then((r) => r.json()),
    enabled:
      !!run && pipelineType === "aerial" && !!run.steps_completed?.orthomosaic,
    staleTime: 30_000,
  });

  const deleteOrthoMutation = useMutation({
    mutationFn: (version: number) =>
      fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/orthomosaics/${version}`), {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
        },
      }).then((r) => {
        if (!r.ok) throw new Error("Failed to delete version");
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["orthomosaic-versions", runId],
      });
      queryClient.invalidateQueries({ queryKey: ["pipeline-runs", runId] });
    },
    onError: () => showErrorToast("Failed to delete orthomosaic version"),
  });

  const deletePlotBoundaryMutation = useMutation({
    mutationFn: (version: number) =>
      fetch(
        apiUrl(`/api/v1/pipeline-runs/${runId}/plot-boundaries/${version}`),
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
          },
        }
      ).then((r) => {
        if (!r.ok) throw new Error("Failed to delete version");
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plot-boundaries", runId] });
      queryClient.invalidateQueries({ queryKey: ["pipeline-runs", runId] });
    },
    onError: () => showErrorToast("Failed to delete plot boundary version"),
  });

  const deleteTraitRecordMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(apiUrl(`/api/v1/analyze/trait-records/${id}`), {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
        },
      }).then((r) => {
        if (!r.ok) throw new Error("Failed to delete trait record");
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trait-records-run", runId] });
      queryClient.invalidateQueries({ queryKey: ["pipeline-runs", runId] });
    },
    onError: () => showErrorToast("Failed to delete trait record"),
  });

  // Ground: delete an inference result by label
  const deleteInferenceMutation = useMutation({
    mutationFn: (label: string) =>
      fetch(
        apiUrl(
          `/api/v1/pipeline-runs/${runId}/inference-results/${encodeURIComponent(label)}`
        ),
        {
          method: "DELETE",
        }
      ).then((r) => {
        if (!r.ok) throw new Error("Failed to delete inference result");
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inference-summary", runId] });
      queryClient.invalidateQueries({ queryKey: ["pipeline-runs", runId] });
    },
    onError: () => showErrorToast("Failed to delete inference result"),
  });

  // Ground: check AgRowStitch availability for stitching step warning
  const { data: capabilities } = useQuery({
    queryKey: ["capabilities"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/v1/utils/capabilities/"));
      if (!res.ok) return null;
      return res.json() as Promise<{
        agrowstitch: { available: boolean };
        cuda_available: boolean;
      } | null>;
    },
    enabled: pipelineType === "ground",
    staleTime: Infinity,
  });

  const renameOrthoMutation = useMutation({
    mutationFn: ({ version, name }: { version: number; name: string }) =>
      fetch(
        apiUrl(`/api/v1/pipeline-runs/${runId}/orthomosaics/${version}/rename`),
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
          },
          body: JSON.stringify({ name }),
        }
      ).then((r) => {
        if (!r.ok) throw new Error("Failed to rename version");
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["orthomosaic-versions", runId],
      });
    },
    onError: () => showErrorToast("Failed to rename orthomosaic version"),
  });

  // Stitch version management (ground only)
  const deleteStitchMutation = useMutation({
    mutationFn: (version: number) =>
      fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/stitchings/${version}`), {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
        },
      }).then((r) => {
        if (!r.ok) throw new Error("Failed to delete");
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stitch-versions", runId] });
    },
    onError: () => showErrorToast("Failed to delete stitching version"),
  });

  const renameStitchMutation = useMutation({
    mutationFn: ({ version, name }: { version: number; name: string | null }) =>
      fetch(
        apiUrl(`/api/v1/pipeline-runs/${runId}/stitchings/${version}/rename`),
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
          },
          body: JSON.stringify({ name }),
        }
      ).then((r) => {
        if (!r.ok) throw new Error("Failed to rename");
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stitch-versions", runId] });
    },
    onError: () => showErrorToast("Failed to rename stitching version"),
  });

  const deletePlotMarkingMutation = useMutation({
    mutationFn: (version: number) =>
      fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/plot-markings/${version}`), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${localStorage.getItem("access_token") || ""}` },
      }).then((r) => { if (!r.ok) throw new Error("Failed to delete"); }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["plot-markings", runId] }),
    onError: () => showErrorToast("Failed to delete plot marking version"),
  });

const { data: plotBoundaryVersions, refetch: refetchPlotBoundaryVersions } =
    useQuery<PlotBoundaryVersion[]>({
      queryKey: ["plot-boundaries", runId],
      queryFn: () =>
        fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/plot-boundaries`), {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
          },
        }).then((r) => r.json()),
      enabled: !!run,
      refetchInterval: false,
    });

  // Plot marking versions (for stitching dialog version picker)
  const { data: plotMarkingVersions } = useQuery<{ version: number; name: string; created_at: string }[]>({
    queryKey: ["plot-markings", runId],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/plot-markings`), {
        headers: { Authorization: `Bearer ${localStorage.getItem("access_token") || ""}` },
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!run && pipelineType === "ground",
    refetchInterval: false,
  });

  // Page-level stitch versions (needed for associate_boundaries dialog)
  const { data: pageStitchVersions } = useQuery<StitchVersion[]>({
    queryKey: ["stitch-versions", runId],
    queryFn: async () => {
      const res = await fetch(
        apiUrl(`/api/v1/pipeline-runs/${runId}/stitchings`)
      );
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!run && pipelineType === "ground",
    staleTime: 30_000,
  });

  const deleteAssociationMutation = useMutation({
    mutationFn: (version: number) =>
      fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/associations/${version}`), {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
        },
      }).then((r) => {
        if (!r.ok) throw new Error("Failed");
        return r.json();
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["associations", runId] }),
    onError: () => showErrorToast("Failed to delete association"),
  });

  const renamePlotBoundaryMutation = useMutation({
    mutationFn: ({ version, name }: { version: number; name: string }) =>
      fetch(
        apiUrl(
          `/api/v1/pipeline-runs/${runId}/plot-boundaries/${version}/rename`
        ),
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
          },
          body: JSON.stringify({ name }),
        }
      ).then((r) => {
        if (!r.ok) throw new Error("Failed to rename version");
        return r.json();
      }),
    onSuccess: () => refetchPlotBoundaryVersions(),
    onError: () => showErrorToast("Failed to rename plot boundary version"),
  });

  const steps = pipelineType === "aerial" ? AERIAL_STEPS : GROUND_STEPS;
  const nextStepKey = getNextStep(steps, run?.steps_completed, runStatus);

  function handleStartSync() {
    setShowSyncDialog(false);
    if (syncMode === "cross_sensor") {
      executeMutation.mutate({
        step: "data_sync",
        sync_mode: "cross_sensor",
        sync_source_run_id: syncSourceRunId,
        sync_max_extrapolation_sec: syncMaxExtrapolationSec,
      } as any);
    } else {
      executeMutation.mutate({ step: "data_sync", sync_mode: "own_metadata" } as any);
    }
  }

  // Navigate to the full-page tool view
  function handleOpenTool(step: string) {
    navigate({
      to: "/process/$workspaceId/tool",
      params: { workspaceId },
      search: { runId, step },
    });
  }

  // SSE progress — only connect when a step is actively running
  const {
    events: progressEvents,
    lastProgress,
    clearEvents,
  } = useStepProgress(runId, isRunning, () => handleRefresh());

  // When the run becomes active (isRunning=true), ensure ProcessContext has an
  // entry so the panel tracks it. This fires whether the user clicked Start in
  // this session or arrived at an already-running run (e.g. after navigation).
  // Gate on !runFetching so we never act on stale cached data from a previous
  // visit — we only register once the fresh DB value confirms the run is running.
  const autoRegisteredRunId = useRef<string | null>(null);
  // Reset the guard whenever the run stops so a re-run can re-register.
  useEffect(() => {
    if (!isRunning) autoRegisteredRunId.current = null;
  }, [isRunning]);
  useEffect(() => {
    if (!isRunning || !run || !pipeline || runFetching) return;
    if (autoRegisteredRunId.current === runId) return;
    autoRegisteredRunId.current = runId;
    // Don't duplicate if ProcessContext already has an active entry (e.g. user
    // navigated away and back while the step was still running).
    const alreadyTracked = processes.some(
      (p) =>
        p.runId === runId && (p.status === "running" || p.status === "pending")
    );
    if (!alreadyTracked) {
      addProcess({
        type: "processing",
        title: `${run.current_step ?? "Processing"} (${pipeline.name} · ${run.date})`,
        status: "running",
        items: [],
        runId,
        link: `/process/${workspaceId}/run/${runId}`,
      });
    }
  }, [
    isRunning,
    runFetching,
    run,
    pipeline,
    runId,
    processes,
    addProcess,
    workspaceId,
  ]);

  // Execute step mutation
  const executeMutation = useMutation({
    mutationFn: (body: {
      step: string;
      models?: {
        label: string;
        roboflow_api_key: string;
        roboflow_model_id: string;
        task_type: string;
      }[];
    }) =>
      ProcessingService.executeStep({
        id: runId,
        requestBody: body,
      }),
    onMutate: (body) => {
      clearEvents();
      setExecutingStep(body.step);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipeline-runs", runId] });
    },
    onError: () => showErrorToast("Failed to start step"),
  });

  // Stop mutation
  const stopMutation = useMutation({
    mutationFn: () => {
      stopWasRequestedRef.current = true;
      return ProcessingService.stopStep({ id: runId });
    },
    onSuccess: () => handleRefresh(),
    onError: () => showErrorToast("Failed to stop step"),
  });

  // Feed SSE events into ProcessPanel for the active long-running step
  // Clear optimistic executingStep once backend confirms current_step or run is no longer running
  useEffect(() => {
    if (
      run?.current_step ||
      runStatus === "failed" ||
      runStatus === "completed"
    ) {
      setExecutingStep(null);
    }
  }, [run?.current_step, runStatus]);

  useEffect(() => {
    const orthoId = orthoProcessIdRef.current;
    const traitId = traitProcessIdRef.current;
    const pid = orthoId ?? traitId;
    if (!pid || !progressEvents.length) return;
    const latest = progressEvents[progressEvents.length - 1];
    if (latest.event === "complete") {
      updateProcess(pid, {
        status: "completed",
        progress: 100,
        message: "Done",
      });
    } else if (latest.event === "error" || latest.event === "cancelled") {
      const msg = latest.event === "cancelled" ? "Cancelled" : latest.message;
      updateProcess(pid, { status: "error", message: msg });
      // Clear refs so the DB sync effect can't later overwrite with "Done"
      if (pid === orthoId) orthoProcessIdRef.current = null;
      if (pid === traitId) traitProcessIdRef.current = null;
    } else if (latest.event === "progress") {
      updateProcess(pid, {
        ...(typeof latest.progress === "number"
          ? { progress: latest.progress }
          : {}),
        ...(latest.message ? { message: latest.message } : {}),
      });
    }
  }, [progressEvents, updateProcess]);

  // Reconnect orthoProcessIdRef after navigating away and back while ODM was running
  useEffect(() => {
    if (orthoProcessIdRef.current) return;
    const link = `/process/${workspaceId}/run/${runId}`;
    const existing = processes.find(
      (p) =>
        p.link === link && (p.status === "running" || p.status === "pending")
    );
    if (existing) orthoProcessIdRef.current = existing.id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id]);

  // Sync ProcessPanel from DB run status — catches completion/failure while SSE was disconnected
  useEffect(() => {
    const pid = orthoProcessIdRef.current;
    if (!run) return;
    const wasStopped = stopWasRequestedRef.current;
    if (runStatus !== "running" && run.current_step !== "orthomosaic") {
      if (run.steps_completed?.orthomosaic) {
        if (pid) {
          if (wasStopped) {
            updateProcess(pid, { status: "error", message: "Cancelled" });
            stopWasRequestedRef.current = false;
          } else {
            updateProcess(pid, {
              status: "completed",
              progress: 100,
              message: "Done",
            });
          }
          orthoProcessIdRef.current = null;
        }
        refetchOrthoVersions();
      } else if (wasStopped && pid) {
        updateProcess(pid, { status: "error", message: "Cancelled" });
        stopWasRequestedRef.current = false;
        orthoProcessIdRef.current = null;
      }
    } else if (runStatus === "failed" && run.current_step === "orthomosaic") {
      if (pid) {
        updateProcess(pid, { status: "error", message: run.error ?? "Failed" });
        orthoProcessIdRef.current = null;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    runStatus,
    run?.steps_completed?.orthomosaic,
    run?.current_step,
    run?.error,
    updateProcess,
  ]);

  // Sync ProcessPanel from DB run status for trait extraction
  useEffect(() => {
    const pid = traitProcessIdRef.current;
    if (!run || !pid) return;
    const wasStopped = stopWasRequestedRef.current;
    if (runStatus !== "running" && run.current_step !== "trait_extraction") {
      if (run.steps_completed?.trait_extraction && !wasStopped) {
        updateProcess(pid, {
          status: "completed",
          progress: 100,
          message: "Done",
        });
        queryClient.invalidateQueries({
          queryKey: ["trait-records-run", runId],
        });
      } else if (
        wasStopped ||
        (!run.steps_completed?.trait_extraction && runStatus !== "failed")
      ) {
        // Stopped mid-run (step not completed) or stop flag set
        updateProcess(pid, { status: "error", message: "Cancelled" });
        stopWasRequestedRef.current = false;
      }
      if (run.steps_completed?.trait_extraction || wasStopped) {
        traitProcessIdRef.current = null;
      }
    } else if (
      runStatus === "failed" &&
      run.current_step === "trait_extraction"
    ) {
      updateProcess(pid, { status: "error", message: run.error ?? "Failed" });
      traitProcessIdRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    runStatus,
    run?.steps_completed?.trait_extraction,
    run?.current_step,
    run?.error,
    updateProcess,
  ]);

  // Docker check dialog (shown when user tries to run orthomosaic without Docker)
  // Track which step was just clicked so the panel shows before backend confirms
  const [executingStep, setExecutingStep] = useState<string | null>(null);

  const [showDockerDialog, setShowDockerDialog] = useState(false);
  const [dockerDenied, setDockerDenied] = useState(false);

  // Orthomosaic name prompt
  const [showOrthoNameDialog, setShowOrthoNameDialog] = useState(false);
  const [orthoNameInput, setOrthoNameInput] = useState("");

  // Stitching name prompt
  const [showStitchNameDialog, setShowStitchNameDialog] = useState(false);
  const [stitchNameInput, setStitchNameInput] = useState("");
  const [stitchPlotMarkingVersion, setStitchPlotMarkingVersion] = useState<number | null>(null);

  // Trait extraction version selection dialog
  const [showTraitDialog, setShowTraitDialog] = useState(false);
  const [traitOrthoVersion, setTraitOrthoVersion] = useState<number | null>(
    null
  );
  const [traitBoundaryVersion, setTraitBoundaryVersion] = useState<
    number | null
  >(null);

  // Associate boundaries version selection dialog
  const [showAssocDialog, setShowAssocDialog] = useState(false);
  const [assocStitchVersion, setAssocStitchVersion] = useState<number | null>(
    null
  );
  const [assocBoundaryVersion, setAssocBoundaryVersion] = useState<
    number | null
  >(null);

  function startStitchWithName() {
    setShowStitchNameDialog(false);
    stopWasRequestedRef.current = false;
    executeMutation.mutate({
      step: "stitching",
      stitch_name: stitchNameInput.trim() || undefined,
      plot_marking_version: stitchPlotMarkingVersion ?? undefined,
    } as any);
  }

  // Guarded step runner — checks Docker availability before starting orthomosaic
  async function handleRunStep(step: string) {
    if (step === "associate_boundaries") {
      // Always show dialog so user can confirm which versions to use
      const stitchVers = pageStitchVersions ?? [];
      const boundaryVers = plotBoundaryVersions ?? [];
      setAssocStitchVersion(stitchVers[0]?.version ?? null);
      setAssocBoundaryVersion(boundaryVers[0]?.version ?? null);
      setShowAssocDialog(true);
      return;
    }
    if (step === "stitching") {
      setStitchNameInput("");
      const activeMarkingVersion = (run?.outputs as any)?.active_plot_marking_version ?? null;
      setStitchPlotMarkingVersion(activeMarkingVersion ?? plotMarkingVersions?.[plotMarkingVersions.length - 1]?.version ?? null);
      setShowStitchNameDialog(true);
      return;
    }
    if (step === "trait_extraction") {
      // If there are versioned orthos or boundaries, prompt which to use
      const hasMultipleOrthos = (orthoVersions?.length ?? 0) > 1;
      const hasMultipleBoundaries = (plotBoundaryVersions?.length ?? 0) > 1;
      if (hasMultipleOrthos || hasMultipleBoundaries) {
        setTraitOrthoVersion(orthoVersions?.[0]?.version ?? null);
        setTraitBoundaryVersion(plotBoundaryVersions?.[0]?.version ?? null);
        setShowTraitDialog(true);
        return;
      }
      // Single versions — pass them explicitly so the TraitRecord is recorded correctly
      stopWasRequestedRef.current = false;
      executeMutation.mutate({
        step,
        ortho_version: orthoVersions?.[0]?.version ?? undefined,
        boundary_version: plotBoundaryVersions?.[0]?.version ?? undefined,
      } as any);
      return;
    }
    if (step === "orthomosaic") {
      try {
        const result = await UtilsService.dockerCheck();
        if (!result.available) {
          setDockerDenied((result as any).reason === "permission_denied");
          setShowDockerDialog(true);
          return;
        }
      } catch {
        // If the check itself fails, let the step run and surface the error via SSE
      }
      // Prompt for a name before starting
      setOrthoNameInput("");
      setShowOrthoNameDialog(true);
      return;
    }
    executeMutation.mutate({ step });
  }

  function startOrthoWithName() {
    setShowOrthoNameDialog(false);
    stopWasRequestedRef.current = false;
    executeMutation.mutate({
      step: "orthomosaic",
      ortho_name: orthoNameInput.trim() || undefined,
    } as any);
  }

  function startTraitExtraction() {
    setShowTraitDialog(false);
    stopWasRequestedRef.current = false;
    executeMutation.mutate({
      step: "trait_extraction",
      ortho_version: traitOrthoVersion ?? undefined,
      boundary_version: traitBoundaryVersion ?? undefined,
    } as any);
  }

  function startAssociation() {
    setShowAssocDialog(false);
    stopWasRequestedRef.current = false;
    executeMutation.mutate({
      step: "associate_boundaries",
      stitch_version: assocStitchVersion ?? undefined,
      boundary_version: assocBoundaryVersion ?? undefined,
    } as any);
  }

  // Use uploaded orthomosaic (aerial: skip ODM)
  const [isRegisteringOrtho, setIsRegisteringOrtho] = useState(false);

  // Import orthomosaic dialog
  const [showImportOrthoDialog, setShowImportOrthoDialog] = useState(false);
  const [importSelectedId, setImportSelectedId] = useState<string>("");
  const [importSelectedDemId, setImportSelectedDemId] = useState<string>("");
  const [importSaveMode, setImportSaveMode] = useState<"new_version" | "replace">("new_version");
  const [importName, setImportName] = useState("");

  // Data sync dialog
  const [showSyncDialog, setShowSyncDialog] = useState(false);
  const [syncMode, setSyncMode] = useState<"own_metadata" | "cross_sensor">("own_metadata");
  const [syncSourceRunId, setSyncSourceRunId] = useState<string>("");
  const [syncMaxExtrapolationSec, setSyncMaxExtrapolationSec] = useState<number>(30);

  const { data: syncSources } = useQuery<{
    run_id: string; pipeline_name: string; pipeline_type: string;
    date: string; experiment: string; location: string; population: string;
    platform: string; sensor: string; gps_record_count: number;
  }[]>({
    queryKey: ["available-sync-sources", runId],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/available-sync-sources`), {
        headers: { Authorization: `Bearer ${localStorage.getItem("access_token") || ""}` },
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: showSyncDialog,
  });

  type OrthoUploadEntry = {
    id: string; experiment: string; location: string; population: string;
    date: string; platform: string; sensor: string; file_count: number; tif_files: string[];
  };

  const { data: uploadedOrthosList } = useQuery<OrthoUploadEntry[]>({
    queryKey: ["uploaded-orthos-list"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/v1/files/uploaded-orthos"), {
        headers: { Authorization: `Bearer ${localStorage.getItem("access_token") || ""}` },
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: showImportOrthoDialog,
    staleTime: 30_000,
  });

  const { data: uploadedDemsList } = useQuery<OrthoUploadEntry[]>({
    queryKey: ["uploaded-dems-list"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/v1/files/uploaded-dems"), {
        headers: { Authorization: `Bearer ${localStorage.getItem("access_token") || ""}` },
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: showImportOrthoDialog,
    staleTime: 30_000,
  });

  async function handleImportOrtho() {
    setIsRegisteringOrtho(true);
    try {
      const res = await fetch(
        apiUrl(`/api/v1/pipeline-runs/${runId}/use-uploaded-ortho`),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
          },
          body: JSON.stringify({
            file_upload_id: importSelectedId || null,
            dem_file_upload_id: importSelectedDemId || null,
            save_mode: importSaveMode,
            name: importName || null,
          }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Failed to import orthomosaic" }));
        showErrorToast(err.detail ?? "Failed to import orthomosaic");
        return;
      }
      setShowImportOrthoDialog(false);
      setImportSelectedId("");
      setImportSelectedDemId("");
      setImportName("");
      queryClient.invalidateQueries({ queryKey: ["pipeline-runs", runId] });
      queryClient.invalidateQueries({ queryKey: ["orthomosaic-versions", runId] });
      queryClient.invalidateQueries({ queryKey: ["orthomosaic-info", runId] });
    } catch {
      showErrorToast("Failed to import orthomosaic");
    } finally {
      setIsRegisteringOrtho(false);
    }
  }

  async function handleUseUploadedOrtho() {
    setIsRegisteringOrtho(true);
    try {
      const res = await fetch(
        apiUrl(`/api/v1/pipeline-runs/${runId}/use-uploaded-ortho`),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
          },
        }
      );
      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ detail: "Failed to register orthomosaic" }));
        showErrorToast(err.detail ?? "Failed to register orthomosaic");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["pipeline-runs", runId] });
    } catch {
      showErrorToast("Failed to register orthomosaic");
    } finally {
      setIsRegisteringOrtho(false);
    }
  }

  // Download crops
  const [downloadingCropsVersion, setDownloadingCropsVersion] = useState<
    number | null
  >(null);
  const [downloadingCropsBv, setDownloadingCropsBv] = useState<number | null>(
    null
  );
  const hasCrops = !!(
    run?.outputs?.stitching ||
    run?.outputs?.cropped_images ||
    run?.outputs?.traits_geojson ||
    run?.outputs?.traits
  );

  async function _fetchAndTriggerDownload(
    url: string,
    fallbackFilename: string
  ): Promise<boolean> {
    return downloadFile(absoluteApiUrl(url), fallbackFilename, "GET", [
      { name: "ZIP Archive", extensions: ["zip"] },
    ]);
  }

  async function handleDownloadCrops(orthoVersion?: number) {
    setDownloadingCropsVersion(orthoVersion ?? -1);
    const pid = addProcess({
      type: "processing",
      title: "Downloading crops…",
      status: "running",
      items: [],
      progress: 50,
    });
    try {
      const url =
        orthoVersion != null
          ? apiUrl(
              `/api/v1/pipeline-runs/${runId}/download-crops?ortho_version=${orthoVersion}`
            )
          : apiUrl(`/api/v1/pipeline-runs/${runId}/download-crops`);
      const saved = await _fetchAndTriggerDownload(url, "crops.zip");
      updateProcess(
        pid,
        saved
          ? { status: "completed", progress: 100, message: "Download complete" }
          : { status: "completed", progress: 100, message: "Cancelled" }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showErrorToast(`Download failed: ${msg}`);
      updateProcess(pid, {
        status: "error",
        message: `Download failed: ${msg}`,
      });
    } finally {
      setDownloadingCropsVersion(null);
    }
  }

  async function handleBoundaryCropDownload(
    boundaryVersion: number,
    orthoVersion: number
  ) {
    setDownloadingCropsBv(boundaryVersion);
    const pid = addProcess({
      type: "processing",
      title: "Downloading crops…",
      status: "running",
      items: [],
      progress: 50,
    });
    try {
      const url = apiUrl(
        `/api/v1/pipeline-runs/${runId}/plot-boundaries/${boundaryVersion}/download-crops?ortho_version=${orthoVersion}`
      );
      const saved = await _fetchAndTriggerDownload(url, "crops.zip");
      updateProcess(
        pid,
        saved
          ? { status: "completed", progress: 100, message: "Download complete" }
          : { status: "completed", progress: 100, message: "Cancelled" }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showErrorToast(`Download failed: ${msg}`);
      updateProcess(pid, {
        status: "error",
        message: `Download failed: ${msg}`,
      });
    } finally {
      setDownloadingCropsBv(null);
    }
  }

  if (runLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!run) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Run not found.</p>
      </div>
    );
  }

  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto max-w-4xl p-8">
        {/* Header */}
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
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold">
                {pipeline?.name ?? "Pipeline"} ({run.date})
              </h1>
              <RunStatusBadge status={runStatus} />
            </div>
            <p className="text-muted-foreground mt-0.5 text-sm">
              {run.experiment} / {run.location} / {run.population} ·{" "}
              {run.platform} · {run.sensor}
            </p>
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={handleRefresh}
            disabled={isRefreshing || isRunning}
            title="Refresh all pipeline data"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          </Button>
          {run.pipeline_id && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                navigate({
                  to: "/process/$workspaceId/pipeline",
                  params: { workspaceId },
                  search: {
                    type: pipelineType as "aerial" | "ground",
                    pipelineId: run.pipeline_id,
                  },
                })
              }
            >
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </Button>
          )}
        </div>


        {/* Data sync dialog */}
        {showSyncDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-background w-full max-w-lg rounded-xl border p-6 shadow-xl">
              <h2 className="mb-1 text-base font-semibold">Data Sync</h2>
              <p className="text-muted-foreground mb-5 text-sm">
                Choose how to assign GPS coordinates to your images.
              </p>

              {/* Option A */}
              <label className="mb-3 flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <input
                  type="radio"
                  name="syncMode"
                  value="own_metadata"
                  checked={syncMode === "own_metadata"}
                  onChange={() => setSyncMode("own_metadata")}
                  className="accent-primary mt-0.5"
                />
                <div>
                  <p className="text-sm font-medium">Use own metadata</p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    Extract GPS from each image's own EXIF data. If ArduPilot logs
                    are present in Metadata/, they will be used to refine positions.
                  </p>
                </div>
              </label>

              {/* Option B */}
              <label className="mb-1 flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <input
                  type="radio"
                  name="syncMode"
                  value="cross_sensor"
                  checked={syncMode === "cross_sensor"}
                  onChange={() => setSyncMode("cross_sensor")}
                  className="accent-primary mt-0.5"
                  disabled={!syncSources || syncSources.length === 0}
                />
                <div className="flex-1">
                  <p className={`text-sm font-medium ${(!syncSources || syncSources.length === 0) ? "text-muted-foreground" : ""}`}>
                    Sync from another sensor
                    {(!syncSources || syncSources.length === 0) && (
                      <span className="text-muted-foreground ml-2 text-xs font-normal">(no compatible sources available)</span>
                    )}
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    Interpolate GPS positions from a different sensor's synced data using
                    image capture timestamps. Positions are linearly interpolated — no images
                    are dropped.
                  </p>
                  {syncMode === "cross_sensor" && syncSources && syncSources.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <select
                        className="border-input bg-background w-full rounded-md border px-3 py-1.5 text-sm"
                        value={syncSourceRunId}
                        onChange={(e) => setSyncSourceRunId(e.target.value)}
                      >
                        <option value="">— Select a source run —</option>
                        {syncSources.map((s) => (
                          <option key={s.run_id} value={s.run_id}>
                            {s.date} · {s.platform} / {s.sensor} · {s.experiment} ({s.gps_record_count} GPS records)
                          </option>
                        ))}
                      </select>
                      <div className="flex items-center gap-2">
                        <label className="text-muted-foreground whitespace-nowrap text-xs">
                          Out-of-range threshold
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={3600}
                          step={5}
                          value={syncMaxExtrapolationSec}
                          onChange={(e) => setSyncMaxExtrapolationSec(Number(e.target.value))}
                          className="border-input bg-background w-20 rounded-md border px-2 py-1 text-sm"
                        />
                        <span className="text-muted-foreground text-xs">seconds</span>
                      </div>
                      <p className="text-muted-foreground text-xs">
                        Images within this window of the reference coverage boundary are clamped to the nearest GPS position. Images beyond it fall back to their own EXIF GPS.
                      </p>
                    </div>
                  )}
                </div>
              </label>

              {/* Warning for cross-sensor */}
              {syncMode === "cross_sensor" && (
                <div className="mb-4 mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                  ⚠ Cross-sensor sync works best when both sensors are mounted on the same
                  platform and were capturing data during the same pass. If capture rates differ
                  significantly, interpolated positions may be less accurate near the boundaries
                  of the reference sensor's coverage.
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  className="border-input bg-background hover:bg-muted rounded-md border px-4 py-1.5 text-sm"
                  onClick={() => setShowSyncDialog(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-1.5 text-sm disabled:opacity-50"
                  disabled={
                    isRunning ||
                    executeMutation.isPending ||
                    (syncMode === "cross_sensor" && !syncSourceRunId)
                  }
                  onClick={handleStartSync}
                >
                  Start Sync
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Aerial: uploaded orthomosaic detected — offer to skip ODM */}
        {pipelineType === "aerial" &&
          uploadedOrthoCheck?.available &&
          !run.steps_completed?.orthomosaic && (
            <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/30">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">
                    Uploaded orthomosaic detected
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {uploadedOrthoCheck.needs_selection ? (
                      <>
                        <strong>{uploadedOrthoCheck.rgb_files.length} RGB</strong> orthomosaic(s) found in the Orthomosaic folder.
                        {uploadedOrthoCheck.dem_files.length > 0 && (
                          <> <strong>{uploadedOrthoCheck.dem_files.length} DEM</strong> file(s) also found.</>
                        )}
                        {" "}Use the Import dialog to select which version to use.
                      </>
                    ) : (
                      <>
                        <strong>{uploadedOrthoCheck.filename}</strong> was found in the Orthomosaic folder.
                        {uploadedOrthoCheck.dem_files.length > 0 && (
                          <> DEM (<strong>{uploadedOrthoCheck.dem_files[0]}</strong>) also detected.</>
                        )}
                        {" "}Use it directly (skips GCP selection and ODM generation) or generate a new one.
                      </>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isRegisteringOrtho || isRunning}
                    onClick={() => {
                      queryClient.setQueryData(["check-uploaded-ortho", runId], {
                        available: false, filename: null, rgb_files: [], dem_files: [], needs_selection: false,
                      });
                    }}
                  >
                    Generate with ODM
                  </Button>
                  <Button
                    size="sm"
                    disabled={isRegisteringOrtho || isRunning}
                    onClick={() => {
                      if (uploadedOrthoCheck.needs_selection) {
                        // Multiple RGB files — open Import dialog so user can choose
                        setImportName("");
                        setImportSaveMode("new_version");
                        setImportSelectedId("");
                        setImportSelectedDemId("");
                        setShowImportOrthoDialog(true);
                      } else {
                        handleUseUploadedOrtho();
                      }
                    }}
                  >
                    {isRegisteringOrtho && (
                      <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                    )}
                    {isRegisteringOrtho
                      ? "Registering…"
                      : uploadedOrthoCheck.needs_selection
                      ? "Choose & Import…"
                      : "Use Uploaded"}
                  </Button>
                </div>
              </div>
            </div>
          )}

        {/* Step stepper */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Processing Steps</CardTitle>
            <CardDescription>
              {pipelineType === "aerial" ? "Aerial" : "Ground"} pipeline ·{" "}
              {steps.length} steps
            </CardDescription>
          </CardHeader>
          <CardContent>
            {(() => {
              const isExecuting = executeMutation.isPending || isRunning;
              return steps.map((step, idx) => {
              const status = getStepStatus(
                step.key,
                run.current_step,
                run.steps_completed,
                runStatus
              );
              const isNext = nextStepKey === step.key;
              const effectiveStatus: StepStatus =
                isNext && status === "locked"
                  ? "ready"
                  : step.kind === "optional" &&
                      status === "locked" &&
                      isOptionalReady(step.key, steps, run.steps_completed)
                    ? "ready"
                    : status;

              // Step-specific warnings
              const warning =
                step.key === "orthomosaic" &&
                !run.steps_completed?.gcp_selection
                  ? "GCP selection was skipped — orthomosaic accuracy may be reduced"
                  : step.key === "stitching" &&
                      capabilities &&
                      !capabilities.agrowstitch.available
                    ? "AgRowStitch not found — stitching will fail. Check vendor/AgRowStitch/ or set AGROWSTITCH_PATH."
                    : step.key === "stitching" &&
                        capabilities?.agrowstitch.available &&
                        !capabilities.cuda_available
                      ? "CUDA not available — stitching will run on CPU and may be slow"
                      : undefined;

              return (
                <StepRow
                  key={step.key}
                  step={step}
                  status={effectiveStatus}
                  isNext={isNext}
                  isLast={idx === steps.length - 1}
                  runId={runId}
                  runStatus={runStatus}
                  progressEvents={progressEvents}
                  lastProgress={
                    run.current_step === step.key ? lastProgress : null
                  }
                  onRunStep={handleRunStep}
                  onOpenTool={handleOpenTool}
                  onStopStep={() => stopMutation.mutate()}
                  isExecuting={executeMutation.isPending || isRunning}
                  isStopping={stopMutation.isPending}
                  isStarting={executingStep === step.key}
                  warning={warning}
                  hideDefaultButton={step.key === "data_sync"}
                  extraButtons={
                    step.key === "data_sync" ? (
                      <Button
                        variant={run.steps_completed?.data_sync ? "outline" : "default"}
                        size="sm"
                        disabled={isExecuting || isRunning}
                        onClick={() => {
                          setSyncMode("own_metadata");
                          setSyncSourceRunId("");
                          setSyncMaxExtrapolationSec(30);
                          setShowSyncDialog(true);
                        }}
                      >
                        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                        {run.steps_completed?.data_sync ? "Re-run" : "Run Step"}
                      </Button>
                    ) : step.key === "orthomosaic" && pipelineType === "aerial" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isExecuting || isRunning}
                        onClick={() => {
                          setImportSelectedId("");
                          setImportSelectedDemId("");
                          setImportName("");
                          setImportSaveMode("new_version");
                          setShowImportOrthoDialog(true);
                        }}
                      >
                        <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                        Import
                      </Button>
                    ) : undefined
                  }
                  extraContent={(() => {
                    if (
                      step.key === "orthomosaic" &&
                      pipelineType === "aerial" &&
                      orthoVersions &&
                      orthoVersions.length > 0
                    ) {
                      return (
                        <OrthoVersionsPanel
                          runId={runId}
                          versions={orthoVersions}
                          onDelete={(v) => deleteOrthoMutation.mutate(v)}
                          onRename={(v, name) =>
                            renameOrthoMutation.mutate({ version: v, name })
                          }
                          isDeleting={deleteOrthoMutation.isPending}
                        />
                      );
                    }
                    if (
                      step.key === "trait_extraction" &&
                      pipelineType === "aerial"
                    ) {
                      return (
                        <TraitRecordsPanel
                          runId={runId}
                          onDelete={(id) =>
                            deleteTraitRecordMutation.mutate(id)
                          }
                          isDeleting={deleteTraitRecordMutation.isPending}
                        />
                      );
                    }
                    if (step.key === "plot_marking" && pipelineType === "ground") {
                      return (
                        <PlotMarkingVersionsPanel
                          runId={runId}
                          onDelete={(v) => deletePlotMarkingMutation.mutate(v)}
                          isDeleting={deletePlotMarkingMutation.isPending}
                        />
                      );
                    }
                    if (
                      step.key === "plot_boundary_prep" &&
                      plotBoundaryVersions &&
                      plotBoundaryVersions.length > 0
                    ) {
                      return (
                        <PlotBoundaryVersionsPanel
                          versions={plotBoundaryVersions}
                          orthoVersions={orthoVersions ?? []}
                          pipelineType={pipelineType as "aerial" | "ground"}
                          onRename={(v, name) =>
                            renamePlotBoundaryMutation.mutate({
                              version: v,
                              name,
                            })
                          }
                          onDelete={(v) => deletePlotBoundaryMutation.mutate(v)}
                          isDeleting={deletePlotBoundaryMutation.isPending}
                          downloadingCropsBv={downloadingCropsBv}
                          onDownloadCrops={handleBoundaryCropDownload}
                        />
                      );
                    }
                    if (step.key === "stitching" && pipelineType === "ground") {
                      return (
                        <StitchPanel
                          runId={runId}
                          isRunning={isRunning && run?.current_step === "stitching"}
                          onDelete={(v) => deleteStitchMutation.mutate(v)}
                          onRename={(v, name) =>
                            renameStitchMutation.mutate({ version: v, name })
                          }
                          isDeleting={deleteStitchMutation.isPending}
                        />
                      );
                    }
                    if (
                      step.key === "associate_boundaries" &&
                      pipelineType === "ground"
                    ) {
                      return (
                        <AssociationVersionsPanel
                          runId={runId}
                          stitchVersions={pageStitchVersions ?? []}
                          boundaryVersions={plotBoundaryVersions ?? []}
                          onDelete={(v) => deleteAssociationMutation.mutate(v)}
                          isDeleting={deleteAssociationMutation.isPending}
                        />
                      );
                    }
                    if (step.key === "inference" && pipelineType === "ground") {
                      return (
                        <GroundInferencePanel
                          runId={runId}
                          onDelete={(label) =>
                            deleteInferenceMutation.mutate(label)
                          }
                          isDeleting={deleteInferenceMutation.isPending}
                        />
                      );
                    }
                    return undefined;
                  })()}
                />
              );
            });
            })()}
          </CardContent>
        </Card>

        {/* Advanced — Output Files (collapsible) */}
        <details className="group">
          <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer list-none items-center gap-1.5 py-2 text-sm select-none">
            <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" />
            Advanced
          </summary>
          <Card className="mt-2">
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>Output Files</CardTitle>
                  <CardDescription>
                    Files generated by this run, stored as paths relative to
                    your data root.
                  </CardDescription>
                </div>
                {hasCrops && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDownloadCrops()}
                    disabled={downloadingCropsVersion !== null}
                  >
                    {downloadingCropsVersion !== null ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="mr-2 h-4 w-4" />
                    )}
                    Download Crops
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <OutputsTable outputs={run.outputs} dataRoot={dataRoot} />
            </CardContent>
          </Card>
        </details>
      </div>

      {/* Stitching name + config confirmation dialog */}
      <Dialog
        open={showStitchNameDialog}
        onOpenChange={setShowStitchNameDialog}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm stitching parameters</DialogTitle>
            <DialogDescription>
              Review the configuration below before starting. You can update
              these in Pipeline Settings any time.
            </DialogDescription>
          </DialogHeader>

          {/* Config summary */}
          {(() => {
            const cfg = (pipeline?.config ?? {}) as Record<string, any>;
            const p = cfg.agrowstitch_params ?? {};
            const platform: string = cfg.platform ?? "custom";
            const rows: { label: string; value: string }[] = [
              { label: "Platform", value: platform.charAt(0).toUpperCase() + platform.slice(1) },
              { label: "Device", value: cfg.device === "multiprocessing" ? `Multiprocessing${cfg.num_cpu > 0 ? ` (${cfg.num_cpu})` : ""}` : (cfg.device ?? "cpu").toUpperCase() },
              { label: "Forward limit", value: String(p.forward_limit ?? "—") },
              { label: "Alignment tolerance", value: String(p.max_reprojection_error ?? "—") },
              { label: "Edge crop (L/R/T/B)", value: `${p.mask_left ?? 0} / ${p.mask_right ?? 0} / ${p.mask_top ?? 0} / ${p.mask_bottom ?? 0} px` },
              { label: "Batch size", value: String(p.batch_size ?? "—") },
              { label: "Min inliers", value: String(p.min_inliers ?? "—") },
            ];
            return (
              <div className="bg-muted rounded-md px-3 py-2 text-xs space-y-1">
                {rows.map(({ label, value }) => (
                  <div key={label} className="flex justify-between gap-4">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-mono font-medium text-right">{value}</span>
                  </div>
                ))}
              </div>
            );
          })()}

          {plotMarkingVersions && plotMarkingVersions.length >= 1 && (
            <div className="pt-1">
              <Label className="text-sm">Plot marking version</Label>
              <select
                value={stitchPlotMarkingVersion ?? ""}
                onChange={(e) => setStitchPlotMarkingVersion(Number(e.target.value))}
                className="mt-1 w-full border-input bg-background rounded border px-2 py-1.5 text-sm focus:outline-none"
              >
                {plotMarkingVersions.map((v) => (
                  <option key={v.version} value={v.version}>
                    {v.name ? `${v.name} (v${v.version})` : `Version ${v.version}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="pt-1">
            <Label htmlFor="stitch-name" className="text-sm">
              Run name (optional)
            </Label>
            <Input
              id="stitch-name"
              className="mt-1"
              placeholder="e.g. High overlap, Fast pass…"
              value={stitchNameInput}
              onChange={(e) => setStitchNameInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && startStitchWithName()}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowStitchNameDialog(false)}
            >
              Cancel
            </Button>
            <Button onClick={startStitchWithName}>Start stitching</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Orthomosaic name prompt dialog */}
      <Dialog open={showOrthoNameDialog} onOpenChange={setShowOrthoNameDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Name this orthomosaic</DialogTitle>
            <DialogDescription>
              Optionally give this run a name so you can identify it later (e.g.
              "High quality", "First attempt"). You can rename it any time.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="ortho-name" className="text-sm">
              Name (optional)
            </Label>
            <Input
              id="ortho-name"
              className="mt-1"
              placeholder={`v${(orthoVersions?.length ?? 0) + 1}`}
              value={orthoNameInput}
              onChange={(e) => setOrthoNameInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && startOrthoWithName()}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowOrthoNameDialog(false)}
            >
              Cancel
            </Button>
            <Button onClick={startOrthoWithName}>Start</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Associate boundaries version selection dialog */}
      <Dialog
        open={showAssocDialog}
        onOpenChange={(open) => !open && setShowAssocDialog(false)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Select Versions for Association</DialogTitle>
            <DialogDescription>
              Choose which stitch version and plot boundary version to
              associate.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {(pageStitchVersions?.length ?? 0) > 0 && (
              <div className="space-y-1">
                <Label className="text-sm">Stitch Version</Label>
                <select
                  className="border-input bg-background w-full rounded border px-3 py-2 text-sm"
                  value={assocStitchVersion ?? ""}
                  onChange={(e) =>
                    setAssocStitchVersion(Number(e.target.value))
                  }
                >
                  {pageStitchVersions!.map((sv) => (
                    <option key={sv.version} value={sv.version}>
                      {sv.name
                        ? `${sv.name} (v${sv.version})`
                        : `v${sv.version}`}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {(plotBoundaryVersions?.length ?? 0) > 0 && (
              <div className="space-y-1">
                <Label className="text-sm">Plot Boundary Version</Label>
                <select
                  className="border-input bg-background w-full rounded border px-3 py-2 text-sm"
                  value={assocBoundaryVersion ?? ""}
                  onChange={(e) =>
                    setAssocBoundaryVersion(Number(e.target.value))
                  }
                >
                  {plotBoundaryVersions!.map((bv) => (
                    <option key={bv.version} value={bv.version}>
                      {bv.name
                        ? `${bv.name} (v${bv.version})`
                        : `v${bv.version}`}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAssocDialog(false)}>
              Cancel
            </Button>
            <Button onClick={startAssociation}>Run Association</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Trait extraction version selection dialog */}
      <Dialog
        open={showTraitDialog}
        onOpenChange={(open) => !open && setShowTraitDialog(false)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Select Versions for Trait Extraction</DialogTitle>
            <DialogDescription>
              Choose which orthomosaic and plot boundary version to use.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {(orthoVersions?.length ?? 0) > 0 && (
              <div className="space-y-1">
                <Label className="text-sm">Orthomosaic</Label>
                <select
                  className="border-input bg-background w-full rounded border px-3 py-2 text-sm"
                  value={traitOrthoVersion ?? ""}
                  onChange={(e) => setTraitOrthoVersion(Number(e.target.value))}
                >
                  {orthoVersions!.map((ov) => (
                    <option key={ov.version} value={ov.version}>
                      {ov.name
                        ? `${ov.name} (v${ov.version})`
                        : `v${ov.version}`}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {(plotBoundaryVersions?.length ?? 0) > 0 && (
              <div className="space-y-1">
                <Label className="text-sm">Plot Boundaries</Label>
                <select
                  className="border-input bg-background w-full rounded border px-3 py-2 text-sm"
                  value={traitBoundaryVersion ?? ""}
                  onChange={(e) =>
                    setTraitBoundaryVersion(Number(e.target.value))
                  }
                >
                  {plotBoundaryVersions!.map((bv) => (
                    <option key={bv.version} value={bv.version}>
                      {bv.name
                        ? `${bv.name} (v${bv.version})`
                        : `v${bv.version}`}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTraitDialog(false)}>
              Cancel
            </Button>
            <Button onClick={startTraitExtraction}>Run Trait Extraction</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Docker missing dialog */}
      {/* ── Import Orthomosaic Dialog ── */}
      <Dialog open={showImportOrthoDialog} onOpenChange={(o) => { if (!o) { setShowImportOrthoDialog(false); setImportSelectedDemId(""); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import Orthomosaic</DialogTitle>
            <DialogDescription>
              Select an RGB orthomosaic (required) and optionally a DEM (for plant height).
              Upload them via Files → Orthomosaic and Files → Orthomosaic DEM first.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            {/* RGB Ortho list */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">RGB Orthomosaic <span className="text-destructive">*</span></p>
              <div className="border rounded-md overflow-hidden">
                <div className="max-h-44 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/60 sticky top-0">
                      <tr>
                        {["", "Date", "Experiment", "Location", "Population", "Platform", "Files"].map((h) => (
                          <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {!uploadedOrthosList ? (
                        <tr><td colSpan={7} className="px-3 py-4 text-center text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin inline-block mr-1" />Loading…
                        </td></tr>
                      ) : uploadedOrthosList.length === 0 ? (
                        <tr><td colSpan={7} className="px-3 py-4 text-center text-muted-foreground">
                          No RGB orthomosaics uploaded yet. Upload via Files → Orthomosaic first.
                        </td></tr>
                      ) : uploadedOrthosList.map((o) => (
                        <tr
                          key={o.id}
                          onClick={() => setImportSelectedId(o.id)}
                          className={`cursor-pointer border-t transition-colors ${
                            o.id === importSelectedId ? "bg-primary/10" : "hover:bg-muted/50"
                          }`}
                        >
                          <td className="px-2 py-2">
                            <input type="radio" readOnly checked={o.id === importSelectedId} className="accent-primary" />
                          </td>
                          <td className="px-3 py-2 tabular-nums">{o.date}</td>
                          <td className="px-3 py-2 font-medium">{o.experiment}</td>
                          <td className="px-3 py-2 text-muted-foreground">{o.location}</td>
                          <td className="px-3 py-2 text-muted-foreground">{o.population}</td>
                          <td className="px-3 py-2 text-muted-foreground">{[o.platform, o.sensor].filter(Boolean).join(" / ") || "—"}</td>
                          <td className="px-3 py-2 tabular-nums text-muted-foreground">{o.file_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* DEM list */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">
                DEM <span className="text-muted-foreground font-normal">(optional — required for plant height)</span>
              </p>
              <div className="border rounded-md overflow-hidden">
                <div className="max-h-44 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/60 sticky top-0">
                      <tr>
                        {["", "Date", "Experiment", "Location", "Population", "Platform", "Files"].map((h) => (
                          <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {!uploadedDemsList ? (
                        <tr><td colSpan={7} className="px-3 py-4 text-center text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin inline-block mr-1" />Loading…
                        </td></tr>
                      ) : uploadedDemsList.length === 0 ? (
                        <tr><td colSpan={7} className="px-3 py-4 text-center text-muted-foreground">
                          No DEMs uploaded yet. Upload via Files → Orthomosaic DEM to enable plant height.
                        </td></tr>
                      ) : (
                        <>
                          <tr
                            onClick={() => setImportSelectedDemId("")}
                            className={`cursor-pointer border-t transition-colors ${
                              !importSelectedDemId ? "bg-primary/10" : "hover:bg-muted/50"
                            }`}
                          >
                            <td className="px-2 py-2">
                              <input type="radio" readOnly checked={!importSelectedDemId} className="accent-primary" />
                            </td>
                            <td colSpan={6} className="px-3 py-2 text-muted-foreground italic">None</td>
                          </tr>
                          {uploadedDemsList.map((o) => (
                            <tr
                              key={o.id}
                              onClick={() => setImportSelectedDemId(o.id)}
                              className={`cursor-pointer border-t transition-colors ${
                                o.id === importSelectedDemId ? "bg-primary/10" : "hover:bg-muted/50"
                              }`}
                            >
                              <td className="px-2 py-2">
                                <input type="radio" readOnly checked={o.id === importSelectedDemId} className="accent-primary" />
                              </td>
                              <td className="px-3 py-2 tabular-nums">{o.date}</td>
                              <td className="px-3 py-2 font-medium">{o.experiment}</td>
                              <td className="px-3 py-2 text-muted-foreground">{o.location}</td>
                              <td className="px-3 py-2 text-muted-foreground">{o.population}</td>
                              <td className="px-3 py-2 text-muted-foreground">{[o.platform, o.sensor].filter(Boolean).join(" / ") || "—"}</td>
                              <td className="px-3 py-2 tabular-nums text-muted-foreground">{o.file_count}</td>
                            </tr>
                          ))}
                        </>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Save mode + optional name */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Save as</label>
                <select
                  value={importSaveMode}
                  onChange={(e) => setImportSaveMode(e.target.value as "new_version" | "replace")}
                  className="border-input bg-background rounded border px-2 py-1.5 text-xs w-full focus:outline-none"
                >
                  <option value="new_version">New version</option>
                  <option value="replace">Replace current version</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Version name (optional)</label>
                <input
                  value={importName}
                  onChange={(e) => setImportName(e.target.value)}
                  placeholder="e.g. external-software, manual"
                  className="border-input bg-background rounded border px-2 py-1.5 text-xs w-full focus:outline-none"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowImportOrthoDialog(false)}>Cancel</Button>
            <Button
              disabled={!importSelectedId || isRegisteringOrtho}
              onClick={handleImportOrtho}
            >
              {isRegisteringOrtho && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {isRegisteringOrtho ? "Importing…" : "Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDockerDialog} onOpenChange={setShowDockerDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Docker Required</DialogTitle>
            <DialogDescription asChild>
              <div className="text-muted-foreground space-y-3 text-sm">
                <p>
                  Orthomosaic generation uses{" "}
                  <strong className="text-foreground">
                    OpenDroneMap (ODM)
                  </strong>
                  , which requires Docker to be installed on your machine.
                </p>
                {dockerDenied ? (
                  <p>
                    Docker is installed but your user does not have permission
                    to access it. On Linux, add your user to the{" "}
                    <code className="text-foreground">docker</code> group:{" "}
                    <code className="text-foreground text-xs">
                      sudo usermod -aG docker $USER
                    </code>{" "}
                    then log out and back in.
                  </p>
                ) : (
                  <p>
                    Docker was not found or is not running. Download and install
                    Docker Desktop, then restart GEMI. The ODM image (~4 GB)
                    will download automatically the first time you run this step
                    — no extra setup needed.
                  </p>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              onClick={() => setShowDockerDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() =>
                openUrl("https://www.docker.com/products/docker-desktop/")
              }
            >
              Download Docker Desktop
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
