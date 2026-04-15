/**
 * AnalyzeDashboard — top-level Analyze page.
 *
 * Three sections (NavSidebar navigation):
 *  - Table:  workspace-dropdown-filtered table of TraitRecords.
 *  - Query:  query plots by field values with autocomplete.
 *  - Map:    satellite → ortho image overlay → trait polygons.
 */

import React, { useMemo, useState, useEffect } from "react";
import { PlotImage, type Prediction as SharedPrediction } from "@/components/Common/PlotImage";
import { useQuery, useQueries } from "@tanstack/react-query";
import {
  type ColumnDef,
  type ColumnFiltersState,
  getCoreRowModel,
  getFilteredRowModel,
  getFacetedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ColumnFilter } from "@/features/files/components/ColumnFilter";
import {
  BarChart2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  RefreshCw,
  Eye,
  EyeOff,
  Loader2,
  Pin,
  PinOff,
  Scan,
  Tag,
  X as XIcon,
  Map as MapIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Table2,
  LayoutGrid,
} from "lucide-react";
import {
  useExpandable,
  ExpandButton,
  FullscreenModal,
} from "@/components/Common/ExpandableSection";
import { analyzeApi, versionLabel, type TraitRecord } from "../api";
import {
  COL_KEY_SET,
  ROW_KEY_SET,
  deduplicateKeys,
  orderColumns,
  lookupProperty,
  matchesTextFilter,
  PLOT_FILTER_FIELDS,
  type PlotFilterKey,
} from "../utils/traitAliases";
import { TraitMap } from "../components/TraitMap";
import { MetricSelector } from "../components/MetricSelector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MasterTableTab } from "../components/MasterTable";
import { NavSidebar } from "@/components/Common/NavSidebar";

// ── Helpers ────────────────────────────────────────────────────────────────────

function apiUrl(path: string): string {
  const base = (window as any).__GEMI_BACKEND_URL__ ?? "";
  return base ? `${base}${path}` : path;
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function featuresToCsv(features: GeoJSON.Feature[]): string {
  if (!features.length) return "";
  const cols = [
    ...new Set(features.flatMap((f) => Object.keys(f.properties ?? {}))),
  ];
  const header = cols.join(",");
  const lines = features.map((f) =>
    cols
      .map((c) => {
        const v = f.properties?.[c];
        return typeof v === "string" && v.includes(",")
          ? `"${v}"`
          : String(v ?? "");
      })
      .join(",")
  );
  return [header, ...lines].join("\n");
}

/** Downloads a single plot image; resolves when complete. */
async function fetchAndDownloadPlotImage(
  recordId: string,
  plotId: string
): Promise<void> {
  const endpoint = apiUrl(
    `/api/v1/analyze/trait-records/${recordId}/plot-image/${plotId}`
  );
  const token = localStorage.getItem("access_token") || "";
  try {
    const res = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `plot_${plotId}.png`;
    a.click();
    URL.revokeObjectURL(url);
  } catch {}
}

function getPlotId(
  properties: Record<string, unknown>,
  fallback: number | string
): string {
  return String(
    properties?.plot_id ?? properties?.plot ?? properties?.accession ?? fallback
  );
}

// COL_KEY_SET, ROW_KEY_SET, deduplicateKeys, orderColumns, lookupProperty,
// matchesTextFilter, PLOT_FILTER_FIELDS, PlotFilterKey — all imported from
// ../utils/traitAliases

// ── Types (re-exported from shared for local use) ─────────────────────────────

// ── Version badge ──────────────────────────────────────────────────────────────

function VersionBadge({
  version,
  name,
  label,
}: {
  version: number | null;
  name: string | null | undefined;
  label: string;
}) {
  if (version == null)
    return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <div className="flex flex-col gap-0.5">
      <Badge variant="outline" className="w-fit text-xs">
        {label} {versionLabel(version, name)}
      </Badge>
    </div>
  );
}

// ── Plot view dialog ──────────────────────────────────────────────────────────

