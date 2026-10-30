/**
 * FieldMapPicker — a field design from a drawn field map: a sheet with the
 * plot numbers laid out as the plots lie in the field. The person clicks the
 * cell of the first tier and first bed, then the opposite corner; every plot
 * number inside becomes a (tier, bed, plot) row. Genotypes can come from a
 * plot list (any sheet with plot and genotype columns), joined by plot number.
 *
 * The result is a plain table for the column-mapping step: plot, row (tier),
 * col (bed), accession, crop.
 */
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type Grid = string[][]
type Cell = { r: number; c: number }

export const BORDER = /^(b|border|buffer|f|fill|filler|bf|s ?b|gap)$/i
const MAX_ROWS = 150
const MAX_COLS = 90

export async function readSheets(file: File): Promise<Record<string, Grid>> {
  const XLSX = await import("xlsx")
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" })
  const out: Record<string, Grid> = {}
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], {
      header: 1,
      raw: false,
      defval: "",
    })
    out[name] = rows.map((r) => r.map((v) => String(v ?? "").trim()))
  }
  return out
}

/** Column letters, as the sheet shows them (A, B, …, AA). */
function colName(i: number): string {
  let s = ""
  let n = i + 1
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

export interface MapPlot {
  plot: string
  row: number
  col: number
}

/** The plots inside the rectangle from `a` (first tier, first bed) to `b`. */
export function plotsFromMap(
  grid: Grid,
  a: Cell,
  b: Cell,
  firstTier: number,
  firstBed: number,
  tiersDown: boolean,
): MapPlot[] {
  const out: MapPlot[] = []
  const dr = b.r >= a.r ? 1 : -1
  const dc = b.c >= a.c ? 1 : -1
  for (let i = 0; i <= Math.abs(b.r - a.r); i++) {
    for (let j = 0; j <= Math.abs(b.c - a.c); j++) {
      const v = (grid[a.r + i * dr]?.[a.c + j * dc] ?? "").trim()
      if (!v || BORDER.test(v)) continue
      out.push({
        plot: v,
        row: firstTier + (tiersDown ? i : j),
        col: firstBed + (tiersDown ? j : i),
      })
    }
  }
  return out
}

function findCol(header: string[], names: string[]): number {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
  const h = header.map(norm)
  for (const n of names) {
    const i = h.indexOf(n)
    if (i >= 0) return i
  }
  for (const n of names) {
    const i = h.findIndex((x) => x.includes(n))
    if (i >= 0) return i
  }
  return -1
}

/** plot → {accession, crop} from a plot list (header in its first rows). */
async function genotypesFrom(
  file: File,
): Promise<Map<string, { accession: string; crop: string }>> {
  const sheets = await readSheets(file)
  const out = new Map<string, { accession: string; crop: string }>()
  for (const grid of Object.values(sheets)) {
    for (let hr = 0; hr < Math.min(10, grid.length); hr++) {
      const header = grid[hr]
      const ip = findCol(header, [
        "field plot number",
        "plot number",
        "plot id",
        "plotno",
        "plot",
      ])
      const ig = findCol(header, [
        "genotype",
        "accession",
        "entry",
        "line id",
        "variety",
        "line",
      ])
      if (ip < 0 || ig < 0) continue
      const ic = findCol(header, ["crop", "population", "species"])
      for (const r of grid.slice(hr + 1)) {
        const p = (r[ip] ?? "").trim()
        if (p)
          out.set(p, {
            accession: (r[ig] ?? "").trim(),
            crop: ic >= 0 ? (r[ic] ?? "").trim() : "",
          })
      }
      if (out.size) return out
    }
  }
  return out
}

function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function FieldMapPicker({
  onDone,
  onCancel,
}: {
  /** The plots as CSV text (plot,row,col,accession,crop). */
  onDone: (csv: string, note: string) => void
  onCancel: () => void
}) {
  const [sheets, setSheets] = useState<Record<string, Grid> | null>(null)
  const [sheet, setSheet] = useState("")
  const [a, setA] = useState<Cell | null>(null)
  const [b, setB] = useState<Cell | null>(null)
  const [firstTier, setFirstTier] = useState(1)
  const [firstBed, setFirstBed] = useState(1)
  const [tiersDown, setTiersDown] = useState(true)
  const [genos, setGenos] = useState<Map<
    string,
    { accession: string; crop: string }
  > | null>(null)
  const [genoName, setGenoName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const grid = sheets?.[sheet] ?? []
  const plots = useMemo(
    () =>
      a && b ? plotsFromMap(grid, a, b, firstTier, firstBed, tiersDown) : [],
    [grid, a, b, firstTier, firstBed, tiersDown],
  )
  const joined = genos ? plots.filter((p) => genos.has(p.plot)).length : 0
  const inBox = (r: number, c: number) =>
    a &&
    b &&
    r >= Math.min(a.r, b.r) &&
    r <= Math.max(a.r, b.r) &&
    c >= Math.min(a.c, b.c) &&
    c <= Math.max(a.c, b.c)

  const pick = (r: number, c: number) => {
    if (!a || (a && b)) {
      setA({ r, c })
      setB(null)
    } else setB({ r, c })
  }

  const finish = () => {
    const lines = ["plot,row,col,accession,crop"]
    for (const p of plots) {
      const g = genos?.get(p.plot)
      lines.push(
        [p.plot, p.row, p.col, g?.accession ?? "", g?.crop ?? ""]
          .map(csvCell)
          .join(","),
      )
    }
    const tiers = new Set(plots.map((p) => p.row)).size
    const beds = new Set(plots.map((p) => p.col)).size
    onDone(
      lines.join("\n"),
      `${plots.length} plots from the map (${tiers} tiers × ${beds} beds)` +
        (genos ? `, ${joined} with a genotype from ${genoName}` : ""),
    )
  }

  if (!sheets)
    return (
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          A field map: a sheet with the plot numbers laid out as the plots lie
          in the field (tiers one way, beds the other). You will click its
          corners.
        </p>
        <Input
          type="file"
          accept=".xlsx,.xlsm,.xls,.csv"
          data-testid="fieldmap-file"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            try {
              const s = await readSheets(f)
              setSheets(s)
              setSheet(Object.keys(s)[0] ?? "")
              setError(null)
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err))
            }
          }}
        />
        {error && <p className="text-destructive text-xs">{error}</p>}
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Back
        </Button>
      </div>
    )

  const rows = grid.slice(0, MAX_ROWS)
  const ncols = Math.min(
    MAX_COLS,
    rows.reduce((m, r) => Math.max(m, r.length), 0),
  )
  return (
    <div className="flex min-h-0 flex-col gap-3 text-sm" data-testid="fieldmap">
      <div className="flex flex-wrap items-end gap-3">
        {Object.keys(sheets).length > 1 && (
          <div className="space-y-1">
            <Label className="text-xs">Sheet</Label>
            <Select
              value={sheet}
              onValueChange={(v) => {
                setSheet(v)
                setA(null)
                setB(null)
              }}
            >
              <SelectTrigger className="h-8 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.keys(sheets).map((n) => (
                  <SelectItem key={n} value={n}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-1">
          <Label className="text-xs">First tier</Label>
          <Input
            type="number"
            className="h-8 w-20"
            value={firstTier}
            onChange={(e) => setFirstTier(Number(e.target.value) || 1)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">First bed</Label>
          <Input
            type="number"
            className="h-8 w-20"
            value={firstBed}
            onChange={(e) => setFirstBed(Number(e.target.value) || 1)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Tiers run</Label>
          <Select
            value={tiersDown ? "down" : "across"}
            onValueChange={(v) => setTiersDown(v === "down")}
          >
            <SelectTrigger className="h-8 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="down">Down the sheet (rows)</SelectItem>
              <SelectItem value="across">Across the sheet (columns)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        {!a
          ? "Click the cell of the first tier and first bed (its plot number)."
          : !b
            ? `Corner 1: ${colName(a.c)}${a.r + 1}. Now click the opposite corner (last tier, last bed).`
            : `${colName(a.c)}${a.r + 1} → ${colName(b.c)}${b.r + 1}: ${plots.length} plots (border and empty cells skipped). Click again to start over.`}
      </p>
      <div className="max-h-[45vh] overflow-auto rounded border">
        <table className="border-collapse text-[10px]">
          <thead>
            <tr>
              <th className="bg-muted sticky top-0 left-0 z-10" />
              {Array.from({ length: ncols }, (_, c) => (
                <th
                  key={c}
                  className="bg-muted text-muted-foreground sticky top-0 px-1 font-normal"
                >
                  {colName(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                <th className="bg-muted text-muted-foreground sticky left-0 px-1 font-normal">
                  {ri + 1}
                </th>
                {Array.from({ length: ncols }, (_, ci) => {
                  const v = r[ci] ?? ""
                  const corner =
                    (a && a.r === ri && a.c === ci) ||
                    (b && b.r === ri && b.c === ci)
                  return (
                    <td
                      key={ci}
                      className={`max-w-16 border p-0 ${
                        corner
                          ? "bg-primary text-primary-foreground"
                          : inBox(ri, ci)
                            ? v && !BORDER.test(v)
                              ? "bg-primary/20"
                              : "bg-muted/60"
                            : "hover:bg-muted"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => pick(ri, ci)}
                        className="block h-full w-full min-w-6 truncate px-1 text-left"
                        title={`${colName(ci)}${ri + 1}${v ? `: ${v}` : ""}`}
                      >
                        {v || "\u00a0"}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-xs">Genotypes (optional)</Label>
        <Input
          type="file"
          accept=".xlsx,.xlsm,.xls,.csv"
          className="h-8 max-w-64"
          data-testid="fieldmap-genotypes"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            const g = await genotypesFrom(f)
            setGenos(g)
            setGenoName(f.name)
          }}
        />
        <span className="text-muted-foreground text-xs">
          {genos
            ? `${genos.size} plots in ${genoName}; ${joined} of the map's plots matched`
            : "a plot list with plot and genotype columns, joined by plot number"}
        </span>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Back
        </Button>
        <Button
          size="sm"
          disabled={plots.length === 0}
          onClick={finish}
          data-testid="fieldmap-use"
        >
          Use these {plots.length || ""} plots
        </Button>
      </div>
    </div>
  )
}
