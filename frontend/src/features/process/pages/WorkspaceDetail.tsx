import {
  ArrowLeft,
  Plus,
  Plane,
  Navigation,
  ChevronRight,
  Loader2,
  Play,
  MoreVertical,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FilesService,
  PipelinesService,
  ProcessingService,
  ReferenceDataService,
  type PipelinePublic,
  type PipelineRunPublic,
  type FileUploadPublic,
  type ReferenceDatasetWithMatch,
  type ReferenceDatasetPublic,
} from "@/client";
import useCustomToast from "@/hooks/useCustomToast";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusBadgeClass(status: string) {
  switch (status) {
    case "completed":
      return "bg-green-500/10 text-green-700 hover:bg-green-500/20";
    case "running":
      return "bg-blue-500/10 text-blue-700 hover:bg-blue-500/20";
    case "failed":
      return "bg-red-500/10 text-red-700 hover:bg-red-500/20";
    default:
      return "bg-gray-500/10 text-gray-700 hover:bg-gray-500/20";
  }
}

// ── New Run dialog ────────────────────────────────────────────────────────────

interface NewRunDialogProps {
  pipeline: PipelinePublic;
  workspaceId: string;
  runs: PipelineRunPublic[];
  open: boolean;
  onClose: () => void;
}

function NewRunDialog({
  pipeline,
  workspaceId,
  runs,
  open,
  onClose,
}: NewRunDialogProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showErrorToast } = useCustomToast();
  const [selectedUploadId, setSelectedUploadId] = useState<string>("");
  const [filters, setFilters] = useState({ experiment: "", location: "", population: "", date: "" });
  const setFilter = (k: keyof typeof filters, v: string) =>
    setFilters((prev) => ({ ...prev, [k]: v }));

  const { data: fieldValues } = useQuery({
    queryKey: ["field-values-run", filters.experiment, filters.location, filters.population],
    queryFn: () =>
      FilesService.readFieldValues({
        experiment: filters.experiment || undefined,
        location: filters.location || undefined,
        population: filters.population || undefined,
      }),
    enabled: open,
    staleTime: 30_000,
  });

  const { data: uploadsData, isLoading: uploadsLoading } = useQuery({
    queryKey: ["files"],
    queryFn: () => FilesService.readFiles(),
    enabled: open,
  });

  // Show only data types that can actually be processed by each pipeline type.
  // Ardupilot Logs, Synced Metadata, Weather Data, Field Design etc. are support files, not inputs.
  const AERIAL_TYPES = new Set(["Image Data", "Orthomosaic"])
  const GROUND_TYPES = new Set(["Farm-ng Binary File", "Image Data"])

  const displayUploads = (uploadsData?.data ?? []).filter((u: FileUploadPublic) => {
    if (!(pipeline.type === "aerial" ? AERIAL_TYPES.has(u.data_type) : GROUND_TYPES.has(u.data_type))) return false;
    if (filters.experiment && !u.experiment.toLowerCase().includes(filters.experiment.toLowerCase())) return false;
    if (filters.location  && !u.location.toLowerCase().includes(filters.location.toLowerCase()))   return false;
    if (filters.population && !u.population.toLowerCase().includes(filters.population.toLowerCase())) return false;
    if (filters.date      && !u.date.includes(filters.date))                                       return false;
    return true;
  });

  const selectedUpload = displayUploads.find(
    (u: FileUploadPublic) => u.id === selectedUploadId
  );

  const createMutation = useMutation({
    mutationFn: async (upload: FileUploadPublic) => {
      const run = await PipelinesService.createRun({
        pipelineId: pipeline.id,
        requestBody: {
          pipeline_id: pipeline.id,
          date: upload.date,
          experiment: upload.experiment,
          location: upload.location,
          population: upload.population,
          platform: upload.platform ?? "",
          sensor: upload.sensor ?? "",
          file_upload_id: upload.id,
        },
      });
      if (upload.data_type === "Orthomosaic") {
        // Orthomosaic upload: register it directly, marking data_sync / gcp_selection /
        // orthomosaic as complete so only plot_boundary_prep onward is needed.
        try {
          const base = (window as any).__GEMI_BACKEND_URL__ ?? "";
          await fetch(`${base}/api/v1/pipeline-runs/${run.id}/use-uploaded-ortho`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
            },
            body: JSON.stringify({ save_mode: "new_version" }),
          });
        } catch {
          // TIF may not yet be on disk — user can register later from the run page
        }
      } else {
        // Silently try to reuse existing boundaries from a previous run.
        // Ground: reuses plot_borders.csv  Aerial: reuses Plot-Boundary-WGS84.geojson
        try {
          await ProcessingService.applyBoundaries({ id: run.id });
        } catch {
          // no boundaries yet — that's fine
        }
      }
      return run;
    },
    onSuccess: (run: PipelineRunPublic) => {
      queryClient.invalidateQueries({ queryKey: ["runs", pipeline.id] });
      onClose();
      navigate({
        to: "/process/$workspaceId/run/$runId",
        params: { workspaceId, runId: run.id },
      });
    },
    onError: () => showErrorToast("Failed to create run"),
  });

  const handleCreate = () => {
    if (!selectedUpload) return;
    createMutation.mutate(selectedUpload);
  };

  const allUploads = (uploadsData?.data ?? []).filter((u: FileUploadPublic) =>
    pipeline.type === "aerial" ? AERIAL_TYPES.has(u.data_type) : GROUND_TYPES.has(u.data_type)
  );

  const includedUploadIds = new Set(runs.map((r) => r.file_upload_id).filter(Boolean));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>New Run — {pipeline.name}</DialogTitle>
          <DialogDescription>
            Select the uploaded dataset to process.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {uploadsLoading ? (
            <div className="text-muted-foreground flex items-center gap-2 text-sm py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading uploads…
            </div>
          ) : allUploads.length === 0 ? (
            <p className="text-muted-foreground text-sm py-4">
              No compatible datasets found. Upload data in the Files tab first.
            </p>
          ) : (
            <>
              {/* Filter row */}
              <div className="grid grid-cols-4 gap-2">
                {(["experiment", "location", "population", "date"] as const).map((field) => {
                  const suggestions: string[] = fieldValues?.[field] ?? []
                  const listId = suggestions.length ? `filter-${field}` : undefined
                  return (
                    <div key={field}>
                      <input
                        list={listId}
                        placeholder={field.charAt(0).toUpperCase() + field.slice(1)}
                        value={filters[field]}
                        onChange={(e) => setFilter(field, e.target.value)}
                        className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-primary h-8 w-full rounded-md border px-3 text-xs focus:border-transparent focus:ring-2 focus:outline-none"
                      />
                      {listId && (
                        <datalist id={listId}>
                          {suggestions.map((s) => <option key={s} value={s} />)}
                        </datalist>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Table */}
              <div className="border rounded-md overflow-hidden">
                <div className="max-h-64 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/60 sticky top-0 z-10">
                      <tr>
                        <th className="px-2 py-1.5 w-5" />
                          {["Type", "Experiment", "Location", "Population", "Date", "Platform", "Sensor", "Files"].map((h) => (
                          <th key={h} className="px-2 py-1.5 text-left font-medium text-muted-foreground whitespace-nowrap">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {displayUploads.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                            No datasets match the filters.
                          </td>
                        </tr>
                      ) : (
                        displayUploads.map((u: FileUploadPublic) => {
                          const included = includedUploadIds.has(u.id);
                          return (
                            <tr
                              key={u.id}
                              onClick={() => !included && setSelectedUploadId(u.id)}
                              className={`border-t transition-colors ${
                                included
                                  ? "opacity-50 cursor-not-allowed"
                                  : u.id === selectedUploadId
                                  ? "bg-primary/10 cursor-pointer"
                                  : "hover:bg-muted/50 cursor-pointer"
                              }`}
                            >
                              <td className="px-2 py-1.5">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span
                                      className={`inline-block w-2 h-2 rounded-full ${
                                        included ? "bg-green-500" : "bg-orange-400"
                                      }`}
                                    />
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {included ? "Already included — delete the run to re-add" : "Not Included"}
                                  </TooltipContent>
                                </Tooltip>
                              </td>
                              <td className="px-2 py-1.5 whitespace-nowrap">
                                {u.data_type === "Orthomosaic" ? (
                                  <span className="inline-flex items-center rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-700 ring-1 ring-inset ring-violet-500/20">Ortho</span>
                                ) : (
                                  <span className="inline-flex items-center rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-700 ring-1 ring-inset ring-sky-500/20">Images</span>
                                )}
                              </td>
                              <td className="px-2 py-1.5 font-medium max-w-[120px] truncate">{u.experiment}</td>
                              <td className="px-2 py-1.5 text-muted-foreground max-w-[100px] truncate">{u.location}</td>
                              <td className="px-2 py-1.5 text-muted-foreground max-w-[100px] truncate">{u.population}</td>
                              <td className="px-2 py-1.5 tabular-nums whitespace-nowrap">{u.date}</td>
                              <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">{u.platform ?? "—"}</td>
                              <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">{u.sensor ?? "—"}</td>
                              <td className="px-2 py-1.5 tabular-nums text-muted-foreground text-right">{u.file_count}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!selectedUpload || createMutation.isPending || includedUploadIds.has(selectedUploadId)}
          >
            {createMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            Start Run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Add Reference Data dialog ─────────────────────────────────────────────────

interface AddReferenceDataDialogProps {
  workspaceId: string
  open: boolean
  onClose: () => void
  alreadyLinkedIds: Set<string>
}

function AddReferenceDataDialog({
  workspaceId,
  open,
  onClose,
  alreadyLinkedIds,
}: AddReferenceDataDialogProps) {
  const queryClient = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const [selectedId, setSelectedId] = useState<string>("")
  const [filters, setFilters] = useState({ experiment: "", location: "", population: "" })
  const setFilter = (k: keyof typeof filters, v: string) =>
    setFilters((prev) => ({ ...prev, [k]: v }))

  const { data: allDatasets = [], isLoading } = useQuery({
    queryKey: ["reference-data-all", filters.experiment, filters.location, filters.population],
    queryFn: () =>
      ReferenceDataService.listDatasets({
        experiment: filters.experiment || undefined,
        location: filters.location || undefined,
        population: filters.population || undefined,
      }),
    enabled: open,
  })

  const associateMutation = useMutation({
    mutationFn: () =>
      ReferenceDataService.associateDataset({
        workspaceId,
        datasetId: selectedId,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["workspace-ref-data", workspaceId] })
      const report = data.match_report
      if (report && report.unmatched > 0) {
        showSuccessToast(
          `"${data.name}" added — ${report.matched}/${report.total} plots matched.`
        )
      } else {
        showSuccessToast(`"${data.name}" added to workspace.`)
      }
      setSelectedId("")
      onClose()
    },
    onError: () => showErrorToast("Failed to associate dataset"),
  })

  const filteredDatasets = allDatasets.filter(
    (d: ReferenceDatasetPublic) => !alreadyLinkedIds.has(d.id)
  )

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add Reference Data</DialogTitle>
          <DialogDescription>
            Select an uploaded reference dataset to associate with this workspace.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Filters */}
          <div className="grid grid-cols-3 gap-2">
            {(["experiment", "location", "population"] as const).map((f) => (
              <input
                key={f}
                placeholder={f.charAt(0).toUpperCase() + f.slice(1)}
                value={filters[f]}
                onChange={(e) => setFilter(f, e.target.value)}
                className="border-input bg-background text-foreground placeholder:text-muted-foreground h-8 w-full rounded-md border px-3 text-xs"
              />
            ))}
          </div>

          {isLoading ? (
            <div className="text-muted-foreground flex items-center gap-2 text-sm py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : filteredDatasets.length === 0 ? (
            <p className="text-muted-foreground text-sm py-4">
              No reference datasets found. Upload one in the Files tab.
            </p>
          ) : (
            <div className="border rounded-md overflow-hidden">
              <div className="max-h-64 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60 sticky top-0">
                    <tr>
                      <th className="px-2 py-1.5 w-5" />
                      {["Name", "Experiment", "Location", "Population", "Date", "Plots"].map((h) => (
                        <th key={h} className="px-2 py-1.5 text-left font-medium text-muted-foreground">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDatasets.map((d: ReferenceDatasetPublic) => (
                      <tr
                        key={d.id}
                        onClick={() => setSelectedId(d.id)}
                        className={`border-t cursor-pointer transition-colors ${
                          d.id === selectedId
                            ? "bg-primary/10"
                            : "hover:bg-muted/50"
                        }`}
                      >
                        <td className="px-2 py-1.5">
                          <input
                            type="radio"
                            readOnly
                            checked={d.id === selectedId}
                            className="h-3 w-3"
                          />
                        </td>
                        <td className="px-2 py-1.5 font-medium max-w-[140px] truncate">{d.name}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{d.experiment}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{d.location}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{d.population}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{d.date}</td>
                        <td className="px-2 py-1.5 tabular-nums text-right">{d.plot_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!selectedId || associateMutation.isPending}
            onClick={() => associateMutation.mutate()}
          >
            {associateMutation.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Adding…</>
            ) : (
              "Add to Workspace"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Reference Data section ────────────────────────────────────────────────────

function WorkspaceReferenceDataSection({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient()
  const { showErrorToast } = useCustomToast()
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<ReferenceDatasetWithMatch | null>(null)
  const [unmatchedDataset, setUnmatchedDataset] = useState<ReferenceDatasetWithMatch | null>(null)

  const { data: datasets = [], isLoading } = useQuery({
    queryKey: ["workspace-ref-data", workspaceId],
    queryFn: () => ReferenceDataService.listWorkspaceDatasets({ workspaceId }),
  })

  const removeMutation = useMutation({
    mutationFn: (datasetId: string) =>
      ReferenceDataService.removeDatasetFromWorkspace({ workspaceId, datasetId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace-ref-data", workspaceId] })
      setConfirmRemove(null)
    },
    onError: () => showErrorToast("Failed to remove dataset"),
  })

  const linkedIds = new Set((datasets as ReferenceDatasetWithMatch[]).map((d) => d.id))

  return (
    <>
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-medium">Reference Data</h2>
          <Button size="sm" variant="outline" onClick={() => setAddDialogOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            Add Reference Data
          </Button>
        </div>

        {isLoading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : (datasets as ReferenceDatasetWithMatch[]).length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No reference data associated. Upload in the Files tab, then add here.
          </p>
        ) : (
          <div className="space-y-2">
            {(datasets as ReferenceDatasetWithMatch[]).map((d) => {
              const report = d.match_report
              const hasUnmatched = report && report.unmatched > 0
              return (
                <div
                  key={d.id}
                  className="flex items-center justify-between rounded-md border px-4 py-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {hasUnmatched && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                        </TooltipTrigger>
                        <TooltipContent>
                          {report!.unmatched} of {report!.total} plots unmatched
                        </TooltipContent>
                      </Tooltip>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{d.name}</span>
                        {report && (
                          <span
                            className="text-xs text-muted-foreground cursor-pointer hover:underline"
                            onClick={() => hasUnmatched && setUnmatchedDataset(d)}
                          >
                            {report.matched}/{report.total} plots matched
                          </span>
                        )}
                      </div>
                      <p className="text-muted-foreground text-xs mt-0.5">
                        {[d.experiment, d.location, d.population, d.date]
                          .filter(Boolean)
                          .join(" / ")}{" "}
                        · {d.trait_columns.join(", ")}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => setConfirmRemove(d)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <AddReferenceDataDialog
        workspaceId={workspaceId}
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        alreadyLinkedIds={linkedIds}
      />

      {/* Confirm remove */}
      <Dialog open={!!confirmRemove} onOpenChange={(v) => !v && setConfirmRemove(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Reference Data</DialogTitle>
            <DialogDescription>
              Remove <strong>{confirmRemove?.name}</strong> from this workspace?
              The dataset will not be deleted — you can re-add it later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRemove(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={removeMutation.isPending}
              onClick={() => confirmRemove && removeMutation.mutate(confirmRemove.id)}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unmatched rows detail */}
      <Dialog open={!!unmatchedDataset} onOpenChange={(v) => !v && setUnmatchedDataset(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Unmatched Plots — {unmatchedDataset?.name}</DialogTitle>
            <DialogDescription>
              These reference plots could not be matched to any plot in this workspace.
              Verify that Experiment, Location, Population, and Plot ID match your pipeline runs.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-xs border rounded">
              <thead className="bg-muted/60">
                <tr>
                  {["plot_id", "col", "row"].map((h) => (
                    <th key={h} className="px-2 py-1.5 text-left font-medium text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {unmatchedDataset?.match_report?.unmatched_plots?.map((p, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-2 py-1.5">{p.plot_id || "—"}</td>
                    <td className="px-2 py-1.5">{p.col || "—"}</td>
                    <td className="px-2 py-1.5">{p.row || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnmatchedDataset(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ── Pipeline card with its runs ───────────────────────────────────────────────

interface PipelineCardProps {
  pipeline: PipelinePublic;
  workspaceId: string;
}

function PipelineCard({ pipeline, workspaceId }: PipelineCardProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showErrorToast } = useCustomToast();
  const [newRunOpen, setNewRunOpen] = useState(false);
  const [confirmDeletePipeline, setConfirmDeletePipeline] = useState(false);
  const [confirmDeleteRun, setConfirmDeleteRun] =
    useState<PipelineRunPublic | null>(null);

  const { data: runsData, isLoading } = useQuery({
    queryKey: ["runs", pipeline.id],
    queryFn: () => PipelinesService.readRuns({ pipelineId: pipeline.id }),
  });

  const runs = runsData?.data ?? [];

  const deletePipelineMutation = useMutation({
    mutationFn: () => PipelinesService.delete({ id: pipeline.id }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["pipelines", workspaceId] }),
    onError: () => showErrorToast("Failed to delete pipeline"),
  });

  const deleteRunMutation = useMutation({
    mutationFn: (runId: string) => PipelinesService.deleteRun({ id: runId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["runs", pipeline.id] });
      setConfirmDeleteRun(null);
    },
    onError: () => showErrorToast("Failed to delete run"),
  });

  const isAerial = pipeline.type === "aerial";
  const iconCls = isAerial ? "bg-blue-500/10" : "bg-green-500/10";
  const iconColor = isAerial ? "text-blue-600" : "text-green-600";
  const Icon = isAerial ? Plane : Navigation;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-lg ${iconCls}`}
              >
                <Icon className={`h-5 w-5 ${iconColor}`} />
              </div>
              <div>
                <CardTitle className="text-base">{pipeline.name}</CardTitle>
                <CardDescription className="capitalize">
                  {pipeline.type} pipeline
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  navigate({
                    to: "/process/$workspaceId/pipeline",
                    params: { workspaceId },
                    search: {
                      type: pipeline.type as "aerial" | "ground",
                      pipelineId: pipeline.id,
                    },
                  })
                }
              >
                Settings
              </Button>
              <Button size="sm" onClick={() => setNewRunOpen(true)}>
                <Plus className="mr-1 h-4 w-4" />
                New Run
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    className="text-red-600"
                    onClick={() => setConfirmDeletePipeline(true)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete Pipeline
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </CardHeader>

        {(isLoading || runs.length > 0) && (
          <CardContent>
            {isLoading ? (
              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading runs…
              </div>
            ) : (
              <div className="space-y-2">
                {runs.map((run: PipelineRunPublic) => (
                  <div
                    key={run.id}
                    className="hover:bg-muted/50 flex cursor-pointer items-center justify-between rounded-md p-2 transition-colors"
                    onClick={() =>
                      navigate({
                        to: "/process/$workspaceId/run/$runId",
                        params: { workspaceId, runId: run.id },
                      })
                    }
                  >
                    <div className="flex items-center gap-3">
                      {run.status === "failed" && (() => {
                        const failedStep = run.current_step;
                        const COMPUTE_STEPS = new Set(["stitching", "orthomosaic", "trait_extraction", "inference", "data_sync"]);
                        if (!failedStep || !COMPUTE_STEPS.has(failedStep)) return null;
                        const stepLabel: Record<string, string> = {
                          stitching: "Stitching (AgRowStitch)",
                          orthomosaic: "Orthomosaic Generation",
                          trait_extraction: "Trait Extraction",
                          inference: "Inference",
                          data_sync: "Data Sync",
                        };
                        return (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex items-center justify-center">
                                <AlertTriangle className="h-4 w-4 text-red-500" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {stepLabel[failedStep] ?? failedStep} failed. It is recommended to delete that failed run if possible.
                            </TooltipContent>
                          </Tooltip>
                        );
                      })()}
                      <Badge
                        className={statusBadgeClass(run.status ?? "pending")}
                      >
                        {run.status ?? "pending"}
                      </Badge>
                      <span className="text-sm font-medium">{run.date}</span>
                      <span className="text-muted-foreground text-sm">
                        {run.experiment} / {run.location} / {run.population} / {run.platform} / {run.sensor}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <ChevronRight className="text-muted-foreground h-4 w-4" />
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          asChild
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                          >
                            <MoreVertical className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <DropdownMenuItem
                            className="text-red-600"
                            onClick={() => setConfirmDeleteRun(run)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete Run
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      <NewRunDialog
        pipeline={pipeline}
        workspaceId={workspaceId}
        runs={runs}
        open={newRunOpen}
        onClose={() => setNewRunOpen(false)}
      />

      {/* Delete pipeline confirmation */}
      <Dialog
        open={confirmDeletePipeline}
        onOpenChange={(v) => !v && setConfirmDeletePipeline(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Pipeline</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{pipeline.name}</strong>?
              All runs and output references will be removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDeletePipeline(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deletePipelineMutation.isPending}
              onClick={() =>
                deletePipelineMutation.mutate(undefined, {
                  onSuccess: () => setConfirmDeletePipeline(false),
                })
              }
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete run confirmation */}
      <Dialog
        open={!!confirmDeleteRun}
        onOpenChange={(v) => !v && setConfirmDeleteRun(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Run</DialogTitle>
            <DialogDescription>
              Delete the run for <strong>{confirmDeleteRun?.date}</strong>?
              Output file references will be removed from the database.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteRun(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteRunMutation.isPending}
              onClick={() =>
                confirmDeleteRun &&
                deleteRunMutation.mutate(confirmDeleteRun.id)
              }
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function WorkspaceDetail() {
  const navigate = useNavigate();
  const { workspaceId } = useParams({ from: "/_layout/process/$workspaceId/" });

  const { data: workspace } = useQuery({
    queryKey: ["workspaces", workspaceId],
    queryFn: () =>
      import("@/client").then((m) =>
        m.WorkspacesService.readOne({ id: workspaceId })
      ),
  });

  const { data: pipelinesData, isLoading } = useQuery({
    queryKey: ["pipelines", workspaceId],
    queryFn: () => PipelinesService.readAll({ workspaceId }),
  });

  const pipelines = pipelinesData?.data ?? [];

  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto max-w-5xl p-8">
        <div className="mb-8 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate({ to: "/process" })}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">
              {workspace?.name ?? "Workspace"}
            </h1>
            <p className="text-muted-foreground text-sm">
              {workspace?.description}
            </p>
          </div>
        </div>

        {/* Create new pipeline */}
        <div className="mb-8">
          <h2 className="mb-1 text-lg font-medium">Create a new pipeline</h2>
          <p className="text-muted-foreground mb-4 text-sm">
            Choose the type of sensing data you want to process
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card
              className="hover:border-primary cursor-pointer transition-colors"
              onClick={() =>
                navigate({
                  to: "/process/$workspaceId/pipeline",
                  params: { workspaceId },
                  search: { type: "aerial" },
                })
              }
            >
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                    <Plane className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <CardTitle>Aerial Pipeline</CardTitle>
                    <CardDescription>Process drone imagery</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-sm">
                  GCP selection → Orthomosaic → Plot boundaries → Train → Traits
                </p>
              </CardContent>
            </Card>

            <Card
              className="hover:border-primary cursor-pointer transition-colors"
              onClick={() =>
                navigate({
                  to: "/process/$workspaceId/pipeline",
                  params: { workspaceId },
                  search: { type: "ground" },
                })
              }
            >
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
                    <Navigation className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <CardTitle>Ground Pipeline</CardTitle>
                    <CardDescription>Process Amiga rover data</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-sm">
                  Plot marking → AgRowStitch → Plot boundaries → Train → Traits
                </p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Existing pipelines */}
        <div className="mb-10">
          <h2 className="mb-4 text-lg font-medium">Pipelines</h2>
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : pipelines.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No pipelines yet. Create one above to get started.
            </p>
          ) : (
            <div className="space-y-3">
              {pipelines.map((pipeline: PipelinePublic) => (
                <PipelineCard
                  key={pipeline.id}
                  pipeline={pipeline}
                  workspaceId={workspaceId}
                />
              ))}
            </div>
          )}
        </div>

        {/* Reference Data */}
        <div className="border-t pt-8">
          <WorkspaceReferenceDataSection workspaceId={workspaceId} />
        </div>
      </div>
    </div>
  );
}
