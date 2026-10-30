/**
 * FieldMapPanel — a field map beside the boundary editor, for reference while
 * placing plots: how many plots each row and column holds, and where the
 * borders and gaps are (the numbers to give "Border rows / columns").
 *
 *   - This design: the loaded field design laid out by its rows and columns,
 *     each plot's number (and accession on hover); empty positions are gaps.
 *   - A field map sheet: any sheet (.xlsx / .csv) opened just to look at, as
 *     the field map was drawn; border cells (B, border, filler…) are shaded.
 *     It changes nothing (to make a design from it: "From a field map sheet").
 */
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  BORDER,
  readSheets,
} from "@/features/process/components/FieldMapPicker"
import {
  designExtent,
  type FieldDesign,
  rowColOf,
} from "@/features/process/lib/fieldDesign"

const MAX_ROWS = 150
const MAX_COLS = 90

/** The design as a grid of its rows and columns: [row][col] → label or null. */
export function designGrid(fd: FieldDesign): {
  rows: number[]
  cols: number[]
  cell: (r: number, c: number) => { plot: string; title: string } | null
  plots: number
  gaps: number
} {
  const e = designExtent(fd)
  const at = new Map<string, { plot: string; title: string }>()
  const m = fd.mapping
  for (const row of fd.rows) {
    const rc = rowColOf(row, m)
    if (!rc) continue
    const plot = m.plot ? String(row[m.plot] ?? "") : ""
    const acc = m.accession ? String(row[m.accession] ?? "") : ""
    const crop = m.crop ? String(row[m.crop] ?? "") : ""
    at.set(`${rc.r},${rc.c}`, {
      plot: plot || "•",
      title: [`row ${rc.r}, col ${rc.c}`, plot && `plot ${plot}`, acc, crop]
        .filter(Boolean)
        .join(" · "),
    })
  }
  const rows: number[] = []
  const cols: number[] = []
  for (let r = e.minR; r <= Math.min(e.maxR, e.minR + MAX_ROWS - 1); r += 1)
    rows.push(r)
  for (let c = e.minC; c <= Math.min(e.maxC, e.minC + MAX_COLS - 1); c += 1)
    cols.push(c)
  return {
    rows,
    cols,
    cell: (r, c) => at.get(`${r},${c}`) ?? null,
    plots: at.size,
    gaps: rows.length * cols.length - at.size,
  }
}

function DesignView({ fd }: { fd: FieldDesign }) {
  const g = useMemo(() => designGrid(fd), [fd])
  return (
    <div className="space-y-1.5" data-testid="field-map-design">
      <p className="text-muted-foreground text-xs">
        {g.plots} plots in {g.rows.length} rows × {g.cols.length} columns
        {g.gaps ? `, ${g.gaps} empty positions (gaps or borders)` : ""}, as
        numbered in the design{fd.source ? ` (${fd.source})` : ""}. Hover a plot
        for its accession.
      </p>
      <div className="max-h-80 overflow-auto rounded border">
        <table className="border-collapse text-[10px] leading-none">
          <thead>
            <tr>
              <th className="bg-muted sticky top-0 left-0 z-10 px-1 py-0.5">
                row / col
              </th>
              {g.cols.map((c) => (
                <th
                  key={c}
                  className="bg-muted sticky top-0 px-1 py-0.5 font-normal"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {g.rows.map((r) => (
              <tr key={r}>
                <th className="bg-muted sticky left-0 px-1 py-0.5 font-normal">
                  {r}
                </th>
                {g.cols.map((c) => {
                  const v = g.cell(r, c)
                  return (
                    <td
                      key={c}
                      title={
                        v?.title ??
                        `row ${r}, col ${c}: no plot (gap or border)`
                      }
                      className={`border px-1 py-0.5 text-center ${v ? "" : "bg-muted/60 text-muted-foreground"}`}
                    >
                      {v ? v.plot : "–"}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SheetView() {
  const [sheets, setSheets] = useState<Record<string, string[][]> | null>(null)
  const [name, setName] = useState<string>("")
  const [file, setFile] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  const grid = sheets && name ? sheets[name] : null
  const shown = (grid ?? []).slice(0, MAX_ROWS).map((r) => r.slice(0, MAX_COLS))
  const borders = shown.flat().filter((v) => BORDER.test(v)).length
  return (
    <div className="space-y-1.5" data-testid="field-map-sheet">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs">
          <span className="sr-only">Field map sheet</span>
          <input
            type="file"
            accept=".xlsx,.xls,.xlsm,.csv"
            className="text-xs"
            data-testid="field-map-sheet-file"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (!f) return
              setError(null)
              try {
                const got = await readSheets(f)
                setSheets(got)
                setFile(f.name)
                setName(Object.keys(got)[0] ?? "")
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err))
              }
            }}
          />
        </label>
        {sheets && Object.keys(sheets).length > 1 && (
          <Select value={name} onValueChange={setName}>
            <SelectTrigger className="h-7 w-48 text-xs">
              <SelectValue placeholder="Sheet" />
            </SelectTrigger>
            <SelectContent>
              {Object.keys(sheets).map((n) => (
                <SelectItem key={n} value={n}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {error && <p className="text-destructive text-xs">{error}</p>}
      {!grid ? (
        <p className="text-muted-foreground text-xs">
          Open the field map (a sheet laid out as the plots lie in the field) to
          look at while placing plots. It is for reference only and changes
          nothing.
        </p>
      ) : (
        <>
          <p className="text-muted-foreground text-xs">
            {file}
            {name ? ` · ${name}` : ""}
            {borders ? ` · ${borders} border cells (shaded)` : ""}
          </p>
          <div className="max-h-80 overflow-auto rounded border">
            <table className="border-collapse text-[10px] leading-none">
              <tbody>
                {shown.map((row, i) => (
                  <tr key={i}>
                    {row.map((v, j) => (
                      <td
                        key={j}
                        className={`border px-1 py-0.5 text-center ${BORDER.test(v) ? "bg-amber-100 dark:bg-amber-900/40" : ""}`}
                      >
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

export function FieldMapPanel({
  fieldDesign,
}: {
  fieldDesign: FieldDesign | null
}) {
  const [view, setView] = useState<"design" | "sheet">(
    fieldDesign ? "design" : "sheet",
  )
  return (
    <div className="space-y-2" data-testid="field-map-panel">
      <div className="flex gap-1">
        <Button
          size="sm"
          variant={view === "design" ? "default" : "outline"}
          className="h-7 text-xs"
          disabled={!fieldDesign}
          onClick={() => setView("design")}
        >
          This design
        </Button>
        <Button
          size="sm"
          variant={view === "sheet" ? "default" : "outline"}
          className="h-7 text-xs"
          onClick={() => setView("sheet")}
        >
          A field map sheet
        </Button>
      </div>
      {view === "design" && fieldDesign ? (
        <DesignView fd={fieldDesign} />
      ) : (
        <SheetView />
      )}
    </div>
  )
}
