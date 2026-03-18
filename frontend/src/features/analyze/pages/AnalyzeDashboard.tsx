/**
 * AnalyzeDashboard — top-level Analyze page.
 *
 * Two tabs:
 *  - Table: filterable flat table of all TraitRecords with expandable
 *           per-plot data rows.
 *  - Map:   satellite → ortho image overlay → trait polygons. Left panel
 *           lists records grouped by workspace/pipeline; click to load.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  Loader2,
  Map as MapIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Table2,
} from "lucide-react";
import { analyzeApi, versionLabel, type TraitRecord } from "../api";
import { TraitMap } from "../components/TraitMap";
import { MetricSelector } from "../components/MetricSelector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ── Helpers ────────────────────────────────────────────────────────────────────

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

// ── Expandable per-plot table ──────────────────────────────────────────────────

function ExpandedPlotTable({ recordId }: { recordId: string }) {
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

  // Determine columns: metadata first, then numeric traits
  const allKeys = [
    ...new Set(features.flatMap((f) => Object.keys(f.properties ?? {}))),
  ];
  const metaCols = allKeys.filter(
    (k) =>
      !["", "geometry"].includes(k) &&
      typeof features[0]?.properties?.[k] !== "number"
  );
  const numCols = data?.metric_columns ?? [];
  const cols = [...metaCols, ...numCols].filter((c) => c !== "");

  function handleDownload() {
    downloadCsv(featuresToCsv(features), `traits_${recordId}.csv`);
  }

  return (
    <div className="bg-muted/20 border-t">
      <div className="flex items-center justify-between px-6 py-2">
        <p className="text-muted-foreground text-xs">
          {features.length} plots · {numCols.join(", ")}
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={handleDownload}
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {features.map((f, i) => (
              <TableRow key={i} className="text-xs">
                {cols.map((c) => {
                  const v = f.properties?.[c];
                  return (
                    <TableCell key={c} className="px-3 py-1 font-mono">
                      {typeof v === "number" ? v.toFixed(3) : String(v ?? "—")}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ── Table tab ─────────────────────────────────────────────────────────────────

const traitRecordColumns: ColumnDef<TraitRecord>[] = [
  { id: "expand", enableColumnFilter: false },
  {
    id: "workspace_name",
    accessorKey: "workspace_name",
    filterFn: (row, id, values: string[]) => values.includes(row.getValue(id)),
  },
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
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const table = useReactTable({
    data: records,
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
      <div className="text-muted-foreground flex items-center gap-1 text-xs">
        <span>
          {filtered.length} record{filtered.length !== 1 ? "s" : ""}
        </span>
        {columnFilters.length > 0 && (
          <button
            onClick={() => setColumnFilters([])}
            className="text-primary ml-2 hover:underline"
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
                  column={table.getColumn("workspace_name")!}
                  title="Workspace"
                />
              </TableHead>
              <TableHead>
                <ColumnFilter
                  column={table.getColumn("pipeline_name")!}
                  title="Pipeline"
                />
              </TableHead>
              <TableHead>
                <ColumnFilter column={table.getColumn("date")!} title="Date" />
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
                  colSpan={8}
                  className="text-muted-foreground py-8 text-center text-sm"
                >
                  No trait records match the current filter.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r) => (
                <>
                  <TableRow
                    key={r.id}
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
                    <TableCell className="text-sm font-medium">
                      {r.workspace_name}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className="text-xs capitalize">
                          {r.pipeline_type}
                        </Badge>
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
                    <TableRow key={`${r.id}-expanded`}>
                      <TableCell colSpan={7} className="p-0">
                        <ExpandedPlotTable recordId={r.id} />
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))
            )}
          </TableBody>
        </Table>
      </div>
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
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const workspaces = useMemo(
    () => [...new Set(records.map((r) => r.workspace_name))].sort(),
    [records]
  );

  const pipelines = useMemo(
    () =>
      [
        ...new Set(
          records
            .filter(
              (r) => wsFilter === "__all__" || r.workspace_name === wsFilter
            )
            .map((r) => r.pipeline_name)
        ),
      ].sort(),
    [records, wsFilter]
  );

  const filteredRecords = useMemo(
    () =>
      records.filter((r) => {
        if (wsFilter !== "__all__" && r.workspace_name !== wsFilter)
          return false;
        if (pipelineFilter !== "__all__" && r.pipeline_name !== pipelineFilter)
          return false;
        return true;
      }),
    [records, wsFilter, pipelineFilter]
  );

  // Group for sidebar display: workspace → pipeline → records
  const grouped = useMemo(() => {
    const map = new Map<string, Map<string, TraitRecord[]>>();
    for (const r of filteredRecords) {
      if (!map.has(r.workspace_name)) map.set(r.workspace_name, new Map());
      const pMap = map.get(r.workspace_name)!;
      if (!pMap.has(r.pipeline_name)) pMap.set(r.pipeline_name, []);
      pMap.get(r.pipeline_name)!.push(r);
    }
    return map;
  }, [filteredRecords]);

  const { data: traitsData, isLoading: traitsLoading } = useQuery({
    queryKey: ["trait-record-geojson", selectedId],
    queryFn: () => analyzeApi.getTraitRecordGeojson(selectedId!),
    enabled: !!selectedId,
    staleTime: 60_000,
  });

  // Auto-pick the first metric when data loads; fall back when user hasn't chosen one yet.
  // Derived rather than stored in state to avoid side effects in render callbacks.
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
    [records, selectedId],
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
                <SelectItem key={p} value={p} className="text-xs">
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {[...grouped.entries()].map(([ws, pipelineMap]) => (
            <CollapsibleWorkspace key={ws} name={ws}>
              {[...pipelineMap.entries()].map(([pipeline, recs]) => (
                <div key={pipeline}>
                  <p className="text-muted-foreground px-3 py-0.5 text-xs flex items-center gap-1.5">
                    <span className="truncate">{pipeline}</span>
                    {recs[0] && (
                      <Badge variant="secondary" className="flex-shrink-0 text-[10px] px-1 py-0 capitalize leading-tight">
                        {recs[0].pipeline_type}
                      </Badge>
                    )}
                  </p>
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
                        <span className="text-muted-foreground flex-shrink-0 font-mono text-[10px]">v{r.version}</span>
                        <Badge variant="outline" className="flex-shrink-0 text-[10px] px-1 py-0 capitalize leading-tight">
                          {r.pipeline_type}
                        </Badge>
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
                            ? versionLabel(r.boundary_version, r.boundary_name)
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
              showPolygons={showPolygons}
            />
            {selectedRecord && (
              <div className="absolute top-2 right-2 z-10 bg-background/80 backdrop-blur-sm border rounded px-2 py-1 text-xs shadow-sm space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium">{selectedRecord.date}</span>
                  <span className="text-muted-foreground font-mono">v{selectedRecord.version}</span>
                  <Badge variant="outline" className="text-[10px] px-1 py-0 capitalize leading-tight">
                    {selectedRecord.pipeline_type}
                  </Badge>
                </div>
                <div className="text-muted-foreground">{selectedRecord.pipeline_name}</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function AnalyzeDashboard() {
  const { data: records = [], isLoading } = useQuery({
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
      <div className="flex-shrink-0 px-6 pt-5 pb-3">
        <h1 className="text-2xl font-semibold">Analyze</h1>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="table" className="flex min-h-0 flex-1 flex-col px-6">
        <TabsList className="mb-4 flex-shrink-0 self-start">
          <TabsTrigger value="table" className="gap-1.5">
            <Table2 className="h-3.5 w-3.5" />
            Table
          </TabsTrigger>
          <TabsTrigger value="map" className="gap-1.5">
            <MapIcon className="h-3.5 w-3.5" />
            Map
          </TabsTrigger>
        </TabsList>

        <TabsContent value="table" className="mt-0 flex-1 overflow-auto pb-6">
          <TableTab records={records} />
        </TabsContent>

        <TabsContent
          value="map"
          className="mt-0 min-h-0 flex-1 data-[state=inactive]:hidden"
          style={{ display: undefined }}
        >
          <div className="h-full overflow-hidden rounded-lg border">
            <MapTab records={records} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
