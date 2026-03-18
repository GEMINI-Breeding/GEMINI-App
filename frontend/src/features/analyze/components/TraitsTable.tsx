import { useMemo, useState } from "react"
import { ArrowUpDown, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

interface TraitsTableProps {
  geojson: GeoJSON.FeatureCollection
}

function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.join(",")
  const lines = rows.map((r) =>
    columns.map((c) => {
      const v = r[c]
      return typeof v === "string" && v.includes(",") ? `"${v}"` : String(v ?? "")
    }).join(","),
  )
  return [header, ...lines].join("\n")
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function fmt(v: unknown): string {
  if (v == null) return ""
  if (typeof v === "number") return isNaN(v) ? "" : v.toFixed(3)
  return String(v)
}

function formatHeader(col: string): string {
  return col.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function TraitsTable({ geojson }: TraitsTableProps) {
  const [search, setSearch] = useState("")
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortAsc, setSortAsc] = useState(true)

  const rows: Record<string, unknown>[] = useMemo(
    () => geojson.features.map((f) => f.properties ?? {}),
    [geojson],
  )

  const columns: string[] = useMemo(() => {
    const keys = new Set<string>()
    rows.forEach((r) => Object.keys(r).forEach((k) => keys.add(k)))
    // plot_id and accession first
    const priority = ["plot_id", "plot", "accession"]
    const rest = [...keys].filter((k) => !priority.includes(k)).sort()
    return [...priority.filter((k) => keys.has(k)), ...rest]
  }, [rows])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return rows.filter((r) =>
      !q || Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(q)),
    )
  }, [rows, search])

  const sorted = useMemo(() => {
    if (!sortCol) return filtered
    return [...filtered].sort((a, b) => {
      const av = a[sortCol] ?? ""
      const bv = b[sortCol] ?? ""
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv))
      return sortAsc ? cmp : -cmp
    })
  }, [filtered, sortCol, sortAsc])

  function toggleSort(col: string) {
    if (sortCol === col) setSortAsc((p) => !p)
    else { setSortCol(col); setSortAsc(true) }
  }

  function handleDownload() {
    downloadCsv(toCsv(sorted, columns), "traits.csv")
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Input
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs h-8 text-sm"
        />
        <Button variant="outline" size="sm" onClick={handleDownload}>
          <Download className="w-3.5 h-3.5 mr-1.5" />
          Download CSV
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">
          {sorted.length} / {rows.length} rows
        </span>
      </div>

      <div className="rounded-md border overflow-auto max-h-[480px]">
        <Table>
          <TableHeader className="sticky top-0 bg-background z-10">
            <TableRow>
              {columns.map((col) => (
                <TableHead
                  key={col}
                  className="whitespace-nowrap cursor-pointer select-none text-xs"
                  onClick={() => toggleSort(col)}
                >
                  <span className="flex items-center gap-1">
                    {formatHeader(col)}
                    <ArrowUpDown className="w-3 h-3 opacity-50" />
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((row, i) => (
              <TableRow key={i}>
                {columns.map((col) => (
                  <TableCell key={col} className="text-xs font-mono whitespace-nowrap py-1.5 px-3">
                    {fmt(row[col])}
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