function PlotViewDialog({
  recordId,
  plotId,
  properties,
  metricColumns,
  runId,
  isGroundPipeline = false,
  onClose,
}: {
  recordId: string;
  plotId: string;
  properties: Record<string, unknown>;
  metricColumns: string[];
  runId?: string;
  isGroundPipeline?: boolean;
  onClose: () => void;
}) {
  const [showDetections, setShowDetections] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [activeClass, setActiveClass] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | undefined>(undefined);

  const exp = useExpandable();

  // Fetch inference results (re-runs when model changes)
  const { data: inferenceData } = useQuery({
    queryKey: ["inference-plot-dialog", runId, selectedModel],
    queryFn: async () => {
      const token = localStorage.getItem("access_token") || "";
      const modelParam = selectedModel ? `?model=${encodeURIComponent(selectedModel)}` : "";
      const res = await fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/inference-results${modelParam}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!runId,
    staleTime: 60_000,
  });

  const availableModels: string[] = inferenceData?.models ?? [];

  const predictions = useMemo<SharedPrediction[]>(() => {
    if (!inferenceData?.available) return [];
    const imgList: Array<{ name: string; plot?: string }> = inferenceData.images ?? [];
    const preds: SharedPrediction[] = inferenceData.predictions ?? [];
    const imgToPlot = new Map(imgList.map((im) => [im.name, String(im.plot ?? "")]));
    return preds.filter((p) => imgToPlot.get(p.image) === plotId);
  }, [inferenceData, plotId]);

  const uniqueClasses = useMemo(() => [...new Set(predictions.map((p) => p.class))].sort(), [predictions]);
  const hasDetections = predictions.length > 0;
  const accession = lookupProperty(properties, "accession");

  const detectionControls = (
    <>
      {availableModels.length > 1 && (
        <select
          className="border-input bg-background rounded border px-1.5 py-0.5 text-xs"
          value={selectedModel ?? inferenceData?.active_model ?? ""}
          onChange={(e) => setSelectedModel(e.target.value)}
        >
          {availableModels.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      )}
      {hasDetections && (
        <>
          <button
            onClick={() => setShowDetections((v) => !v)}
            className={`flex items-center gap-1 text-xs rounded px-2 py-0.5 border transition-colors ${showDetections ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground border-input hover:text-foreground"}`}
          >
            <Scan className="w-3 h-3" />
            {showDetections ? "Hide detections" : "Show detections"}
          </button>
          {showDetections && (
            <>
              <button
                onClick={() => setShowLabels((v) => !v)}
                className={`flex items-center gap-1 text-xs rounded px-2 py-0.5 border transition-colors ${showLabels ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground border-input hover:text-foreground"}`}
              >
                <Tag className={`w-3 h-3 ${showLabels ? "" : "opacity-40"}`} />
                Labels
              </button>
              {uniqueClasses.length > 1 && (
                <div className="flex items-center gap-0.5 border rounded text-xs">
                  <button onClick={() => setActiveClass((c) => { const i = uniqueClasses.indexOf(c ?? ""); return i <= 0 ? null : uniqueClasses[i - 1] })} className="px-1.5 py-0.5 hover:bg-muted"><ChevronLeft className="w-3 h-3" /></button>
                  <span className="px-1 min-w-[56px] text-center truncate">{activeClass ?? "All"}</span>
                  <button onClick={() => setActiveClass((c) => { const i = uniqueClasses.indexOf(c ?? ""); return i >= uniqueClasses.length - 1 ? null : uniqueClasses[i + 1] })} className="px-1.5 py-0.5 hover:bg-muted"><ChevronRight className="w-3 h-3" /></button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
  );

  const statsContent = (
    <div className="space-y-1 mt-2 shrink-0">
      {accession != null && (
        <p className="text-xs text-muted-foreground">Accession: {String(accession)}</p>
      )}
      {metricColumns.map((col) => {
        const v = properties[col];
        if (typeof v !== "number") return null;
        return (
          <div key={col} className="flex justify-between text-xs">
            <span className="text-muted-foreground">{col.replace(/_/g, " ")}</span>
            <span className="font-mono">{v.toFixed(3)}</span>
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      <Dialog open={!exp.isExpanded} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-lg flex flex-col [&>button:last-child]:hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle asChild>
              <div className="flex items-center gap-2 pr-1 flex-wrap">
                <span className="text-sm font-semibold flex-1">Plot {plotId}</span>
                {detectionControls}
                <div className="flex items-center gap-0.5 border-l pl-2 ml-1">
                  <ExpandButton onClick={exp.open} title="Expand to fullscreen" />
                  <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-sm opacity-70 hover:opacity-100 transition-opacity" title="Close">
                    <XIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </DialogTitle>
          </DialogHeader>
          <div style={{ height: 320 }}>
            <PlotImage
              recordId={recordId}
              plotId={plotId}
              rotate={isGroundPipeline}
              predictions={predictions}
              showDetections={showDetections}
              showLabels={showLabels}
              activeClass={activeClass}
            />
          </div>
          {statsContent}
        </DialogContent>
      </Dialog>

      <FullscreenModal
        open={exp.isExpanded}
        onClose={() => { exp.close(); onClose(); }}
        title={`Plot ${plotId}`}
        headerExtra={<div className="flex items-center gap-2">{detectionControls}</div>}
      >
        <div className="flex flex-col h-full p-4 gap-3">
          <div className="flex-1 min-h-0">
            <PlotImage
              recordId={recordId}
              plotId={plotId}
              rotate={isGroundPipeline}
              predictions={predictions}
              showDetections={showDetections}
              showLabels={showLabels}
              activeClass={activeClass}
            />
          </div>
          {statsContent}
        </div>
      </FullscreenModal>
    </>
  );
}

// ── Expandable per-plot table ──────────────────────────────────────────────────

// PLOT_FILTER_FIELDS, PlotFilterKey, matchesTextFilter — imported from ../utils/traitAliases

interface KeptPlot {
  recordId: string;
  plotId: string;
  properties: Record<string, unknown>;
  metricColumns: string[];
  recordLabel: string;
}

function ExpandedPlotTable({ recordId, runId, isGroundPipeline = false }: { recordId: string; runId?: string; isGroundPipeline?: boolean }) {
  const [textFilters, setTextFilters] = useState<Record<PlotFilterKey, string>>(
    { col: "", row: "", plot: "", accession: "", location: "", crop: "", rep: "" }
  );
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  const [viewingPlot, setViewingPlot] = useState<{
    plotId: string;
    properties: Record<string, unknown>;
    showDetections?: boolean;
  } | null>(null);



  const { data, isLoading } = useQuery({
    queryKey: ["trait-record-geojson", recordId],
    queryFn: () => analyzeApi.getTraitRecordGeojson(recordId),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 px-6 py-4 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading plot data…
      </div>
    );
  }

  const features = data?.geojson?.features ?? [];
  if (!features.length) {
    return (
      <p className="text-muted-foreground px-6 py-3 text-sm">
        No plot data found.
      </p>
    );
  }

  // Build deduplicated + ordered column list with COL/ROW first
  const allKeys = [
    ...new Set(features.flatMap((f) => Object.keys(f.properties ?? {}))),
  ];
  const numCols = data?.metric_columns ?? [];
  const numColsSet = new Set(numCols);
  const metaCols = deduplicateKeys(allKeys).filter(
    (k) => !["", "geometry"].includes(k) && !numColsSet.has(k)
  );
  const cols = orderColumns(allKeys, metaCols, numCols);

  // Apply text filters
  const filteredFeatures = features.filter((f) => {
    const p = f.properties ?? {};
    return PLOT_FILTER_FIELDS.every((key) =>
      matchesTextFilter(p, key, textFilters[key])
    );
  });

  const hasAnyFilter = PLOT_FILTER_FIELDS.some(
    (k) => textFilters[k].trim() !== ""
  );

  async function handleDownloadImage(plotId: string) {
    setDownloadingIds((prev) => new Set([...prev, plotId]));
    await fetchAndDownloadPlotImage(recordId, plotId);
    setDownloadingIds((prev) => {
      const next = new Set(prev);
      next.delete(plotId);
      return next;
    });
  }

  function handleDownloadCsv() {
    downloadCsv(featuresToCsv(filteredFeatures), `traits_${recordId}.csv`);
  }

  return (
    <div className="bg-muted/20 border-t">
      {/* Text filters */}
      <div className="flex flex-wrap items-center gap-2 px-6 py-2 border-b">
        {PLOT_FILTER_FIELDS.map((field) => (
          <Input
            key={field}
            className="h-7 text-xs w-24"
            placeholder={field.toUpperCase()}
            value={textFilters[field]}
            onChange={(e) =>
              setTextFilters((prev) => ({ ...prev, [field]: e.target.value }))
            }
          />
        ))}
        {hasAnyFilter && (
          <button
            onClick={() =>
              setTextFilters({
                col: "", row: "", plot: "", accession: "", location: "", crop: "", rep: "",
              })
            }
            className="text-primary text-xs hover:underline"
          >
            Clear
          </button>
        )}
      </div>

      <div className="flex items-center justify-between px-6 py-2">
        <p className="text-muted-foreground text-xs">
          {filteredFeatures.length}
          {hasAnyFilter ? ` / ${features.length}` : ""} plots ·{" "}
          {numCols.join(", ")}
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={handleDownloadCsv}
        >
          <Download className="mr-1.5 h-3 w-3" />
          Download CSV
        </Button>
      </div>

      <div className="max-h-64 overflow-x-auto overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {cols.map((c) => (
                <TableHead
                  key={c}
                  className="px-3 py-1.5 text-xs whitespace-nowrap"
                >
                  {c.replace(/_/g, " ")}
                </TableHead>
              ))}
              <TableHead className="px-3 py-1.5 text-xs w-20 text-right">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredFeatures.map((f, i) => {
              const plotId = getPlotId(f.properties ?? {}, i);
              const isDownloading = downloadingIds.has(plotId);
              return (
                <TableRow key={i} className="text-xs">
                  {cols.map((c) => {
                    const v = lookupProperty(f.properties ?? {}, c);
                    const isPos = COL_KEY_SET.has(c.toLowerCase()) || ROW_KEY_SET.has(c.toLowerCase());
                    return (
                      <TableCell key={c} className="px-3 py-1 font-mono">
                        {typeof v === "number"
                          ? isPos ? String(Math.round(v)) : v.toFixed(3)
                          : String(v ?? "—")}
                      </TableCell>
                    );
                  })}
                  <TableCell className="px-3 py-1 text-right">
                    <div className="flex items-center justify-end gap-0.5">
                      {/* View */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        title="View plot image"
                        onClick={(e) => {
                          e.stopPropagation();
                          setViewingPlot({
                            plotId,
                            properties: f.properties ?? {},
                          });
                        }}
                      >
                        <Eye className="h-3 w-3" />
                      </Button>
                      {/* Download */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        title={
                          isDownloading ? "Downloading…" : "Download plot image"
                        }
                        disabled={isDownloading}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownloadImage(plotId);
                        }}
                      >
                        {isDownloading ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Download className="h-3 w-3" />
                        )}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Plot view dialog */}
      {viewingPlot && (
        <PlotViewDialog
          recordId={recordId}
          plotId={viewingPlot.plotId}
          properties={viewingPlot.properties}
          metricColumns={numCols}
          runId={runId}
          isGroundPipeline={isGroundPipeline}
          onClose={() => setViewingPlot(null)}
        />
      )}
    </div>
  );
}

// ── Table tab ─────────────────────────────────────────────────────────────────

const traitRecordColumns: ColumnDef<TraitRecord>[] = [
  { id: "expand", enableColumnFilter: false },
  {
    id: "pipeline_name",
    accessorKey: "pipeline_name",
    filterFn: (row, id, values: string[]) => values.includes(row.getValue(id)),
  },
  {
    id: "date",
    accessorKey: "date",
    filterFn: (row, id, values: string[]) => values.includes(row.getValue(id)),
  },
  { id: "version", enableColumnFilter: false },
  { id: "ortho_stitch", enableColumnFilter: false },
  { id: "boundary", enableColumnFilter: false },
  { id: "plot_count", enableColumnFilter: false },
];


function TableTab({ records }: { records: TraitRecord[] }) {
  const [wsFilter, setWsFilter] = useState("__all__");
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const workspaces = useMemo(
    () => [...new Set(records.map((r) => r.workspace_name))].sort(),
    [records]
  );

  const wsFilteredRecords = useMemo(() => {
    const filtered =
      wsFilter === "__all__"
        ? records
        : records.filter((r) => r.workspace_name === wsFilter);
    return [...filtered].sort((a, b) => {
      // Primary: pipeline_type (aerial before ground)
      if (a.pipeline_type !== b.pipeline_type) {
        return a.pipeline_type === "aerial" ? -1 : 1;
      }
      // Secondary: date descending (most recent first)
      return b.date.localeCompare(a.date);
    });
  }, [records, wsFilter]);

  const table = useReactTable({
    data: wsFilteredRecords,
    columns: traitRecordColumns,
    state: { columnFilters },
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
  });

  const filtered = table.getFilteredRowModel().rows.map((r) => r.original);

  function toggleExpanded(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  return (
    <div className="space-y-4">
      {/* Workspace dropdown */}
      <div className="flex items-center gap-3">
        <Select
          value={wsFilter}
          onValueChange={(v) => {
            setWsFilter(v);
            setColumnFilters([]);
          }}
        >
          <SelectTrigger className="h-8 text-xs w-52">
            <SelectValue placeholder="All workspaces" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All workspaces</SelectItem>
            {workspaces.map((w) => (
              <SelectItem key={w} value={w} className="text-xs">
                {w}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-muted-foreground text-xs">
          {filtered.length} record{filtered.length !== 1 ? "s" : ""}
        </span>
        {columnFilters.length > 0 && (
          <button
            onClick={() => setColumnFilters([])}
            className="text-primary text-xs hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>
                <ColumnFilter
                  column={table.getColumn("pipeline_name")!}
                  title="Pipeline"
                />
              </TableHead>
              <TableHead>
                <ColumnFilter
                  column={table.getColumn("date")!}
                  title="Date"
                />
              </TableHead>
              <TableHead className="w-12">Version</TableHead>
              <TableHead>Ortho / Stitch</TableHead>
              <TableHead>Boundary</TableHead>
              <TableHead className="text-right">Plots</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-muted-foreground py-8 text-center text-sm"
                >
                  No trait records match the current filter.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r) => (
                <React.Fragment key={r.id}>
                  <TableRow
                    className="hover:bg-muted/40 cursor-pointer"
                    onClick={() => toggleExpanded(r.id)}
                  >
                    <TableCell className="px-3">
                      {expandedId === r.id ? (
                        <ChevronDown className="text-muted-foreground h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="text-muted-foreground h-3.5 w-3.5" />
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${
                          r.pipeline_type === "aerial"
                            ? "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
                            : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                        }`}>
                          {r.pipeline_type === "aerial" ? "Aerial" : "Ground"}
                        </span>
                        <span className="text-sm">{r.pipeline_name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{r.date}</TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">
                      v{r.version}
                    </TableCell>
                    <TableCell>
                      {r.pipeline_type === "ground" ? (
                        <VersionBadge
                          version={r.stitch_version}
                          name={r.stitch_name}
                          label="Stitch"
                        />
                      ) : (
                        <VersionBadge
                          version={r.ortho_version}
                          name={r.ortho_name}
                          label="Ortho"
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      <VersionBadge
                        version={r.boundary_version}
                        name={r.boundary_name}
                        label="Boundary"
                      />
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {r.plot_count}
                    </TableCell>
                  </TableRow>
                  {expandedId === r.id && (
                    <TableRow>
                      <TableCell colSpan={7} className="p-0">
                        <ExpandedPlotTable recordId={r.id} runId={r.run_id} isGroundPipeline={r.pipeline_type === "ground"} />
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ── Query tab ─────────────────────────────────────────────────────────────────

function PlotImageCard({
  recordId,
  plotId,
  properties,
  metricColumns,
  onKeep,
  isKept,
  runId,
  isGroundPipeline = false,
}: {
  recordId: string;
  plotId: string;
  properties: Record<string, unknown>;
  metricColumns: string[];
  onKeep?: () => void;
  isKept?: boolean;
  runId?: string;
  isGroundPipeline?: boolean;
}) {
  const [downloading, setDownloading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [showDetections, setShowDetections] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [activeClass, setActiveClass] = useState<string | null>(null);

  console.debug(`[PlotImageCard] render — recordId=${recordId} plotId=${plotId} isGround=${isGroundPipeline} runId=${runId}`)

  // Fetch inference results to power detection overlay on the card
  const { data: inferenceData } = useQuery({
    queryKey: ["inference-plot-dialog", runId],
    queryFn: async () => {
      const token = localStorage.getItem("access_token") || "";
      const res = await fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/inference-results`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!runId,
    staleTime: 60_000,
  });

  const predictions = useMemo<SharedPrediction[]>(() => {
    if (!inferenceData?.available) return [];
    const imgList: Array<{ name: string; plot?: string }> = inferenceData.images ?? [];
    const preds: SharedPrediction[] = inferenceData.predictions ?? [];
    const imgToPlot = new Map(imgList.map((im) => [im.name, String(im.plot ?? "")]));
    return preds.filter((p) => imgToPlot.get(p.image) === plotId);
  }, [inferenceData, plotId]);

  const uniqueClasses = useMemo(() => [...new Set(predictions.map((p) => p.class))].sort(), [predictions]);
  const hasDetections = predictions.length > 0;

  async function handleDownload() {
    setDownloading(true);
    await fetchAndDownloadPlotImage(recordId, plotId);
    setDownloading(false);
  }

  const accession = lookupProperty(properties, "accession");
  const statRows = metricColumns.filter((col) => typeof properties[col] === "number");

  return (
    <>
      <div className="border rounded-lg overflow-hidden bg-background shadow-sm flex flex-col">
        {/* Header */}
        <div className="px-3 py-2 border-b bg-muted/30 flex items-center gap-2 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold truncate">Plot {plotId}</p>
            {accession != null && (
              <p className="text-xs text-muted-foreground truncate">
                Accession: {String(accession)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {hasDetections && (
              <>
                <button
                  type="button"
                  title={showDetections ? "Hide detections" : "Show detections"}
                  className={`transition-colors ${showDetections ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => setShowDetections((v) => !v)}
                >
                  <Scan className="w-3.5 h-3.5" />
                </button>
                {showDetections && (
                  <button
                    type="button"
                    title={showLabels ? "Hide labels" : "Show labels"}
                    className={`transition-colors ${showLabels ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                    onClick={() => setShowLabels((v) => !v)}
                  >
                    <Tag className={`w-3.5 h-3.5 ${showLabels ? "" : "opacity-40"}`} />
                  </button>
                )}
                {showDetections && uniqueClasses.length > 1 && (
                  <div className="flex items-center gap-0.5 border rounded text-[10px]">
                    <button onClick={() => setActiveClass((c) => { const i = uniqueClasses.indexOf(c ?? ""); return i <= 0 ? null : uniqueClasses[i - 1] })} className="px-0.5 py-0.5 hover:bg-muted"><ChevronLeft className="w-3 h-3" /></button>
                    <span className="px-0.5 min-w-[40px] text-center truncate">{activeClass ?? "All"}</span>
                    <button onClick={() => setActiveClass((c) => { const i = uniqueClasses.indexOf(c ?? ""); return i >= uniqueClasses.length - 1 ? null : uniqueClasses[i + 1] })} className="px-0.5 py-0.5 hover:bg-muted"><ChevronRight className="w-3 h-3" /></button>
                  </div>
                )}
              </>
            )}
            {onKeep && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                title={isKept ? "Remove from comparison" : "Keep for comparison"}
                onClick={onKeep}
                style={isKept ? { color: "hsl(var(--primary))" } : {}}
              >
                {isKept ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
              </Button>
            )}
            <ExpandButton onClick={() => setDialogOpen(true)} title="View fullscreen" />
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              title={downloading ? "Downloading…" : "Download image"}
              disabled={downloading}
              onClick={handleDownload}
            >
              {downloading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
            </Button>
          </div>
        </div>

        {/* Image via shared PlotImage */}
        <div className="flex-1" style={{ height: 192 }}>
          <PlotImage
            recordId={recordId}
            plotId={plotId}
            rotate={isGroundPipeline}
            predictions={predictions}
            showDetections={showDetections}
            showLabels={showLabels}
            activeClass={activeClass}
          />
        </div>

        {/* Stats */}
        {statRows.length > 0 && (
          <div className="px-3 py-2 space-y-0.5 border-t">
            {statRows.map((col) => (
              <div key={col} className="flex justify-between gap-2 text-xs">
                <span className="text-muted-foreground truncate">{col.replace(/_/g, " ")}</span>
                <span className="font-mono flex-shrink-0">{(properties[col] as number).toFixed(3)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {dialogOpen && (
        <PlotViewDialog
          recordId={recordId}
          plotId={plotId}
          properties={properties}
          metricColumns={metricColumns}
          runId={runId}
          isGroundPipeline={isGroundPipeline}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </>
  );
}

// ── Comparison section ─────────────────────────────────────────────────────────

function ComparisonSection({
  plots,
  onRemove,
}: {
  plots: KeptPlot[];
  onRemove: (key: string) => void;
}) {
  const exp = useExpandable();
  if (plots.length === 0) return null;

  // Collect all metric columns present across all kept plots
  const allMetrics = Array.from(
    new Set(plots.flatMap((p) => p.metricColumns.filter((c) => typeof p.properties[c] === "number")))
  );

  function ComparisonContent() {
    return (
      <>
        {/* Plot image cards grid — 3 columns */}
        <div className="grid grid-cols-3 gap-4">
          {plots.map((p) => {
            const key = `${p.recordId}:${p.plotId}`;
            return (
              <div
                key={key}
                className="border rounded-lg overflow-hidden bg-background shadow-sm"
              >
                <div className="px-2 py-1.5 border-b bg-muted/30 flex items-start justify-between gap-1">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate">Plot {p.plotId}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{p.recordLabel}</p>
                  </div>
                  <button
                    onClick={() => onRemove(key)}
                    className="text-muted-foreground hover:text-foreground flex-shrink-0 mt-0.5"
                    title="Remove from comparison"
                  >
                    <XIcon className="h-3 w-3" />
                  </button>
                </div>
                <PlotImageCard
                  recordId={p.recordId}
                  plotId={p.plotId}
                  properties={p.properties}
                  metricColumns={p.metricColumns}
                />
              </div>
            );
          })}
        </div>

        {/* Metrics comparison table */}
        {allMetrics.length > 0 && (
          <div className="overflow-x-auto">
            <table className="text-xs w-full border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-1.5 pr-4 text-muted-foreground font-medium w-40">Metric</th>
                  {plots.map((p) => (
                    <th key={`${p.recordId}:${p.plotId}`} className="text-right py-1.5 px-3 font-semibold min-w-[80px]">
                      Plot {p.plotId}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allMetrics.map((metric) => {
                  const vals = plots.map((p) =>
                    typeof p.properties[metric] === "number" ? (p.properties[metric] as number) : null
                  );
                  const defined = vals.filter((v): v is number => v !== null);
                  const max = defined.length ? Math.max(...defined) : null;
                  return (
                    <tr key={metric} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-1.5 pr-4 text-muted-foreground truncate max-w-[160px]">{metric.replace(/_/g, " ")}</td>
                      {vals.map((v, i) => (
                        <td key={i} className="text-right py-1.5 px-3 font-mono"
                          style={v !== null && v === max && defined.length > 1 ? { color: "hsl(var(--primary))", fontWeight: 700 } : {}}
                        >
                          {v !== null ? v.toFixed(3) : <span className="text-muted-foreground/50">—</span>}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  }

  return (
    <>
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center gap-2">
        <Pin className="h-4 w-4 text-primary" />
        <p className="text-sm font-semibold">Comparison ({plots.length})</p>
        <p className="text-xs text-muted-foreground flex-1">— select plots using the pin button above</p>
        <ExpandButton onClick={exp.open} title="Expand comparison" />
      </div>

      <ComparisonContent />
    </div>
    <FullscreenModal open={exp.isExpanded} onClose={exp.close} title={`Comparison (${plots.length})`}>
      <div className="p-4 space-y-4 overflow-auto">
        <ComparisonContent />
      </div>
    </FullscreenModal>
    </>
  );
}

function QueryTab({ records }: { records: TraitRecord[] }) {
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | null>(
    () => records[0]?.workspace_name ?? null
  );
  const [selectedPipeline, setSelectedPipeline] = useState<string | null>(
    () => records[0]?.pipeline_name ?? null
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(
    () => records[0]?.date ?? null
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    () => records[0]?.id ?? null
  );
  const [filters, setFilters] = useState<Record<PlotFilterKey, string>>(
    { col: "", row: "", plot: "", accession: "", location: "", crop: "", rep: "" }
  );
  const [results, setResults] = useState<GeoJSON.Feature[] | null>(null);
  const [hasQueried, setHasQueried] = useState(false);
  const [keptPlots, setKeptPlots] = useState<KeptPlot[]>(() => {
    try {
      const saved = localStorage.getItem("query-comparison-plots");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  useEffect(() => {
    localStorage.setItem("query-comparison-plots", JSON.stringify(keptPlots));
  }, [keptPlots]);

  const { data: geojsonData, isLoading: geojsonLoading } = useQuery({
    queryKey: ["trait-record-geojson", selectedId],
    queryFn: () => analyzeApi.getTraitRecordGeojson(selectedId!),
    enabled: !!selectedId,
    staleTime: 60_000,
  });

  // Fetch image plot IDs for the selected record (for chip highlighting)
  const { data: imagePlotIdsData } = useQuery({
    queryKey: ["trait-record-image-plot-ids", selectedId],
    queryFn: () => analyzeApi.getTraitRecordImagePlotIds(selectedId!),
    enabled: !!selectedId,
    staleTime: 60_000,
  });
  const imagePlotIdSet = useMemo(
    () => new Set(imagePlotIdsData?.plot_ids ?? []),
    [imagePlotIdsData]
  );

  // Fetch image availability for ALL records (for dropdown badges)
  const allImageQueries = useQueries({
    queries: records.map((r) => ({
      queryKey: ["trait-record-image-plot-ids", r.id],
      queryFn: () => analyzeApi.getTraitRecordImagePlotIds(r.id),
      staleTime: 60_000,
    })),
  });
  const recordHasImages = useMemo(() => {
    const map = new Map<string, boolean>();
    records.forEach((r, i) => {
      map.set(r.id, (allImageQueries[i]?.data?.plot_ids?.length ?? 0) > 0);
    });
    return map;
  }, [records, allImageQueries]);

  // If the default-selected record has no images but another does, auto-switch to it
  useEffect(() => {
    if (recordHasImages.size === 0) return;
    if (selectedId && recordHasImages.get(selectedId)) return; // already has images
    const withImages = records.find((r) => recordHasImages.get(r.id));
    if (!withImages) return;
    setSelectedId(withImages.id);
    setSelectedWorkspace(withImages.workspace_name);
    setSelectedPipeline(withImages.pipeline_name);
    setSelectedDate(withImages.date);
  }, [recordHasImages]); // eslint-disable-line react-hooks/exhaustive-deps

  // Build unique values per field for autocomplete
  const uniqueFieldValues = useMemo<Record<PlotFilterKey, string[]>>(() => {
    const empty: Record<PlotFilterKey, string[]> = {
      col: [], row: [], plot: [], accession: [], location: [], crop: [], rep: [],
    };
    if (!geojsonData?.geojson?.features) return empty;
    const sets: Record<PlotFilterKey, Set<string>> = {
      col: new Set(), row: new Set(), plot: new Set(), accession: new Set(),
      location: new Set(), crop: new Set(), rep: new Set(),
    };
    for (const f of geojsonData.geojson.features) {
      const p = f.properties ?? {};
      for (const key of PLOT_FILTER_FIELDS) {
        // lookupProperty covers COL/ROW aliases; fall back to plot_id for "plot"
        const val = lookupProperty(p, key) ?? (key === "plot" ? (p.plot_id ?? p.plot) : undefined);
        if (val != null && String(val).trim()) sets[key].add(String(val));
      }
    }
    const result = { ...empty };
    for (const key of PLOT_FILTER_FIELDS) {
      result[key] = [...sets[key]].sort();
    }
    return result;
  }, [geojsonData]);

  function runQuery() {
    if (!geojsonData?.geojson?.features) return;
    const matched = geojsonData.geojson.features.filter((f) => {
      const p = f.properties ?? {};
      return PLOT_FILTER_FIELDS.every((key) =>
        matchesTextFilter(p, key, filters[key])
      );
    });
    setResults(matched);
    setHasQueried(true);
  }

  const metricCols = geojsonData?.metric_columns ?? [];

  const workspaces = useMemo(
    () => Array.from(new Set(records.map((r) => r.workspace_name))),
    [records]
  );
  const pipelines = useMemo(() => {
    const seen = new Map<string, string>();
    records
      .filter((r) => r.workspace_name === selectedWorkspace)
      .forEach((r) => { if (!seen.has(r.pipeline_name)) seen.set(r.pipeline_name, r.pipeline_type); });
    return Array.from(seen.entries()).map(([name, type]) => ({ name, type }));
  }, [records, selectedWorkspace]);
  const dates = useMemo(
    () => Array.from(new Set(
      records
        .filter((r) => r.workspace_name === selectedWorkspace && r.pipeline_name === selectedPipeline)
        .map((r) => r.date)
    )).sort().reverse(),
    [records, selectedWorkspace, selectedPipeline]
  );
  const versions = useMemo(
    () => records.filter(
      (r) =>
        r.workspace_name === selectedWorkspace &&
        r.pipeline_name === selectedPipeline &&
        r.date === selectedDate
    ),
    [records, selectedWorkspace, selectedPipeline, selectedDate]
  );

  function handleWorkspaceChange(ws: string) {
    setSelectedWorkspace(ws);
    const first = records.find((r) => r.workspace_name === ws);
    setSelectedPipeline(first?.pipeline_name ?? null);
    setSelectedDate(first?.date ?? null);
    setSelectedId(first?.id ?? null);
    setResults(null);
    setHasQueried(false);
  }

  function handlePipelineChange(pipeline: string) {
    setSelectedPipeline(pipeline);
    const first = records.find(
      (r) => r.workspace_name === selectedWorkspace && r.pipeline_name === pipeline
    );
    setSelectedDate(first?.date ?? null);
    setSelectedId(first?.id ?? null);
    setResults(null);
    setHasQueried(false);
  }

  function handleDateChange(date: string) {
    setSelectedDate(date);
    const first = records.find(
      (r) =>
        r.workspace_name === selectedWorkspace &&
        r.pipeline_name === selectedPipeline &&
        r.date === date
    );
    setSelectedId(first?.id ?? null);
    setResults(null);
    setHasQueried(false);
  }

  function handleVersionChange(id: string) {
    setSelectedId(id);
    setResults(null);
    setHasQueried(false);
  }

  const selectedRecord = records.find((r) => r.id === selectedId);

  function toggleKeep(plotId: string, properties: Record<string, unknown>) {
    const key = `${selectedId}:${plotId}`;
    setKeptPlots((prev) => {
      if (prev.some((p) => `${p.recordId}:${p.plotId}` === key)) {
        return prev.filter((p) => `${p.recordId}:${p.plotId}` !== key);
      }
      return [
        ...prev,
        {
          recordId: selectedId!,
          plotId,
          properties,
          metricColumns: metricCols,
          recordLabel: selectedRecord
            ? `${selectedRecord.pipeline_name} — ${selectedRecord.date}`
            : selectedId!,
        },
      ];
    });
  }

  return (
    <div className="space-y-4">
      {/* Comparison section — always visible, persists across data source changes */}
      <ComparisonSection
        plots={keptPlots}
        onRemove={(key) =>
          setKeptPlots((prev) =>
            prev.filter((p) => `${p.recordId}:${p.plotId}` !== key)
          )
        }
      />

      {/* Step 1: Data source */}
      <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          1 — Select data source
        </p>
        <div className="flex flex-wrap gap-3 items-end">
          {/* Workspace */}
          <div>
            <p className="text-xs text-muted-foreground mb-1">Workspace</p>
            <Select value={selectedWorkspace ?? ""} onValueChange={handleWorkspaceChange}>
              <SelectTrigger className="h-8 text-xs w-44">
                <SelectValue placeholder="Workspace" />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((ws) => (
                  <SelectItem key={ws} value={ws} className="text-xs">{ws}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Pipeline */}
          {selectedWorkspace && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Pipeline</p>
              <Select value={selectedPipeline ?? ""} onValueChange={handlePipelineChange}>
                <SelectTrigger className="h-8 text-xs w-52">
                  <SelectValue placeholder="Pipeline" />
                </SelectTrigger>
                <SelectContent>
                  {pipelines.map(({ name, type }) => (
                    <SelectItem key={name} value={name} className="text-xs">
                      <span className="flex items-center gap-1.5">
                        {name}
                        <span className={`inline-block px-1 py-0 rounded text-[10px] font-medium leading-4 ${
                          type === "aerial"
                            ? "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
                            : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                        }`}>
                          {type === "aerial" ? "Aerial" : "Ground"}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Date */}
          {selectedPipeline && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Date</p>
              <Select value={selectedDate ?? ""} onValueChange={handleDateChange}>
                <SelectTrigger className="h-8 text-xs w-36">
                  <SelectValue placeholder="Date" />
                </SelectTrigger>
                <SelectContent>
                  {dates.map((d) => (
                    <SelectItem key={d} value={d} className="text-xs">{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Version */}
          {selectedDate && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Version</p>
              <Select value={selectedId ?? ""} onValueChange={handleVersionChange}>
                <SelectTrigger className="h-8 text-xs w-28">
                  <SelectValue placeholder="Version" />
                </SelectTrigger>
                <SelectContent>
                  {versions.map((r) => (
                    <SelectItem key={r.id} value={r.id} className="text-xs">
                      <span className="flex items-center gap-1.5">
                        <span
                          className="inline-block h-2 w-2 rounded-full flex-shrink-0"
                          style={{
                            backgroundColor: recordHasImages.get(r.id)
                              ? "hsl(var(--primary))"
                              : "hsl(var(--muted-foreground))",
                            opacity: recordHasImages.get(r.id) ? 1 : 0.4,
                          }}
                        />
                        v{r.version}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </div>

      {/* Step 2: Filters — only shown once a record is chosen */}
      {selectedId && (
        <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            2 — Filter plots
          </p>
          <div className="flex flex-wrap items-end gap-3">
            {PLOT_FILTER_FIELDS.map((field) => {
              const listId = `query-autocomplete-${field}`;
              return (
                <div key={field}>
                  <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wide">
                    {field}
                  </p>
                  <Input
                    className="h-8 text-xs w-28"
                    placeholder="…"
                    value={filters[field]}
                    list={listId}
                    onChange={(e) =>
                      setFilters((prev) => ({ ...prev, [field]: e.target.value }))
                    }
                    onKeyDown={(e) => e.key === "Enter" && runQuery()}
                  />
                  <datalist id={listId}>
                    {uniqueFieldValues[field].map((v) => (
                      <option key={v} value={v} />
                    ))}
                  </datalist>
                </div>
              );
            })}

            <Button
              size="sm"
              className="h-8"
              onClick={runQuery}
              disabled={!selectedId || geojsonLoading}
            >
              {geojsonLoading ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Search className="h-3.5 w-3.5 mr-1.5" />
              )}
              Query
            </Button>
          </div>
        </div>
      )}

      {/* Results */}
      {hasQueried && results !== null && (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {results.length} plot{results.length !== 1 ? "s" : ""} matched
            {results.length > 24 && " — showing first 24"}
          </p>

          {/* Candidate chips for unfilled fields */}
          {(() => {
            const emptyFields = PLOT_FILTER_FIELDS.filter((f) => !filters[f].trim());
            if (emptyFields.length === 0) return null;

            // Derive available values from matched results (or full dataset if 0 results)
            const source = results.length > 0 ? results : geojsonData?.geojson?.features ?? [];
            const valuesFromSource: Record<PlotFilterKey, string[]> = {} as Record<PlotFilterKey, string[]>;
            for (const f of emptyFields) {
              const set = new Set<string>();
              for (const feat of source) {
                const p = feat.properties ?? {};
                const titleKey = f.charAt(0).toUpperCase() + f.slice(1);
                const candidates = [p[f], p[f.toUpperCase()], p[titleKey], f === "plot" ? (p.plot_id ?? p.plot) : null];
                for (const c of candidates) {
                  if (c != null && String(c).trim()) set.add(String(c));
                }
              }
              valuesFromSource[f] = [...set].sort();
            }

            const fieldsWithValues = emptyFields.filter((f) => valuesFromSource[f].length > 0);
            if (fieldsWithValues.length === 0) return null;

            // Check if a field value has any plots with images in the image set
            function valueHasImages(field: PlotFilterKey, val: string): boolean {
              if (imagePlotIdSet.size === 0) return false;
              return source.some((feat) => {
                const p = feat.properties ?? {};
                const titleKey = field.charAt(0).toUpperCase() + field.slice(1);
                const candidates = [p[field], p[field.toUpperCase()], p[titleKey], field === "plot" ? (p.plot_id ?? p.plot) : null];
                if (!candidates.some((c) => c != null && String(c) === val)) return false;
                // This feature matches the value — does it have an image?
                const plotId = String(p.plot_id ?? p.plot ?? p.accession ?? "");
                return imagePlotIdSet.has(plotId);
              });
            }

            return (
              <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2">
                <p className="text-xs text-muted-foreground font-medium">
                  {results.length === 0 ? "No matches — try one of these:" : "Refine by:"}
                </p>
                <div className="flex flex-wrap gap-4">
                  {fieldsWithValues.map((f) => (
                    <div key={f} className="text-xs">
                      <p className="font-semibold uppercase tracking-wide text-muted-foreground mb-1">{f}</p>
                      <div className="flex flex-wrap gap-1 max-w-xs">
                        {valuesFromSource[f].slice(0, 20).map((v) => {
                          const hasImg = valueHasImages(f, v);
                          return (
                            <button
                              key={v}
                              title={hasImg ? "Has plot images & data" : "Field design only — no extraction data"}
                              className="px-2 py-0.5 rounded cursor-pointer border text-foreground transition-colors"
                              style={hasImg ? {
                                backgroundColor: "hsl(var(--primary) / 0.15)",
                                borderColor: "hsl(var(--primary) / 0.6)",
                                color: "hsl(var(--primary))",
                                fontWeight: 600,
                              } : {
                                backgroundColor: "hsl(var(--background))",
                                borderColor: "hsl(var(--border))",
                              }}
                              onClick={() => setFilters((prev) => ({ ...prev, [f]: v }))}
                            >
                              {v}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {results.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {results.slice(0, 24).map((f, i) => {
                const plotId = getPlotId(f.properties ?? {}, i);
                const keepKey = `${selectedId}:${plotId}`;
                if (i === 0) console.debug("[QueryTab] first card — recordId:", selectedId, "plotId:", plotId, "props:", f.properties);
                return (
                  <PlotImageCard
                    key={`${plotId}-${i}`}
                    recordId={selectedId!}
                    plotId={plotId}
                    properties={f.properties ?? {}}
                    metricColumns={metricCols}
                    runId={records.find((r) => r.id === selectedId)?.run_id}
                    isGroundPipeline={records.find((r) => r.id === selectedId)?.pipeline_type === "ground"}
                    onKeep={() => toggleKeep(plotId, f.properties ?? {})}
                    isKept={keptPlots.some((p) => `${p.recordId}:${p.plotId}` === keepKey)}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}

    </div>
  );
}

// ── Collapsible workspace group ────────────────────────────────────────────────

function CollapsibleWorkspace({
  name,
  children,
}: {
  name: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1 px-3 pt-2 pb-0.5 text-xs font-semibold tracking-wide uppercase transition-colors"
      >
        <ChevronRight
          className={`h-3 w-3 flex-shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span className="truncate">{name}</span>
      </button>
      {open && children}
    </div>
  );
}

// ── Map tab ───────────────────────────────────────────────────────────────────

function MapTab({ records }: { records: TraitRecord[] }) {
  const [wsFilter, setWsFilter] = useState("__all__");
  const [pipelineFilter, setPipelineFilter] = useState("__all__");
  const [selectedId, setSelectedId] = useState<string | null>(
    () => records[0]?.id ?? null
  );
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  const [showPolygons, setShowPolygons] = useState(true);
  const [plotOpacity, setPlotOpacity] = useState(70);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const workspaces = useMemo(
    () => [...new Set(records.map((r) => r.workspace_name))].sort(),
    [records]
  );

  const pipelines = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>();
    records
      .filter((r) => wsFilter === "__all__" || r.workspace_name === wsFilter)
      .forEach((r) => {
        if (!seen.has(r.pipeline_id))
          seen.set(r.pipeline_id, {
            id: r.pipeline_id,
            name: r.pipeline_name,
          });
      });
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [records, wsFilter]);

  const filteredRecords = useMemo(
    () =>
      records.filter((r) => {
        if (wsFilter !== "__all__" && r.workspace_name !== wsFilter)
          return false;
        if (pipelineFilter !== "__all__" && r.pipeline_id !== pipelineFilter)
          return false;
        return true;
      }),
    [records, wsFilter, pipelineFilter]
  );

  const grouped = useMemo(() => {
    const map = new Map<string, Map<string, TraitRecord[]>>();
    for (const r of filteredRecords) {
      if (!map.has(r.workspace_name)) map.set(r.workspace_name, new Map());
      const pMap = map.get(r.workspace_name)!;
      if (!pMap.has(r.pipeline_id)) pMap.set(r.pipeline_id, []);
      pMap.get(r.pipeline_id)!.push(r);
    }
    return map;
  }, [filteredRecords]);

  const { data: traitsData, isLoading: traitsLoading } = useQuery({
    queryKey: ["trait-record-geojson", selectedId],
    queryFn: () => analyzeApi.getTraitRecordGeojson(selectedId!),
    enabled: !!selectedId,
    staleTime: 60_000,
  });

  const effectiveMetric =
    selectedMetric ?? traitsData?.metric_columns?.[0] ?? null;

  const { data: orthoInfo } = useQuery({
    queryKey: ["trait-record-ortho", selectedId],
    queryFn: () => analyzeApi.getTraitRecordOrthoInfo(selectedId!),
    enabled: !!selectedId,
    staleTime: 60_000,
  });

  const selectedRecord = useMemo(
    () => records.find((r) => r.id === selectedId) ?? null,
    [records, selectedId]
  );

  return (
    <div className="flex h-full min-h-0">
      {/* Left panel */}
      <div
        className={`flex flex-shrink-0 flex-col overflow-hidden border-r transition-all duration-200 ${sidebarOpen ? "w-56" : "w-0 border-r-0"}`}
      >
        <div className="space-y-2 border-b p-3">
          <Select
            value={wsFilter}
            onValueChange={(v) => {
              setWsFilter(v);
              setPipelineFilter("__all__");
            }}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="All workspaces" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All workspaces</SelectItem>
              {workspaces.map((w) => (
                <SelectItem key={w} value={w} className="text-xs">
                  {w}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={pipelineFilter} onValueChange={setPipelineFilter}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="All pipelines" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All pipelines</SelectItem>
              {pipelines.map((p) => (
                <SelectItem key={p.id} value={p.id} className="text-xs">
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {[...grouped.entries()].map(([ws, pipelineMap]) => (
            <CollapsibleWorkspace key={ws} name={ws}>
              {[...pipelineMap.entries()].map(([pipelineId, recs]) => (
                <div key={pipelineId}>
                  <div className="flex items-center gap-1.5 px-3 py-0.5">
                    <p className="text-muted-foreground flex-1 truncate text-xs">
                      {recs[0].pipeline_name}
                    </p>
                    <span className={`flex-shrink-0 inline-block px-1 py-0 rounded text-[10px] font-medium leading-tight ${
                      recs[0].pipeline_type === "aerial"
                        ? "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
                        : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                    }`}>
                      {recs[0].pipeline_type === "aerial" ? "Aerial" : "Ground"}
                    </span>
                  </div>
                  {recs.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => {
                        setSelectedId(r.id);
                        setSelectedMetric(null);
                      }}
                      className={`hover:bg-muted/60 w-full px-4 py-1.5 text-left text-xs transition-colors ${
                        selectedId === r.id ? "bg-muted font-medium" : ""
                      }`}
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="truncate">{r.date}</span>
                        <span className="text-muted-foreground flex-shrink-0 font-mono text-[10px]">
                          v{r.version}
                        </span>
                      </div>
                      <div className="text-muted-foreground mt-0.5 space-y-0.5 text-[11px]">
                        <div className="truncate">
                          <span className="text-foreground/50">
                            {r.pipeline_type === "ground" ? "Stitch:" : "Ortho:"}
                          </span>{" "}
                          {r.pipeline_type === "ground"
                            ? versionLabel(r.stitch_version, r.stitch_name)
                            : versionLabel(r.ortho_version, r.ortho_name)}
                        </div>
                        <div className="truncate">
                          <span className="text-foreground/50">Boundary:</span>{" "}
                          {r.boundary_version != null
                            ? versionLabel(
                                r.boundary_version,
                                r.boundary_name
                              )
                            : "canonical"}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ))}
            </CollapsibleWorkspace>
          ))}
          {filteredRecords.length === 0 && (
            <p className="text-muted-foreground px-3 py-4 text-center text-xs">
              No records to show.
            </p>
          )}
        </div>

        {/* Metric selector + toggle */}
        {traitsData && traitsData.metric_columns.length > 0 && (
          <div className="space-y-1.5 border-t p-3">
            <div className="flex items-center justify-between">
              <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Color by
              </p>
              <div className="flex items-center gap-1.5">
                {showPolygons && (
                  <input
                    type="range"
                    min={10}
                    max={100}
                    step={5}
                    value={plotOpacity}
                    onChange={(e) => setPlotOpacity(Number(e.target.value))}
                    title={`Plot opacity: ${plotOpacity}%`}
                    className="w-20 h-1.5 accent-foreground cursor-pointer"
                  />
                )}
                <button
                  onClick={() => setShowPolygons((v) => !v)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title={showPolygons ? "Hide polygons" : "Show polygons"}
                >
                  {showPolygons ? (
                    <Eye className="h-3.5 w-3.5" />
                  ) : (
                    <EyeOff className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
            <MetricSelector
              columns={traitsData.metric_columns}
              value={effectiveMetric}
              onChange={setSelectedMetric}
            />
          </div>
        )}
      </div>

      {/* Map */}
      <div className="relative min-w-0 flex-1">
        <button
          onClick={() => setSidebarOpen((v) => !v)}
          className="bg-background/80 text-muted-foreground hover:text-foreground absolute top-2 left-2 z-10 rounded border p-1 shadow-sm backdrop-blur-sm transition-colors"
          title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
        >
          {sidebarOpen ? (
            <PanelLeftClose className="h-4 w-4" />
          ) : (
            <PanelLeftOpen className="h-4 w-4" />
          )}
        </button>
        {!selectedId ? (
          <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2">
            <MapIcon className="h-10 w-10" />
            <p className="text-sm">
              Select a record from the list to view on the map.
            </p>
          </div>
        ) : traitsLoading ? (
          <div className="text-muted-foreground flex h-full items-center justify-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading traits…
          </div>
        ) : (
          <>
            <TraitMap
              geojson={traitsData?.geojson ?? null}
              orthoInfo={orthoInfo ?? null}
              selectedMetric={effectiveMetric}
              filteredIds={null}
              recordId={selectedId}
              runId={selectedRecord?.run_id ?? null}
              showPolygons={showPolygons}
              plotOpacity={plotOpacity}
            />
            {selectedRecord && (
              <div className="absolute top-2 right-2 z-10 bg-background/80 backdrop-blur-sm border rounded px-2 py-1 text-xs shadow-sm space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium">{selectedRecord.date}</span>
                  <span className="text-muted-foreground font-mono">
                    v{selectedRecord.version}
                  </span>
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1 py-0 capitalize leading-tight"
                  >
                    {selectedRecord.pipeline_type}
                  </Badge>
                </div>
                <div className="text-muted-foreground">
                  {selectedRecord.pipeline_name}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Nav groups ────────────────────────────────────────────────────────────────

const ANALYZE_NAV_GROUPS = [
  {
    label: "Table",
    items: [
      { id: "pipeline-runs", label: "Pipeline Runs", icon: Table2      },
      { id: "master-table",  label: "Master Table",  icon: LayoutGrid  },
    ],
  },
  {
    items: [
      { id: "query", label: "Query", icon: Search  },
      { id: "map",   label: "Map",   icon: MapIcon },
    ],
  },
] as const

type AnalyzeSection = "pipeline-runs" | "master-table" | "query" | "map"

// ── Page ──────────────────────────────────────────────────────────────────────

export function AnalyzeDashboard() {
  const [activeSection, setActiveSection] = useState<AnalyzeSection>("pipeline-runs");
  const [mapMounted, setMapMounted] = useState(false);

  useEffect(() => {
    if (activeSection === "map") setMapMounted(true);
  }, [activeSection]);

  const { data: records = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ["trait-records"],
    queryFn: analyzeApi.listTraitRecords,
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="text-muted-foreground flex min-h-[40vh] items-center justify-center gap-2">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading…
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="text-muted-foreground flex min-h-[40vh] flex-col items-center justify-center gap-3">
        <BarChart2 className="h-10 w-10" />
        <p className="text-sm">
          No trait records yet. Complete a Trait Extraction step to see results
          here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 64px)" }}>
      {/* Header */}
      <div className="flex-shrink-0 px-6 pt-5 pb-3 border-b flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Analyze</h1>
          <p className="text-muted-foreground text-sm">View your processed data</p>
        </div>
        <button
          type="button"
          title="Refresh"
          onClick={() => refetch()}
          className="mt-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        <NavSidebar
          groups={ANALYZE_NAV_GROUPS}
          activeId={activeSection}
          onSelect={(id) => setActiveSection(id as AnalyzeSection)}
        />

        {/* Pipeline Runs */}
        {activeSection === "pipeline-runs" && (
          <div className="flex-1 overflow-auto px-6 py-6">
            <TableTab records={records} />
          </div>
        )}

        {/* Master Table */}
        {activeSection === "master-table" && (
          <div className="flex-1 overflow-auto px-6 py-6">
            <MasterTableTab records={records} />
          </div>
        )}

        {/* Query */}
        {activeSection === "query" && (
          <div className="flex-1 overflow-auto px-6 py-6">
            <QueryTab records={records} />
          </div>
        )}

        {/* Map — lazy-mount on first visit, then keep alive via display:none */}
        {mapMounted && (
          <div
            className="flex-1 min-h-0"
            style={{ display: activeSection === "map" ? undefined : "none" }}
          >
            <div className="h-full overflow-hidden">
              <MapTab records={records} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
