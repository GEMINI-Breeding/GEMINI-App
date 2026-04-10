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
import { useQuery, useQueries } from "@tanstack/react-query"
import { AnalyzeService } from "@/client"
import { ReferenceDataPanel } from "./ReferenceDataPanel"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  useExpandable,
  ExpandButton,
  FullscreenModal,
} from "@/components/Common/ExpandableSection"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FlaskConical,
  Loader2,
  ScanSearch,
  Tag,
  X,
} from "lucide-react"
import { PlotImage, type Prediction as CellPrediction } from "@/components/Common/PlotImage"
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
  date: string
  trait_columns: string[]
}

interface ColumnDef {
  key: string
  group: "pipeline" | "reference"
  pipeline_id?: string
  dataset_id?: string
  dataset_date?: string
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
  date: string
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
  recordId, plotId, pipelineName, pipelineColor,
  rotate = false,
  predictions = [], showDetections = false, showLabels = false, activeClass = null,
}: {
  recordId: string; plotId: string; pipelineName: string; pipelineColor: string
  rotate?: boolean; predictions?: CellPrediction[]; showDetections?: boolean
  showLabels?: boolean; activeClass?: string | null
}) {
  return (
    <div className="flex flex-col rounded-lg border overflow-hidden flex-1 min-w-0 min-h-0">
      <div className="px-2 py-1 text-xs font-medium text-white shrink-0" style={{ background: pipelineColor }}>
        {pipelineName}
      </div>
      <div className="flex-1 min-h-0">
        <PlotImage
          recordId={recordId}
          plotId={plotId}
          rotate={rotate}
          predictions={predictions}
          showDetections={showDetections}
          showLabels={showLabels}
          activeClass={activeClass}
        />
      </div>
    </div>
  )
}

