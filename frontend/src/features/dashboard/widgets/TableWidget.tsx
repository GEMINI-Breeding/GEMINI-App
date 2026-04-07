import { useMemo, useState } from "react"
import { Loader2, ArrowUpDown, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { useTraitRecordGeojson, applyFilters } from "../hooks/useTraitData"
import { deduplicateKeys } from "@/features/analyze/utils/traitAliases"
import type { TableConfig } from "../types"

type SortDir = "asc" | "desc" | null

function formatVal(v: unknown): string {
  if (v == null) return "—"
  if (typeof v === "number") {
    return Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/\.?0+$/, "")
  }
  return String(v)
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

interface TableWidgetProps {
  config: TableConfig
}

export function TableWidget({ config }: TableWidgetProps) {
  const { traitRecordId, columns, filters, maxRows } = config
  const [search, setSearch] = useState("")
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)

  const { data: geoData, isLoading, isError } = useTraitRecordGeojson(traitRecordId)

  const cols = useMemo(() => {
    if (!geoData) return []
    const allKeys = deduplicateKeys(
      geoData.geojson.features.flatMap((f) => Object.keys(f.properties ?? {}))
    )
    return columns.length > 0 ? columns.filter((c) => allKeys.includes(c)) : allKeys
  }, [geoData, columns])

  const rows = useMemo(() => {
    if (!geoData) return []
    let features = applyFilters(geoData.geojson.features, filters)
    if (search.trim()) {
      const q = search.toLowerCase()
      features = features.filter((f) =>
        cols.some((c) => String(f.properties?.[c] ?? "").toLowerCase().includes(q))
      )
    }
    if (sortCol && sortDir) {
      features = [...features].sort((a, b) => {
        const av = a.properties?.[sortCol]
        const bv = b.properties?.[sortCol]
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
  }, [geoData, filters, search, cols, sortCol, sortDir, maxRows])

  function toggleSort(col: string) {
    if (sortCol !== col) { setSortCol(col); setSortDir("asc") }
    else if (sortDir === "asc") setSortDir("desc")
    else { setSortCol(null); setSortDir(null) }
  }

  function handleExport() {
    const header = cols
    const data = rows.map((f) => cols.map((c) => formatVal(f.properties?.[c])))
    downloadCsv([header, ...data], `traits-${traitRecordId ?? "export"}.csv`)
  }

  if (!traitRecordId) {
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

  if (isError || !geoData) return <p className="text-sm text-destructive">Failed to load data.</p>

  return (
    <div className="flex flex-col h-full gap-2">
      <div className="flex items-center gap-2 flex-shrink-0">
        <Input
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-7 text-xs"
        />
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
                  className="text-xs cursor-pointer select-none whitespace-nowrap"
                  onClick={() => toggleSort(col)}
                >
                  <span className="flex items-center gap-1">
                    {col.replace(/_/g, " ")}
                    <ArrowUpDown className="w-3 h-3 opacity-40" />
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((f, i) => (
              <TableRow key={i}>
                {cols.map((col) => (
                  <TableCell key={col} className="text-xs py-1.5 whitespace-nowrap">
                    {formatVal(f.properties?.[col])}
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
