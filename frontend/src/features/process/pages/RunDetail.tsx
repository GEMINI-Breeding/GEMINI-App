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
  X,
} from "lucide-react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { subscribe } from "@/lib/sseManager";
import { downloadFile } from "@/lib/platform";
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
import { Progress } from "@/components/ui/progress";
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
import { analyzeApi, versionLabel, type TraitRecord } from "@/features/analyze/api";

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
  filters?: { name: string; extensions: string[] }[],
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
      "AgRowStitch stitches images per plot into panoramic mosaics and creates a combined mosaic",
    kind: "compute",
  },
  {
    key: "georeferencing",
    label: "Georeferencing",
    description:
      "GPS-based georeferencing of stitched plots and combined mosaic",
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

function useStepProgress(runId: string, isRunning: boolean) {
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

      if (evt.event === "complete" || evt.event === "error" || evt.event === "cancelled") {
        queryClient.invalidateQueries({ queryKey: ["pipeline-runs", runId] });
        if (evt.event === "complete") {
          if (evt.step === "stitching") {
            queryClient.invalidateQueries({ queryKey: ["stitch-outputs", runId] });
            queryClient.invalidateQueries({ queryKey: ["stitch-versions", runId] });
          }
          if (evt.step === "georeferencing") {
            queryClient.invalidateQueries({ queryKey: ["stitch-outputs", runId] });
            queryClient.invalidateQueries({ queryKey: ["stitch-versions", runId] });
          }
          if (evt.step === "orthomosaic") {
            queryClient.invalidateQueries({ queryKey: ["orthomosaic-versions", runId] });
          }
          if (evt.step === "trait_extraction") {
            queryClient.invalidateQueries({ queryKey: ["trait-records-run", runId] });
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
          <Button variant="destructive" onClick={onConfirm} disabled={isDeleting}>
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
      const res = await fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/inference-summary`));
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });

  // Count inference results per trait version
  const inferenceCountByTraitVersion = inferenceResults.reduce<Record<number, number>>((acc, r) => {
    if (r.trait_version != null) {
      acc[r.trait_version] = (acc[r.trait_version] ?? 0) + 1;
    }
    return acc;
  }, {});

  if (isLoading) {
    return (
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading trait records…
      </div>
    );
  }

  if (records.length === 0) return null;

  const confirmRecord = records.find((r: TraitRecord) => r.id === confirmId);

  return (
    <>
      <div className="mt-3 rounded-md border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="text-xs">
              <TableHead className="py-2 text-xs w-10">v</TableHead>
              <TableHead className="py-2 text-xs">Ortho / Stitch</TableHead>
              <TableHead className="py-2 text-xs">Boundary</TableHead>
              <TableHead className="py-2 text-xs text-right">Plots</TableHead>
              <TableHead className="py-2 text-xs text-right">Inferences</TableHead>
              <TableHead className="py-2 text-xs text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map((r: TraitRecord) => (
              <TableRow key={r.id} className="text-xs">
                <TableCell className="py-1.5 font-mono text-muted-foreground">
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
                    : "canonical"}
                </TableCell>
                <TableCell className="py-1.5 text-right font-mono">{r.plot_count}</TableCell>
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
  const label = version.name ? `${version.name} (v${version.version})` : `v${version.version}`;
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
        <div className="max-h-96 overflow-y-auto rounded-md border bg-muted/40 p-3 font-mono text-xs">
          {entries.length === 0 ? (
            <span className="text-muted-foreground">No config recorded</span>
          ) : (
            entries.map(([k, v]) => (
              <div key={k} className="flex gap-2 py-0.5">
                <span className="text-muted-foreground min-w-[140px] shrink-0">{k}</span>
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
  useEffect(() => { if (open) setPageIndex(0); }, [open]);

  if (!open || plots.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl p-3">
        <DialogHeader className="px-1">
          <DialogTitle className="text-sm">
            {versionLabel} — {plots.length} plots
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
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
              <span className="w-16 text-center">{pageIndex + 1} / {plots.length}</span>
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
            <img
              src={apiUrl(plot.url)}
              alt={plot.name}
              className="w-full rounded border"
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
  const [viewingConfig, setViewingConfig] = useState<StitchVersion | null>(null);
  const [viewingImages, setViewingImages] = useState<{ version: StitchVersion; plots: StitchPlot[] } | null>(null);
  const [editingVersion, setEditingVersion] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [confirmDeleteVersion, setConfirmDeleteVersion] = useState<number | null>(null);
  const [downloadingVersion, setDownloadingVersion] = useState<number | null>(null);
  const [downloadDialog, setDownloadDialog] = useState<{ stitch: StitchVersion; selectedAssocVersion: number | null } | null>(null);

  // Associations (for download naming)
  const { data: associations = [] } = useQuery<AssociationVersion[]>({
    queryKey: ["associations", runId],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/associations`));
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });

  // Live plots during run (polled every 5s)
  const { data: liveData } = useQuery<{ plots: StitchPlot[]; version: number }>({
    queryKey: ["stitch-outputs", runId],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/stitch-outputs`));
      if (!res.ok) return { plots: [], version: 1 };
      return res.json();
    },
    staleTime: 5_000,
    refetchInterval: isRunning ? 5_000 : false,
  });

  // Completed versions (after run)
  const { data: versions = [], isLoading: versionsLoading } = useQuery<StitchVersion[]>({
    queryKey: ["stitch-versions", runId],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/stitchings`));
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });

  // Auto-advance page index to latest plot during run
  const livePlots = liveData?.plots ?? [];
  useEffect(() => {
    if (isRunning && livePlots.length > 0) {
      setPageIndex(livePlots.length - 1);
    }
  }, [isRunning, livePlots.length]);

  // Fetch images for a specific version to show in dialog
  async function viewVersionImages(v: StitchVersion) {
    const res = await fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/stitch-outputs`));
    // The live endpoint returns active version; for other versions fetch directly if needed
    // For simplicity, use the stitch-outputs endpoint which returns the active version
    // If user wants to view a non-active version we still show what we have
    const data = res.ok ? await res.json() : { plots: [] };
    setViewingImages({ version: v, plots: data.plots ?? [] });
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
    const defaultAssoc = matching.length > 0 ? matching[matching.length - 1].version : null;
    setDownloadDialog({ stitch: v, selectedAssocVersion: defaultAssoc });
  }

  async function confirmDownload() {
    if (!downloadDialog) return;
    const { stitch, selectedAssocVersion } = downloadDialog;
    setDownloadDialog(null);
    setDownloadingVersion(stitch.version);
    const label = stitch.name ? `${stitch.name}_v${stitch.version}` : `v${stitch.version}`;
    const assocParam = selectedAssocVersion != null ? `?association_version=${selectedAssocVersion}` : "";
    await tauriDownload(
      `/api/v1/pipeline-runs/${runId}/stitchings/${stitch.version}/download${assocParam}`,
      `stitching_${label}.zip`,
      "GET",
      [{ name: "ZIP Archive", extensions: ["zip"] }],
    );
    setDownloadingVersion(null);
  }

  // ── During run: page viewer ────────────────────────────────────────────────

  if (isRunning) {
    if (livePlots.length === 0) {
      return (
        <div className="mt-3 text-xs text-muted-foreground">
          Stitching in progress — plots will appear here as they complete.
        </div>
      );
    }
    const plot = livePlots[pageIndex] ?? livePlots[livePlots.length - 1];
    return (
      <div className="mt-3 space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{livePlots.length} plot{livePlots.length !== 1 ? "s" : ""} stitched · v{liveData?.version ?? 1}</span>
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
            <span className="w-16 text-center">{pageIndex + 1} / {livePlots.length}</span>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={pageIndex === livePlots.length - 1}
              onClick={() => setPageIndex((p) => p + 1)}
            >
              <ChevronDown className="h-3.5 w-3.5 -rotate-90" />
            </Button>
          </div>
        </div>
        <img
          src={apiUrl(plot.url)}
          alt={plot.name}
          className="w-full rounded border"
        />
        <p className="text-xs font-mono text-muted-foreground">{plot.name}</p>
      </div>
    );
  }

  // ── After run: version table ───────────────────────────────────────────────

  if (versionsLoading) {
    return (
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading stitching versions…
      </div>
    );
  }

  if (versions.length === 0) return null;

  const confirmDeleteEntry = versions.find((v) => v.version === confirmDeleteVersion);

  return (
    <>
      <div className="mt-3 rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="py-2 text-xs">Version</TableHead>
              <TableHead className="py-2 text-xs text-right">Plots</TableHead>
              <TableHead className="py-2 text-xs">Created</TableHead>
              <TableHead className="py-2 text-xs text-right">Actions</TableHead>
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
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={commitRename}>
                        <Check className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditingVersion(null)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <button
                      className="flex items-center gap-1 hover:underline"
                      onClick={() => startRename(v)}
                      title="Click to rename"
                    >
                      <span className="font-medium">{v.name ?? `v${v.version}`}</span>
                      {v.name && (
                        <span className="text-muted-foreground">v{v.version}</span>
                      )}
                    </button>
                  )}
                </TableCell>
                <TableCell className="py-1.5 text-right font-mono">{v.plot_count}</TableCell>
                <TableCell className="py-1.5 text-muted-foreground">
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
                      {downloadingVersion === v.version
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Download className="h-3.5 w-3.5" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-destructive hover:text-destructive"
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
      <Dialog open={downloadDialog !== null} onOpenChange={(o) => !o && setDownloadDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Download Stitching {downloadDialog?.stitch.name ? `"${downloadDialog.stitch.name}" (v${downloadDialog.stitch.version})` : `v${downloadDialog?.stitch.version}`}</DialogTitle>
            <DialogDescription>
              Select which association version to use for file naming.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {(() => {
              const sv = downloadDialog?.stitch.version;
              const matching = associations.filter((a) => a.stitch_version === sv);
              const others = associations.filter((a) => a.stitch_version !== sv);
              const allOptions = [...matching.sort((a, b) => b.version - a.version), ...others.sort((a, b) => b.version - a.version)];
              if (allOptions.length === 0) {
                return (
                  <p className="text-xs text-muted-foreground">
                    No association versions found. Images will be named by plot index.
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
                        d ? { ...d, selectedAssocVersion: e.target.value ? Number(e.target.value) : null } : d
                      )
                    }
                  >
                    <option value="">None (use plot index only)</option>
                    {allOptions.map((a) => {
                      const isMatch = a.stitch_version === sv;
                      const label = `v${a.version} — stitch v${a.stitch_version ?? "?"} · boundary v${a.boundary_version ?? "?"}${isMatch ? " ✓" : ""}`;
                      return (
                        <option key={a.version} value={a.version}>{label}</option>
                      );
                    })}
                  </select>
                  {matching.length === 0 && (
                    <p className="text-xs text-amber-600">No association matches stitch v{sv}. Using a different version may produce incorrect names.</p>
                  )}
                </div>
              );
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDownloadDialog(null)}>Cancel</Button>
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
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading inference results…
      </div>
    );
  }

  if (results.length === 0) return null;

  return (
    <>
      <div className="mt-3 rounded-md border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="py-2 text-xs">Label</TableHead>
              <TableHead className="py-2 text-xs">Stitch</TableHead>
              <TableHead className="py-2 text-xs">Assoc</TableHead>
              <TableHead className="py-2 text-xs text-right">Plots</TableHead>
              <TableHead className="py-2 text-xs text-right">Predictions</TableHead>
              <TableHead className="py-2 text-xs">Classes</TableHead>
              <TableHead className="py-2 text-xs text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {results.map((r) => (
              <TableRow key={r.label} className="text-xs">
                <TableCell className="py-2 font-medium">{r.label}</TableCell>
                <TableCell className="py-2 text-muted-foreground font-mono">
                  {r.stitch_version != null ? `v${r.stitch_version}` : "—"}
                </TableCell>
                <TableCell className="py-2 text-muted-foreground font-mono">
                  {r.association_version != null ? `v${r.association_version}` : "—"}
                </TableCell>
                <TableCell className="py-2 text-right">{r.plot_count}</TableCell>
                <TableCell className="py-2 text-right">{r.total_predictions}</TableCell>
                <TableCell className="py-2">
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(r.classes).map(([cls, count]) => (
                      <Badge key={cls} variant="outline" className="text-[10px] px-1 py-0">
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
                      className="h-6 w-6 text-destructive hover:text-destructive"
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
  const [confirmDeleteVersion, setConfirmDeleteVersion] = useState<number | null>(null);

  const { data: versions = [], isLoading } = useQuery<AssociationVersion[]>({
    queryKey: ["associations", runId],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/associations`));
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
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
      <div className="mt-3 rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="py-2 text-xs">Version</TableHead>
              <TableHead className="py-2 text-xs">Stitch Used</TableHead>
              <TableHead className="py-2 text-xs">Boundary Used</TableHead>
              <TableHead className="py-2 text-xs text-right">Matched</TableHead>
              <TableHead className="py-2 text-xs">Created</TableHead>
              <TableHead className="py-2 text-xs text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {versions.map((v) => (
              <TableRow key={v.version} className="text-xs">
                <TableCell className="py-1.5 font-medium">v{v.version}</TableCell>
                <TableCell className="py-1.5 text-muted-foreground font-mono">
                  {stitchLabel(v.stitch_version)}
                </TableCell>
                <TableCell className="py-1.5 text-muted-foreground font-mono">
                  {boundaryLabel(v.boundary_version)}
                </TableCell>
                <TableCell className="py-1.5 text-right font-mono">
                  {v.matched}/{v.total}
                </TableCell>
                <TableCell className="py-1.5 text-muted-foreground">
                  {v.created_at ? new Date(v.created_at).toLocaleString() : "—"}
                </TableCell>
                <TableCell className="py-1.5 text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive hover:text-destructive"
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
            <div className="bg-muted/40 overflow-hidden rounded-lg border">
              <img
                src={previewUrl}
                alt={`Orthomosaic v${version.version} preview`}
                className="max-h-[60vh] w-full object-contain"
              />
            </div>
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
              <div className="bg-muted/40 overflow-hidden rounded-lg border">
                <img
                  src={highResUrl}
                  alt={`Orthomosaic v${version.version} high-res`}
                  className="max-h-[60vh] w-full object-contain"
                  onLoad={() => setHighResLoading(false)}
                />
                {highResLoading && (
                  <div className="text-muted-foreground flex items-center justify-center gap-2 p-4 text-sm">
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
  const { addProcess, updateProcess, processes } = useProcess();
  const orthoProcessIdRef = useRef<string | null>(null);
  const traitProcessIdRef = useRef<string | null>(null);
  // Set when the user clicks Stop — so DB sync effects know to show "Cancelled" not "Done"
  const stopWasRequestedRef = useRef(false);

  const { data: run, isLoading: runLoading, isFetching: runFetching } = useQuery<PipelineRunPublic>({
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

  // Check for an uploaded orthomosaic (aerial only, before ortho step completes)
  const { data: uploadedOrthoCheck } = useQuery<{
    available: boolean;
    filename: string | null;
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
      fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/plot-boundaries/${version}`), {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
        },
      }).then((r) => {
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
      fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/inference-results/${encodeURIComponent(label)}`), {
        method: "DELETE",
      }).then((r) => {
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
      return res.json() as Promise<{ agrowstitch: { available: boolean }; cuda_available: boolean } | null>;
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
        headers: { Authorization: `Bearer ${localStorage.getItem("access_token") || ""}` },
      }).then((r) => { if (!r.ok) throw new Error("Failed to delete"); }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stitch-versions", runId] });
    },
    onError: () => showErrorToast("Failed to delete stitching version"),
  });

  const renameStitchMutation = useMutation({
    mutationFn: ({ version, name }: { version: number; name: string | null }) =>
      fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/stitchings/${version}/rename`), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
        },
        body: JSON.stringify({ name }),
      }).then((r) => { if (!r.ok) throw new Error("Failed to rename"); }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stitch-versions", runId] });
    },
    onError: () => showErrorToast("Failed to rename stitching version"),
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
      enabled: !!run && !!run.steps_completed?.plot_boundary_prep,
      refetchInterval: false,
    });

  // Page-level stitch versions (needed for associate_boundaries dialog)
  const { data: pageStitchVersions } = useQuery<StitchVersion[]>({
    queryKey: ["stitch-versions", runId],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/stitchings`));
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
        headers: { Authorization: `Bearer ${localStorage.getItem("access_token") || ""}` },
      }).then((r) => { if (!r.ok) throw new Error("Failed"); return r.json(); }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["associations", runId] }),
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

  // Auto-trigger data_sync for aerial runs that haven't had it completed yet.
  // Runs silently in the background — the SSE progress bar shows inline.
  const [autoSyncTriggered, setAutoSyncTriggered] = useState(false);
  useEffect(() => {
    if (
      run &&
      pipeline &&
      pipelineType === "aerial" &&
      !run.steps_completed?.data_sync &&
      runStatus !== "running" &&
      runStatus !== "failed" &&
      !autoSyncTriggered
    ) {
      setAutoSyncTriggered(true);
      executeMutation.mutate({ step: "data_sync" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id, pipeline?.id]);

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
  } = useStepProgress(runId, isRunning);

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
      (p) => p.runId === runId && (p.status === "running" || p.status === "pending"),
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
  }, [isRunning, runFetching, run, pipeline, runId, processes, addProcess, workspaceId]);

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
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["pipeline-runs", runId] }),
    onError: () => showErrorToast("Failed to stop step"),
  });

  // Feed SSE events into ProcessPanel for the active long-running step
  // Clear optimistic executingStep once backend confirms current_step or run is no longer running
  useEffect(() => {
    if (run?.current_step || runStatus === "failed" || runStatus === "completed") {
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
        queryClient.invalidateQueries({ queryKey: ["trait-records-run", runId] });
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

  // Orthomosaic name prompt
  const [showOrthoNameDialog, setShowOrthoNameDialog] = useState(false);
  const [orthoNameInput, setOrthoNameInput] = useState("");

  // Stitching name prompt
  const [showStitchNameDialog, setShowStitchNameDialog] = useState(false);
  const [stitchNameInput, setStitchNameInput] = useState("");

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
  const [assocStitchVersion, setAssocStitchVersion] = useState<number | null>(null);
  const [assocBoundaryVersion, setAssocBoundaryVersion] = useState<number | null>(null);

  function startStitchWithName() {
    setShowStitchNameDialog(false);
    stopWasRequestedRef.current = false;
    executeMutation.mutate({
      step: "stitching",
      stitch_name: stitchNameInput.trim() || undefined,
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
      // Single versions — just run with defaults (backend uses active)
      stopWasRequestedRef.current = false;
      executeMutation.mutate({ step });
      return;
    }
    if (step === "orthomosaic") {
      try {
        const result = await UtilsService.dockerCheck();
        if (!result.available) {
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
    run?.outputs?.traits
  );

  async function _fetchAndTriggerDownload(
    url: string,
    fallbackFilename: string,
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
        </div>

        {/* Auto data-sync progress banner */}
        {pipelineType === "aerial" &&
          isRunning &&
          run.current_step === "data_sync" && (
            <div className="bg-muted/40 mb-4 flex items-center gap-3 rounded-lg border px-4 py-3 text-sm">
              <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-blue-500" />
              <div className="flex-1">
                <span className="font-medium">Preparing data…</span>
                <span className="text-muted-foreground ml-2">
                  Extracting GPS from images and syncing with platform log.
                </span>
              </div>
              {lastProgress !== null && (
                <Progress value={lastProgress} className="h-1.5 w-24" />
              )}
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
                    <strong>{uploadedOrthoCheck.filename}</strong> was found in
                    the Orthomosaic folder. Use it directly (skips GCP selection
                    and ODM generation) or generate a new one.
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isRegisteringOrtho || isRunning}
                    onClick={() => {
                      /* dismiss — user wants to run ODM normally */
                      queryClient.setQueryData(
                        ["check-uploaded-ortho", runId],
                        {
                          available: false,
                          filename: null,
                        }
                      );
                    }}
                  >
                    Generate with ODM
                  </Button>
                  <Button
                    size="sm"
                    disabled={isRegisteringOrtho || isRunning}
                    onClick={handleUseUploadedOrtho}
                  >
                    {isRegisteringOrtho && (
                      <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                    )}
                    {isRegisteringOrtho ? "Registering…" : "Use Uploaded"}
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
            {steps.map((step, idx) => {
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
                step.key === "orthomosaic" && !run.steps_completed?.gcp_selection
                  ? "GCP selection was skipped — orthomosaic accuracy may be reduced"
                  : step.key === "stitching" && capabilities && !capabilities.agrowstitch.available
                  ? "AgRowStitch not found — stitching will fail. Check vendor/AgRowStitch/ or set AGROWSTITCH_PATH."
                  : step.key === "stitching" && capabilities?.agrowstitch.available && !capabilities.cuda_available
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
                    if (step.key === "trait_extraction" && pipelineType === "aerial") {
                      return (
                        <TraitRecordsPanel
                          runId={runId}
                          onDelete={(id) => deleteTraitRecordMutation.mutate(id)}
                          isDeleting={deleteTraitRecordMutation.isPending}
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
                          isRunning={isRunning}
                          onDelete={(v) => deleteStitchMutation.mutate(v)}
                          onRename={(v, name) => renameStitchMutation.mutate({ version: v, name })}
                          isDeleting={deleteStitchMutation.isPending}
                        />
                      );
                    }
                    if (step.key === "associate_boundaries" && pipelineType === "ground") {
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
                          onDelete={(label) => deleteInferenceMutation.mutate(label)}
                          isDeleting={deleteInferenceMutation.isPending}
                        />
                      );
                    }
                    return undefined;
                  })()}
                />
              );
            })}
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

      {/* Stitching name prompt dialog */}
      <Dialog open={showStitchNameDialog} onOpenChange={setShowStitchNameDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Name this stitching run</DialogTitle>
            <DialogDescription>
              Optionally give this run a name so you can identify it later. You can rename it any time.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="stitch-name" className="text-sm">
              Name (optional)
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
            <Button variant="outline" onClick={() => setShowStitchNameDialog(false)}>
              Cancel
            </Button>
            <Button onClick={startStitchWithName}>Start</Button>
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
      <Dialog open={showAssocDialog} onOpenChange={(open) => !open && setShowAssocDialog(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Select Versions for Association</DialogTitle>
            <DialogDescription>
              Choose which stitch version and plot boundary version to associate.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {(pageStitchVersions?.length ?? 0) > 0 && (
              <div className="space-y-1">
                <Label className="text-sm">Stitch Version</Label>
                <select
                  className="border-input bg-background w-full rounded border px-3 py-2 text-sm"
                  value={assocStitchVersion ?? ""}
                  onChange={(e) => setAssocStitchVersion(Number(e.target.value))}
                >
                  {pageStitchVersions!.map((sv) => (
                    <option key={sv.version} value={sv.version}>
                      {sv.name ? `${sv.name} (v${sv.version})` : `v${sv.version}`}
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
                  onChange={(e) => setAssocBoundaryVersion(Number(e.target.value))}
                >
                  {plotBoundaryVersions!.map((bv) => (
                    <option key={bv.version} value={bv.version}>
                      {bv.name ? `${bv.name} (v${bv.version})` : `v${bv.version}`}
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
                <p>
                  Docker was not found. Download and install Docker Desktop,
                  then restart GEMI. The ODM image (~4 GB) will download
                  automatically the first time you run this step — no extra
                  setup needed.
                </p>
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
              onClick={() => {
                window.open(
                  "https://www.docker.com/products/docker-desktop/",
                  "_blank"
                );
              }}
            >
              Download Docker Desktop
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