// ── Plot dialog ───────────────────────────────────────────────────────────────

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
  const [showDetections, setShowDetections] = useState(false)
  const [showLabels, setShowLabels] = useState(true)
  const [activeClass, setActiveClass] = useState<string | null>(null)
  const exp = useExpandable()

  // Fetch inference results for all contributing pipelines
  const runIds = useMemo(
    () => [...new Set(row.pipeline_ids.map((pid) => row.__records__[pid]?.run_id).filter(Boolean) as string[])],
    [row]
  )
  const inferenceQueries = useQueries({
    queries: runIds.map((runId) => ({
      queryKey: ["inference-results", runId],
      queryFn: () =>
        fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/inference-results`), { headers: authHeaders() })
          .then((r) => r.ok ? r.json() : null),
      staleTime: 60_000,
    })),
  })
  // predsByRunByPlot: runId → plotId → predictions (keeps per-pipeline predictions separate)
  const predsByRunByPlot = useMemo<Record<string, Record<string, CellPrediction[]>>>(() => {
    const map: Record<string, Record<string, CellPrediction[]>> = {}
    runIds.forEach((runId, i) => {
      const data = inferenceQueries[i]?.data
      if (!data?.available) return
      const images: Array<{ name: string; plot?: string }> = data.images ?? []
      const preds: CellPrediction[] = data.predictions ?? []
      map[runId] = {}
      for (const img of images) {
        if (!img.plot) continue
        const ps = preds.filter((p) => p.image === img.name)
        if (ps.length > 0) map[runId][img.plot] = ps
      }
    })
    return map
  }, [inferenceQueries, runIds])
  const inferenceAvailable = Object.values(predsByRunByPlot).some((byPlot) => Object.keys(byPlot).length > 0)

  const uniqueClasses = useMemo(() => {
    const all = Object.values(predsByRunByPlot).flatMap((byPlot) => Object.values(byPlot).flat().map((p) => p.class))
    return [...new Set(all)].sort()
  }, [predsByRunByPlot])

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

  const title = `Plot ${row.plot_id}${row.accession ? ` · ${row.accession}` : ""}`

  const headerActions = (
    <>
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
      {inferenceAvailable && (
        <>
          <button
            type="button"
            onClick={() => setShowDetections((v) => !v)}
            className={`flex items-center gap-1 text-xs rounded px-2 py-0.5 border transition-colors ${
              showDetections
                ? "bg-primary text-primary-foreground border-primary"
                : "text-muted-foreground border-input hover:text-foreground"
            }`}
          >
            <ScanSearch className="w-3 h-3" />
            {showDetections ? "Hide" : "Detections"}
          </button>
          {showDetections && (
            <button
              onClick={() => setShowLabels((v) => !v)}
              className={`flex items-center gap-1 text-xs rounded px-2 py-0.5 border transition-colors ${showLabels ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground border-input hover:text-foreground"}`}
            >
              <Tag className="w-3 h-3" />
              Labels
            </button>
          )}
          {showDetections && uniqueClasses.length > 1 && (
            <div className="flex items-center gap-0.5 border rounded text-xs">
              <button
                onClick={() => setActiveClass((c) => { const i = uniqueClasses.indexOf(c ?? ""); return i <= 0 ? null : uniqueClasses[i - 1] })}
                className="px-1 py-0.5 hover:bg-muted"
              ><ChevronLeft className="w-3 h-3" /></button>
              <span className="px-1 min-w-[56px] text-center truncate">{activeClass ?? "All"}</span>
              <button
                onClick={() => setActiveClass((c) => { const i = uniqueClasses.indexOf(c ?? ""); return i >= uniqueClasses.length - 1 ? null : uniqueClasses[i + 1] })}
                className="px-1 py-0.5 hover:bg-muted"
              ><ChevronRight className="w-3 h-3" /></button>
            </div>
          )}
        </>
      )}
      <button
        type="button"
        title="Download row CSV"
        className="text-muted-foreground hover:text-foreground transition-colors"
        onClick={onDownload}
      >
        <Download className="w-3.5 h-3.5" />
      </button>
    </>
  )

  const plotContent = (
    <div className="flex gap-4 flex-1 min-h-[300px]">
      {/* Pipeline images */}
      <div className={`flex gap-3 flex-1 min-w-0 min-h-0 ${contributing.length === 1 ? "justify-center" : ""}`}>
        {contributing.map(({ pid, meta, rec }) => (
          <PlotImageCell
            key={pid}
            recordId={rec.trait_record_id}
            plotId={row.plot_id}
            pipelineName={meta.name}
            pipelineColor={meta.color}
            rotate={meta.type === "ground"}
            predictions={predsByRunByPlot[rec.run_id]?.[row.plot_id] ?? []}
            showDetections={showDetections}
            showLabels={showLabels}
            activeClass={activeClass}
          />
        ))}
      </div>

      {/* Traits panel */}
      <div className="w-48 shrink-0 border-l pl-4 overflow-y-auto">
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
  )

  const dialogHeader = (
    <DialogHeader className="shrink-0">
      <DialogTitle asChild>
        <div className="flex items-center gap-2 pr-1">
          <span className="text-sm font-semibold flex-1">{title}</span>
          {headerActions}
          <div className="flex items-center gap-0.5 border-l pl-2 ml-1">
            <ExpandButton onClick={exp.open} title="Expand to fullscreen" />
            <button
              type="button"
              title="Close"
              className="h-7 w-7 flex items-center justify-center rounded-sm opacity-70 hover:opacity-100 transition-opacity"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </DialogTitle>
    </DialogHeader>
  )

  return (
    <>
      <Dialog open={!exp.isExpanded} onOpenChange={(o) => { if (!o) onClose() }}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col [&>button:last-child]:hidden">
          {dialogHeader}
          {plotContent}
        </DialogContent>
      </Dialog>

      <FullscreenModal
        open={exp.isExpanded}
        onClose={() => { exp.close(); onClose() }}
        title={title}
        headerExtra={<div className="flex items-center gap-2">{headerActions}</div>}
      >
        <div className="flex flex-col h-full p-6">
          {plotContent}
        </div>
      </FullscreenModal>
    </>
  )
}

// ── Date multi-select ─────────────────────────────────────────────────────────

