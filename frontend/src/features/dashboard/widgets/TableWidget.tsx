import { useMemo, useState } from "react"
import { Loader2, ArrowUpDown, Download, ListFilter } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useTraitRecordGeojson, useMultiTraitGeojson, applyFilters, formatDashboardValue } from "../hooks/useTraitData"
import { useTraitRecords } from "../hooks/useTraitData"
import { deduplicateKeys } from "@/features/analyze/utils/traitAliases"
import type { TableConfig } from "../types"

type SortDir = "asc" | "desc" | null

function formatVal(v: unknown, col?: string): string {
  return formatDashboardValue(v, col)
}

function downloadCsv(rows: string[][], filename: string) {
  const content = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")
  const blob = new Blob([content], { type: "text/csv" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── Column filter dropdown ────────────────────────────────────────────────────

function ColFilterDropdown({
  col, uniqueValues, selected, onChange,
}: {
  col: string
  uniqueValues: string[]
  selected: string[]
  onChange: (vals: string[]) => void
}) {
  const isActive = selected.length > 0
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={`ml-0.5 inline-flex items-center rounded p-0.5 transition-colors hover:bg-muted ${isActive ? "text-primary" : "text-muted-foreground/50 hover:text-muted-foreground"}`}
          title={`Filter ${col.replace(/_/g, " ")}`}
        >
          <ListFilter className="w-3 h-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
        <DropdownMenuLabel className="text-xs">{col.replace(/_/g, " ")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {isActive && (
          <>
            <DropdownMenuItem className="text-xs" onClick={() => onChange([])}>Clear filter</DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {uniqueValues.map((v) => (
          <DropdownMenuCheckboxItem
            key={v}
            className="text-xs"
            checked={selected.includes(v)}
            onCheckedChange={() =>
              onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v])
            }
            onSelect={(e) => e.preventDefault()}
          >
            {v}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ── Main widget ───────────────────────────────────────────────────────────────

interface TableWidgetProps {
  config: TableConfig
}

export function TableWidget({ config }: TableWidgetProps) {
  const { columns, filters, maxRows } = config
  const [search, setSearch] = useState("")
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)
  // Per-column value filters (widget-local, not persisted to config)
  const [colFilters, setColFilters] = useState<Record<string, string[]>>({})

  // Resolve which record IDs to load: prefer multi-source, fall back to single
  const { data: allRecords } = useTraitRecords()
  const activeIds = useMemo((): string[] => {
    if ((config.traitRecordIds?.length ?? 0) > 0) return config.traitRecordIds
    if (config.traitRecordId) return [config.traitRecordId]
    return []
  }, [config.traitRecordIds, config.traitRecordId])

  const isMultiSource = activeIds.length > 1

  // Single-source path (existing query)
  const singleQuery = useTraitRecordGeojson(activeIds.length === 1 ? activeIds[0] : null)

  // Multi-source path
  const multiQuery = useMultiTraitGeojson(activeIds.length > 1 ? activeIds : [])

  const isLoading = activeIds.length === 1 ? singleQuery.isLoading : multiQuery.loading
  const isError = activeIds.length === 1 ? singleQuery.isError : false

  // Build merged feature list with optional _source column
  const { cols, rows: rawFeatures } = useMemo(() => {
    if (activeIds.length === 0) return { cols: [] as string[], rows: [] as { props: Record<string, unknown> }[] }

    let mergedFeatures: { props: Record<string, unknown> }[] = []
    let allKeys: string[] = []

    if (activeIds.length === 1) {
      const geoData = singleQuery.data
      if (!geoData) return { cols: [], rows: [] }
      mergedFeatures = applyFilters(geoData.geojson.features, filters)
        .map((f) => ({ props: f.properties ?? {} }))
      allKeys = deduplicateKeys(geoData.geojson.features.flatMap((f) => Object.keys(f.properties ?? {})))
    } else {
      // Multi-source: union columns, add _source
      const keySet = new Set<string>()
      multiQuery.data.forEach((geoData, i) => {
        if (!geoData) return
        const recordId = activeIds[i]
        const record = allRecords?.find((r) => r.id === recordId)
        const label = record ? `${record.pipeline_name} · ${record.date}` : recordId
        applyFilters(geoData.geojson.features, filters).forEach((f) => {
          const props = { ...(f.properties ?? {}), _source: label }
          mergedFeatures.push({ props })
          Object.keys(props).forEach((k) => keySet.add(k))
        })
        geoData.geojson.features.forEach((f) =>
          Object.keys(f.properties ?? {}).forEach((k) => keySet.add(k))
        )
      })
      // _source first, then deduplicated rest
      const rest = deduplicateKeys([...keySet].filter((k) => k !== "_source"))
      allKeys = ["_source", ...rest]
    }

    const resolvedCols = columns.length > 0
      ? (isMultiSource ? ["_source", ...columns.filter((c) => allKeys.includes(c) && c !== "_source")] : columns.filter((c) => allKeys.includes(c)))
      : allKeys

    return { cols: resolvedCols, rows: mergedFeatures }
  }, [activeIds, singleQuery.data, multiQuery.data, filters, columns, allRecords, isMultiSource])

  // Unique values per column (for column filter dropdowns)
  const uniqueByCol = useMemo(() => {
    const out: Record<string, string[]> = {}
    cols.forEach((col) => {
      const vals = [...new Set(rawFeatures.map((r) => String(r.props[col] ?? "")).filter(Boolean))].sort()
      if (vals.length > 0 && vals.length <= 200) out[col] = vals
    })
    return out
  }, [rawFeatures, cols])

  const rows = useMemo(() => {
    let features = rawFeatures
    // Global search
    if (search.trim()) {
      const q = search.toLowerCase()
      features = features.filter((r) =>
        cols.some((c) => String(r.props[c] ?? "").toLowerCase().includes(q))
      )
    }
    // Column filters
    const activeColFilters = Object.entries(colFilters).filter(([, vals]) => vals.length > 0)
    if (activeColFilters.length > 0) {
      features = features.filter((r) =>
        activeColFilters.every(([col, vals]) => vals.includes(String(r.props[col] ?? "")))
      )
    }
    // Sort
    if (sortCol && sortDir) {
      features = [...features].sort((a, b) => {
        const av = a.props[sortCol]
        const bv = b.props[sortCol]
        const an = typeof av === "number" ? av : NaN
        const bn = typeof bv === "number" ? bv : NaN
        if (!isNaN(an) && !isNaN(bn)) return sortDir === "asc" ? an - bn : bn - an
        return sortDir === "asc"
          ? String(av ?? "").localeCompare(String(bv ?? ""))
          : String(bv ?? "").localeCompare(String(av ?? ""))
      })
    }
    const limit = maxRows > 0 ? maxRows : 200
    return features.slice(0, limit)
  }, [rawFeatures, search, colFilters, sortCol, sortDir, cols, maxRows])

  function toggleSort(col: string) {
    if (sortCol !== col) { setSortCol(col); setSortDir("asc") }
    else if (sortDir === "asc") setSortDir("desc")
    else { setSortCol(null); setSortDir(null) }
  }

  function handleExport() {
    const data = rows.map((r) => cols.map((c) => formatVal(r.props[c], c)))
    downloadCsv([cols, ...data], `traits-export.csv`)
  }

  const activeColFilterCount = Object.values(colFilters).filter((v) => v.length > 0).length

  if (activeIds.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Configure this widget to select a data source.
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    )
  }

  if (isError) return <p className="text-sm text-destructive">Failed to load data.</p>

  return (
    <div className="flex flex-col h-full gap-2">
      <div className="flex items-center gap-2 flex-shrink-0">
        <Input
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-7 text-xs"
        />
        {activeColFilterCount > 0 && (
          <button
            className="text-xs text-primary hover:underline whitespace-nowrap"
            onClick={() => setColFilters({})}
          >
            Clear {activeColFilterCount} col filter{activeColFilterCount > 1 ? "s" : ""}
          </button>
        )}
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleExport}>
          <Download className="w-3 h-3" /> CSV
        </Button>
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {rows.length} rows
        </span>
      </div>

      <div className="overflow-auto flex-1 rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {cols.map((col) => (
                <TableHead
                  key={col}
                  className="text-xs select-none whitespace-nowrap"
                >
                  <span className="flex items-center gap-0.5">
                    <button
                      className="flex items-center gap-1 hover:text-foreground"
                      onClick={() => toggleSort(col)}
                    >
                      {col === "_source" ? "Source" : col.replace(/_/g, " ")}
                      <ArrowUpDown className="w-3 h-3 opacity-40" />
                    </button>
                    {uniqueByCol[col] && (
                      <ColFilterDropdown
                        col={col}
                        uniqueValues={uniqueByCol[col]}
                        selected={colFilters[col] ?? []}
                        onChange={(vals) => setColFilters((prev) => ({ ...prev, [col]: vals }))}
                      />
                    )}
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                {cols.map((col) => (
                  <TableCell key={col} className="text-xs py-1.5 whitespace-nowrap">
                    {formatVal(r.props[col], col)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
