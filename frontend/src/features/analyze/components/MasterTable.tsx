/**
 * MasterTableTab — workspace-level table of all plots across all pipelines.
 *
 * One row per unique (experiment, location, population, plot_id).
 * Pipeline trait columns are colored by pipeline.  Reference trait columns
 * appear at the far right under an orange "REF" group label.
 *
 * Eye/download actions are in the rightmost column.
 * Selecting a row opens an inline viewer below the table showing plot images
 * per pipeline + a trait values panel.
 */

import { useState, useMemo, useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { AnalyzeService } from "@/client"
import { ReferenceDataPanel } from "./ReferenceDataPanel"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import {
  Download,
  Eye,
  FlaskConical,
  Loader2,
  ImageOff,
  X,
} from "lucide-react"
import type { TraitRecord } from "../api"

// ── helpers ───────────────────────────────────────────────────────────────────

function apiUrl(path: string): string {
  const base = (window as any).__GEMI_BACKEND_URL__ ?? ""
  return base ? `${base}${path}` : path
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("access_token") || ""
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function downloadCsvContent(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function fmt(v: unknown): string {
  if (v == null) return "—"
  if (typeof v === "number") return isNaN(v) ? "—" : v.toFixed(3)
  return String(v)
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface PipelineMeta {
  id: string
  name: string
  type: string
  color: string
}

interface RefDatasetMeta {
  id: string
  name: string
  experiment: string
  location: string
  population: string
  trait_columns: string[]
}

interface ColumnDef {
  key: string
  group: "pipeline" | "reference"
  pipeline_id?: string
  dataset_id?: string
  label: string
}

interface PlotRecord {
  trait_record_id: string
  run_id: string
  pipeline_name: string
}

interface MasterRow {
  experiment: string
  location: string
  population: string
  plot_id: string
  accession: string | null
  col: string | null
  row: string | null
  pipeline_ids: string[]
  __records__: Record<string, PlotRecord>
  [key: string]: unknown
}

interface MasterTableData {
  pipelines: PipelineMeta[]
  reference_datasets: RefDatasetMeta[]
  columns: ColumnDef[]
  rows: MasterRow[]
}

// ── Per-pipeline plot image cell ──────────────────────────────────────────────

function PlotImageCell({
  recordId,
  plotId,
  pipelineName,
  pipelineColor,
}: {
  recordId: string
  plotId: string
  pipelineName: string
  pipelineColor: string
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    setBlobUrl(null)
    setError(false)
    let revoke: string | null = null
    fetch(apiUrl(`/api/v1/analyze/trait-records/${recordId}/plot-image/${plotId}`), {
      headers: authHeaders(),
    })
      .then((res) => { if (!res.ok) throw new Error(); return res.blob() })
      .then((blob) => { const url = URL.createObjectURL(blob); revoke = url; setBlobUrl(url) })
      .catch(() => setError(true))
    return () => { if (revoke) URL.revokeObjectURL(revoke) }
  }, [recordId, plotId])

  return (
    <div className="flex flex-col rounded-lg border overflow-hidden flex-1 min-w-0">
      <div
        className="px-2 py-1 text-xs font-medium text-white flex-shrink-0"
        style={{ background: pipelineColor }}
      >
        {pipelineName}
      </div>
      <div className="flex items-center justify-center bg-muted/30" style={{ height: 280 }}>
        {blobUrl ? (
          <img src={blobUrl} alt={`plot ${plotId}`} className="max-h-full max-w-full object-contain" />
        ) : error ? (
          <div className="flex flex-col items-center gap-1 text-muted-foreground p-4">
            <ImageOff className="w-6 h-6" />
            <span className="text-xs">No image</span>
          </div>
        ) : (
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        )}
      </div>
    </div>
  )
}

// ── Plot dialog (reuses same dialog pattern as Pipeline Runs) ─────────────────

function MasterPlotDialog({
  row,
  pipelines,
  columns,
  refContext,
  onClose,
  onDownload,
}: {
  row: MasterRow
  pipelines: PipelineMeta[]
  columns: ColumnDef[]
  refContext: { workspaceId: string; experiment: string; location: string; population: string } | null
  onClose: () => void
  onDownload: () => void
}) {
  const [showRef, setShowRef] = useState(false)

  const contributing = row.pipeline_ids
    .map((pid) => {
      const meta = pipelines.find((p) => p.id === pid)
      const rec = row.__records__[pid]
      if (!meta || !rec) return null
      return { pid, meta, rec }
    })
    .filter(Boolean) as Array<{ pid: string; meta: PipelineMeta; rec: PlotRecord }>

  const refProps = refContext && row.plot_id
    ? {
        workspaceId: refContext.workspaceId,
        experiment: row.experiment,
        location: row.location,
        population: row.population,
        plotId: row.plot_id,
        col: row.col ?? undefined,
        row: row.row ?? undefined,
      }
    : null

  const traitEntries = columns.map((c) => ({
    label: c.label,
    value: row[c.key],
    color: c.group === "reference" ? "#f97316" : undefined,
    pipelineColor: pipelines.find((p) => p.id === c.pipeline_id)?.color,
  }))

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-3xl [&>button:last-child]:hidden">
        <DialogHeader>
          <DialogTitle asChild>
            <div className="flex items-center gap-2 pr-1">
              <span className="text-sm font-semibold flex-1">
                Plot {row.plot_id}
                {row.accession && (
                  <span className="font-normal text-muted-foreground ml-2 text-xs">· {row.accession}</span>
                )}
              </span>
              {refProps && (
                <button
                  type="button"
                  className={`flex items-center gap-1 text-xs rounded px-2 py-0.5 border transition-colors ${
                    showRef
                      ? "bg-orange-500 text-white border-orange-500"
                      : "text-orange-500 border-orange-300 hover:bg-orange-50 dark:hover:bg-orange-950"
                  }`}
                  onClick={() => setShowRef((v) => !v)}
                >
                  <FlaskConical className="w-3 h-3" />
                  REF
                </button>
              )}
              <button
                type="button"
                title="Download row CSV"
                className="text-muted-foreground hover:text-foreground transition-colors"
                onClick={onDownload}
              >
                <Download className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                title="Close"
                className="h-7 w-7 flex items-center justify-center rounded-sm opacity-70 hover:opacity-100 transition-opacity"
                onClick={onClose}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-4 min-h-0">
          {/* Pipeline images */}
          <div className={`flex gap-3 flex-1 min-w-0 ${contributing.length === 1 ? "justify-center" : ""}`}>
            {contributing.map(({ pid, meta, rec }) => (
              <PlotImageCell
                key={pid}
                recordId={rec.trait_record_id}
                plotId={row.plot_id}
                pipelineName={meta.name}
                pipelineColor={meta.color}
              />
            ))}
          </div>

          {/* Traits panel */}
          <div className="w-48 shrink-0 border-l pl-4 overflow-y-auto" style={{ maxHeight: 380 }}>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Traits</p>
            <div className="space-y-1">
              {traitEntries.map((t, i) => (
                <div key={i} className="flex justify-between items-baseline gap-2">
                  <span
                    className="text-[11px] truncate"
                    style={{ color: t.color ?? t.pipelineColor ?? undefined }}
                  >
                    {t.label}
                  </span>
                  <span className="text-[11px] font-mono tabular-nums shrink-0">
                    {fmt(t.value)}
                  </span>
                </div>
              ))}
            </div>

            {showRef && refProps && (
              <div className="border-t mt-3 pt-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-orange-500 mb-2">
                  Reference Data
                </p>
                <ReferenceDataPanel {...refProps} />
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface MasterTableTabProps {
  records: TraitRecord[]
}

export function MasterTableTab({ records }: MasterTableTabProps) {
  // ── Workspace selector ────────────────────────────────────────────────────
  const workspaces = useMemo(() => {
    const seen = new Map<string, string>()
    for (const r of records) {
      if (r.workspace_id && !seen.has(r.workspace_id)) {
        seen.set(r.workspace_id, r.workspace_name)
      }
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [records])

  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>(() => workspaces[0]?.id ?? "")

  useEffect(() => {
    if (workspaces.length && !workspaces.find((w) => w.id === selectedWorkspaceId)) {
      setSelectedWorkspaceId(workspaces[0]?.id ?? "")
    }
  }, [workspaces])

  // ── Data fetch ────────────────────────────────────────────────────────────
  const { data, isLoading, error } = useQuery({
    queryKey: ["master-table", selectedWorkspaceId],
    queryFn: () => AnalyzeService.getMasterTable({ workspaceId: selectedWorkspaceId }),
    enabled: !!selectedWorkspaceId,
    staleTime: 30_000,
  })

  const tableData = data as MasterTableData | undefined

  // ── Viewer state ──────────────────────────────────────────────────────────
  const [viewRow, setViewRow] = useState<MasterRow | null>(null)

  // ── Column visibility ─────────────────────────────────────────────────────
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(new Set())

  function toggleGroup(group: string) {
    setHiddenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  const visibleColumns: ColumnDef[] = useMemo(() => {
    if (!tableData) return []
    return tableData.columns.filter((c) => {
      const gid = c.group === "reference" ? "reference" : `pipeline:${c.pipeline_id}`
      return !hiddenGroups.has(gid)
    })
  }, [tableData, hiddenGroups])

  const pipelineColorMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of tableData?.pipelines ?? []) m.set(p.id, p.color)
    return m
  }, [tableData])

  const selectedWorkspace = workspaces.find((w) => w.id === selectedWorkspaceId)

  const refContextBase = selectedWorkspaceId ? { workspaceId: selectedWorkspaceId } : null

  // ── CSV helpers ───────────────────────────────────────────────────────────
  function rowToCsvLine(row: MasterRow, cols: string[]): string {
    return cols.map((k) => {
      const v = row[k]
      if (v == null) return ""
      const s = String(v)
      return s.includes(",") ? `"${s}"` : s
    }).join(",")
  }

  function handleDownloadAll() {
    if (!tableData) return
    const identityCols = ["experiment", "location", "population", "plot_id", "accession", "col", "row"]
    const traitKeys = tableData.columns.map((c) => c.key)
    const cols = [...identityCols, ...traitKeys]
    const lines = [cols.join(","), ...tableData.rows.map((r) => rowToCsvLine(r, cols))]
    downloadCsvContent(lines.join("\n"), `master_table_${selectedWorkspace?.name ?? ""}.csv`)
  }

  function handleDownloadRow(row: MasterRow) {
    const identityCols = ["experiment", "location", "population", "plot_id", "accession", "col", "row"]
    const traitKeys = (tableData?.columns ?? []).map((c) => c.key)
    const cols = [...identityCols, ...traitKeys]
    const lines = [cols.join(","), rowToCsvLine(row, cols)]
    downloadCsvContent(lines.join("\n"), `plot_${row.plot_id}.csv`)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (workspaces.length === 0) {
    return (
      <div className="text-muted-foreground flex h-40 items-center justify-center text-sm">
        No trait records found. Complete a pipeline run to populate this table.
      </div>
    )
  }

  const totalCols = 7 + 1 + visibleColumns.length // identity + actions + traits

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={selectedWorkspaceId} onValueChange={setSelectedWorkspaceId}>
          <SelectTrigger className="h-8 text-xs w-52">
            <SelectValue placeholder="Select workspace" />
          </SelectTrigger>
          <SelectContent>
            {workspaces.map((w) => (
              <SelectItem key={w.id} value={w.id} className="text-xs">{w.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {tableData?.pipelines.map((p) => {
          const gid = `pipeline:${p.id}`
          const hidden = hiddenGroups.has(gid)
          return (
            <Badge
              key={p.id}
              variant={hidden ? "outline" : "secondary"}
              className="cursor-pointer select-none text-xs"
              style={hidden ? {} : { borderColor: p.color, color: p.color }}
              onClick={() => toggleGroup(gid)}
            >
              {p.name}
            </Badge>
          )
        })}

        {(tableData?.reference_datasets.length ?? 0) > 0 && (
          <Badge
            variant={hiddenGroups.has("reference") ? "outline" : "secondary"}
            className="cursor-pointer select-none text-xs"
            style={hiddenGroups.has("reference") ? {} : { borderColor: "#f97316", color: "#f97316" }}
            onClick={() => toggleGroup("reference")}
          >
            REF
          </Badge>
        )}

        <div className="ml-auto">
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={handleDownloadAll} disabled={!tableData}>
            <Download className="w-3 h-3" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Loading / error */}
      {isLoading && (
        <div className="flex h-40 items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading master table…
        </div>
      )}
      {error && !isLoading && (
        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
          Failed to load master table.
        </div>
      )}

      {/* Table */}
      {tableData && !isLoading && (
        <div className="rounded-md border overflow-auto max-h-[calc(100vh-340px)]">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-background z-10 shadow-[0_1px_0_0_hsl(var(--border))]">
              {/* Group header row */}
              <tr className="border-b bg-muted/50">
                <th className="px-3 py-1 text-left font-medium text-muted-foreground" colSpan={7}>
                  Plot Identity
                </th>
                {tableData.pipelines
                  .filter((p) => !hiddenGroups.has(`pipeline:${p.id}`))
                  .map((p) => {
                    const cols = visibleColumns.filter((c) => c.pipeline_id === p.id)
                    if (!cols.length) return null
                    return (
                      <th
                        key={p.id}
                        colSpan={cols.length}
                        className="px-2 py-1 text-center font-semibold border-l"
                        style={{ color: p.color }}
                      >
                        {p.name}
                      </th>
                    )
                  })}
                {!hiddenGroups.has("reference") && visibleColumns.some((c) => c.group === "reference") && (
                  <th
                    colSpan={visibleColumns.filter((c) => c.group === "reference").length}
                    className="px-2 py-1 text-center font-semibold text-orange-500 border-l"
                  >
                    REF
                  </th>
                )}
                <th className="px-2 py-1" /> {/* actions */}
              </tr>

              {/* Column label row */}
              <tr className="border-b">
                {["Experiment", "Location", "Population", "Plot ID", "Accession", "Col", "Row"].map((h) => (
                  <th key={h} className="px-3 py-1.5 text-left font-medium text-muted-foreground whitespace-nowrap">
                    {h}
                  </th>
                ))}
                {visibleColumns.map((c) => (
                  <th
                    key={c.key}
                    className="px-2 py-1.5 text-left font-medium whitespace-nowrap"
                    style={{ color: c.group === "reference" ? "#f97316" : pipelineColorMap.get(c.pipeline_id ?? "") }}
                  >
                    {c.label}
                  </th>
                ))}
                <th className="px-2 py-1.5 text-right text-muted-foreground">View</th>
              </tr>
            </thead>
            <tbody>
              {tableData.rows.length === 0 ? (
                <tr>
                  <td colSpan={totalCols} className="px-3 py-6 text-center text-muted-foreground">
                    No plots found for this workspace.
                  </td>
                </tr>
              ) : (
                tableData.rows.map((row, i) => {
                  return (
                    <tr key={i} className="border-b transition-colors hover:bg-muted/20">
                      <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{row.experiment || "—"}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{row.location || "—"}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{row.population || "—"}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap font-mono font-medium">{row.plot_id}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">{row.accession || "—"}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">{row.col || "—"}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">{row.row || "—"}</td>

                      {visibleColumns.map((c) => {
                        const val = row[c.key]
                        return (
                          <td
                            key={c.key}
                            className="px-2 py-1.5 tabular-nums"
                            style={{ color: c.group === "reference" ? "#f97316" : undefined }}
                          >
                            {val == null
                              ? <span className="text-muted-foreground">—</span>
                              : typeof val === "number" ? val.toFixed(3) : String(val)
                            }
                          </td>
                        )
                      })}

                      {/* Actions — far right */}
                      <td className="px-2 py-1.5">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            title="View plot images"
                            className="text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => setViewRow(row)}
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            title="Download row CSV"
                            className="text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => handleDownloadRow(row)}
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Plot dialog */}
      {viewRow && tableData && (
        <MasterPlotDialog
          row={viewRow}
          pipelines={tableData.pipelines}
          columns={visibleColumns}
          refContext={refContextBase ? {
            ...refContextBase,
            experiment: viewRow.experiment,
            location: viewRow.location,
            population: viewRow.population,
          } : null}
          onClose={() => setViewRow(null)}
          onDownload={() => handleDownloadRow(viewRow)}
        />
      )}
    </div>
  )
}