function DateMultiSelect({
  dates,
  selected,
  onChange,
}: {
  dates: string[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
}) {
  const allSelected = selected.size === 0 || selected.size === dates.length

  function toggle(date: string) {
    const next = new Set(selected)
    if (next.has(date)) {
      next.delete(date)
      // If nothing left, reset to "all"
      if (next.size === 0) { onChange(new Set()); return }
    } else {
      next.add(date)
    }
    onChange(next)
  }

  function toggleAll() {
    onChange(new Set())
  }

  const label = allSelected
    ? "All dates"
    : selected.size === 1
      ? [...selected][0]
      : `${selected.size} dates`

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 min-w-[120px] justify-between">
          <span className="flex items-center gap-1.5">
            <CalendarDays className="w-3 h-3 shrink-0" />
            {label}
          </span>
          <ChevronDown className="w-3 h-3 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="p-1 min-w-[160px]">
        {/* All toggle */}
        <label className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-muted/50 text-xs">
          <Checkbox
            checked={allSelected}
            onCheckedChange={toggleAll}
            className="h-3.5 w-3.5"
          />
          <span className="font-medium">All dates</span>
        </label>
        <div className="my-1 border-t" />
        {dates.map((d) => (
          <label key={d} className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-muted/50 text-xs">
            <Checkbox
              checked={allSelected || selected.has(d)}
              onCheckedChange={() => toggle(d)}
              className="h-3.5 w-3.5"
            />
            <span>{d || "(no date)"}</span>
          </label>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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

  // ── Date multi-select ─────────────────────────────────────────────────────
  // Collect unique dates from reference datasets (sorted)
  const availableDates = useMemo(() => {
    const dates = new Set<string>()
    for (const ds of tableData?.reference_datasets ?? []) {
      dates.add(ds.date ?? "")
    }
    return [...dates].sort()
  }, [tableData])

  // selectedDates: empty Set means "all selected"
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set())

  // Reset date selection when workspace changes
  useEffect(() => { setSelectedDates(new Set()) }, [selectedWorkspaceId])

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
    const allDatesSelected = selectedDates.size === 0
    return tableData.columns.filter((c) => {
      if (c.group === "pipeline") {
        return !hiddenGroups.has(`pipeline:${c.pipeline_id}`)
      }
      // reference column: filter by hidden group AND selected dates
      if (hiddenGroups.has("reference")) return false
      if (!allDatesSelected && !selectedDates.has(c.dataset_date ?? "")) return false
      return true
    })
  }, [tableData, hiddenGroups, selectedDates])

  const pipelineColorMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of tableData?.pipelines ?? []) m.set(p.id, p.color)
    return m
  }, [tableData])

  // dataset_id → RefDatasetMeta for quick lookup
  const refDatasetMap = useMemo(() => {
    const m = new Map<string, RefDatasetMeta>()
    for (const ds of tableData?.reference_datasets ?? []) m.set(ds.id, ds)
    return m
  }, [tableData])

  const selectedWorkspace = workspaces.find((w) => w.id === selectedWorkspaceId)
  const refContextBase = selectedWorkspaceId ? { workspaceId: selectedWorkspaceId } : null

  // ── Column filters ────────────────────────────────────────────────────────
  const IDENTITY_KEYS = ["experiment", "location", "population", "date", "plot_id", "accession", "col", "row"] as const
  const [colFilters, setColFilters] = useState<Record<string, string>>({})

  function setFilter(key: string, value: string) {
    setColFilters((prev) => ({ ...prev, [key]: value }))
  }

  const filteredRows = useMemo(() => {
    if (!tableData) return []
    return tableData.rows.filter((row) => {
      for (const key of IDENTITY_KEYS) {
        const f = colFilters[key]
        if (!f) continue
        const cell = String(row[key] ?? "").toLowerCase()
        if (!cell.includes(f.toLowerCase())) return false
      }
      return true
    })
  }, [tableData, colFilters])

  // Reset filters when workspace changes
  useEffect(() => { setColFilters({}) }, [selectedWorkspaceId])

  // ── CSV helpers ───────────────────────────────────────────────────────────
  function rowToCsvLine(row: MasterRow, cols: string[]): string {
    return cols.map((k) => {
      const v = row[k]
      if (v == null) return ""
      const s = String(v)
      return s.includes(",") ? `"${s}"` : s
    }).join(",")
  }

  const IDENTITY_CSV_COLS = ["experiment", "location", "population", "date", "plot_id", "accession", "col", "row"]

  function handleDownloadAll() {
    if (!tableData) return
    const traitKeys = tableData.columns.map((c) => c.key)
    const cols = [...IDENTITY_CSV_COLS, ...traitKeys]
    const lines = [cols.join(","), ...filteredRows.map((r) => rowToCsvLine(r, cols))]
    downloadCsvContent(lines.join("\n"), `master_table_${selectedWorkspace?.name ?? ""}.csv`)
  }

  function handleDownloadRow(row: MasterRow) {
    const traitKeys = (tableData?.columns ?? []).map((c) => c.key)
    const cols = [...IDENTITY_CSV_COLS, ...traitKeys]
    const lines = [cols.join(","), rowToCsvLine(row, cols)]
    downloadCsvContent(lines.join("\n"), `plot_${row.plot_id}.csv`)
  }

  // Group ref columns by dataset for the group header row
  const refGroupHeaders = useMemo(() => {
    const groups: { datasetId: string; label: string; count: number }[] = []
    let current: typeof groups[0] | null = null
    for (const c of visibleColumns) {
      if (c.group !== "reference") { current = null; continue }
      const ds = refDatasetMap.get(c.dataset_id ?? "")
      const label = ds ? (ds.date ? `${ds.name} (${ds.date})` : ds.name) : (c.dataset_id ?? "REF")
      if (current && current.datasetId === c.dataset_id) {
        current.count++
      } else {
        current = { datasetId: c.dataset_id ?? "", label, count: 1 }
        groups.push(current)
      }
    }
    return groups
  }, [visibleColumns, refDatasetMap])

  // ── Render ────────────────────────────────────────────────────────────────

  if (workspaces.length === 0) {
    return (
      <div className="text-muted-foreground flex h-40 items-center justify-center text-sm">
        No trait records found. Complete a pipeline run to populate this table.
      </div>
    )
  }

  const totalCols = 8 + 1 + visibleColumns.length // identity (8) + actions + traits

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

        {availableDates.length > 0 && (
          <DateMultiSelect
            dates={availableDates}
            selected={selectedDates}
            onChange={setSelectedDates}
          />
        )}

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

      {/* Column filters */}
      {tableData && !isLoading && (
        <div className="flex flex-wrap items-center gap-2">
          {(["experiment", "location", "population", "date", "plot_id", "accession", "col", "row"] as const).map((key) => (
            <Input
              key={key}
              className="h-7 text-xs w-24"
              placeholder={key.replace("_", " ").toUpperCase()}
              value={colFilters[key] ?? ""}
              onChange={(e) => setFilter(key, e.target.value)}
            />
          ))}
          {Object.values(colFilters).some((v) => v) && (
            <button
              className="text-primary text-xs hover:underline"
              onClick={() => setColFilters({})}
            >
              Clear
            </button>
          )}
          <span className="text-muted-foreground text-xs ml-auto">
            {filteredRows.length}{filteredRows.length !== tableData.rows.length ? ` / ${tableData.rows.length}` : ""} plots
          </span>
        </div>
      )}

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
                <th className="px-3 py-1 text-left font-medium text-muted-foreground" colSpan={8}>
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
                {refGroupHeaders.map((g) => (
                  <th
                    key={g.datasetId}
                    colSpan={g.count}
                    className="px-2 py-1 text-center font-semibold text-orange-500 border-l whitespace-nowrap"
                  >
                    {g.label}
                  </th>
                ))}
                <th className="px-2 py-1" /> {/* actions */}
              </tr>

              {/* Column label row */}
              <tr className="border-b">
                {(["Experiment", "Location", "Population", "Date", "Plot ID", "Accession", "Col", "Row"] as const).map((h) => (
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
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={totalCols} className="px-3 py-6 text-center text-muted-foreground">
                    {tableData.rows.length === 0 ? "No plots found for this workspace." : "No plots match the current filters."}
                  </td>
                </tr>
              ) : (
                filteredRows.map((row, i) => {
                  return (
                    <tr key={i} className="border-b transition-colors hover:bg-muted/20">
                      <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{row.experiment || "—"}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{row.location || "—"}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{row.population || "—"}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{row.date || "—"}</td>
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
