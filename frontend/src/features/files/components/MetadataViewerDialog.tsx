/**
 * MetadataViewerDialog — look inside an upload's GPS metadata CSV
 * (`msgs_synced.csv` from Amiga extraction, `drone_msgs.csv` from
 * ArduPilot logs, or any other CSV): a filterable table, a lat/lon
 * scatter of the track, a time series of any numeric column, and — when
 * the file has `direction_raw` / `direction` — raw vs. smoothed heading.
 *
 * Ported from main (PR #153). Main fetched `/api/v1/files/{id}/metadata-csvs`
 * (server-side pandas); here the CSV is read straight from MinIO and parsed
 * in the browser, so no backend route is needed.
 */
import { useQuery } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { apiUrl, DEFAULT_BUCKET } from "@/features/files/lib/download"
import { parseCSV } from "@/features/process/lib/csv"
import { getToken } from "@/lib/auth"

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CsvFile {
  label: string
  columns: string[]
  rows: Record<string, string | number | null>[]
}

/** Parse CSV text into columns + rows, numbers as numbers, blanks as null. */
export function toCsvFile(text: string, label: string): CsvFile {
  const { headers, rows } = parseCSV(text)
  return {
    label,
    columns: headers,
    rows: rows.map((r) => {
      const out: Record<string, string | number | null> = {}
      for (const h of headers) {
        const v = (r[h] ?? "").trim()
        if (v === "") out[h] = null
        else {
          const n = Number(v)
          out[h] = Number.isFinite(n) ? n : v
        }
      }
      return out
    }),
  }
}

/** CSVs worth opening in the viewer rather than just downloading. */
export function isViewableCsv(objectName: string): boolean {
  return /\.csv$/i.test(objectName)
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const LAT_COLS = new Set(["lat", "latitude"])
const LON_COLS = new Set(["lon", "lng", "longitude"])
const TIME_COLS = new Set(["timestamp", "stamp", "gps_time", "time"])
const SKIP_COLS = new Set([
  "heading_motion",
  "image_path",
  "rgb_file",
  "/top/rgb_file",
  "disparity_file",
  "/top/disparity_file",
])

function isNumeric(col: string, rows: CsvFile["rows"]): boolean {
  return rows.some((r) => r[col] != null && typeof r[col] === "number")
}

function tickFormatter(val: number): string {
  if (Math.abs(val) >= 1e6) return val.toExponential(2)
  if (Number.isInteger(val)) return String(val)
  return Number(val.toFixed(4)).toString()
}

// ── Table tab ──────────────────────────────────────────────────────────────────

function TableView({ file }: { file: CsvFile }) {
  const [search, setSearch] = useState("")
  const [colFilters, setColFilters] = useState<Record<string, string>>({})

  const displayCols = file.columns.filter((c) => !SKIP_COLS.has(c))

  const filtered = useMemo(() => {
    return file.rows.filter((row) => {
      for (const [col, val] of Object.entries(colFilters)) {
        if (!val) continue
        const cell = String(row[col] ?? "").toLowerCase()
        if (!cell.includes(val.toLowerCase())) return false
      }
      if (search) {
        const q = search.toLowerCase()
        return displayCols.some((c) =>
          String(row[c] ?? "")
            .toLowerCase()
            .includes(q),
        )
      }
      return true
    })
  }, [file.rows, colFilters, search, displayCols])

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      <div className="flex items-center gap-2 shrink-0">
        <input
          placeholder="Search all columns…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border-input bg-background text-foreground placeholder:text-muted-foreground h-8 rounded-md border px-3 text-xs w-56"
        />
        <span className="text-xs text-muted-foreground">
          {filtered.length} rows
        </span>
      </div>
      <div className="overflow-auto flex-1 min-h-0 border rounded-md">
        <table className="w-full text-xs">
          <thead className="bg-muted/60 sticky top-0 z-10">
            <tr>
              {displayCols.map((col) => (
                <th
                  key={col}
                  className="px-2 py-1.5 text-left font-medium text-muted-foreground whitespace-nowrap"
                >
                  <div className="flex flex-col gap-0.5">
                    <span>{col}</span>
                    <input
                      placeholder="filter…"
                      value={colFilters[col] ?? ""}
                      onChange={(e) =>
                        setColFilters((prev) => ({
                          ...prev,
                          [col]: e.target.value,
                        }))
                      }
                      className="bg-background border-input h-5 w-full rounded border px-1 text-[10px] font-normal"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 2000).map((row, i) => (
              <tr key={i} className="border-t hover:bg-muted/30">
                {displayCols.map((col) => {
                  const val = row[col]
                  return (
                    <td
                      key={col}
                      className="px-2 py-1 text-muted-foreground whitespace-nowrap tabular-nums"
                    >
                      {val == null ? (
                        <span className="opacity-30">—</span>
                      ) : (
                        String(val)
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 2000 && (
          <p className="text-center text-xs text-muted-foreground py-2">
            Showing first 2000 of {filtered.length} rows
          </p>
        )}
      </div>
    </div>
  )
}

// ── Lat/Lon tab ────────────────────────────────────────────────────────────────

function LatLonView({ file }: { file: CsvFile }) {
  const latCol = file.columns.find((c) => LAT_COLS.has(c.toLowerCase()))
  const lonCol = file.columns.find((c) => LON_COLS.has(c.toLowerCase()))

  const points = useMemo(() => {
    if (!latCol || !lonCol) return []
    return file.rows
      .map((r) => ({ x: Number(r[lonCol]), y: Number(r[latCol]) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
  }, [file.rows, latCol, lonCol])

  if (!latCol || !lonCol) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        No lat/lon columns found in this file.
      </div>
    )
  }

  if (points.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        No valid lat/lon data.
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col gap-2">
      <p className="text-xs text-muted-foreground shrink-0">
        {points.length} points — X: {lonCol}, Y: {latCol}
      </p>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 16 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              type="number"
              dataKey="x"
              name={lonCol}
              domain={["auto", "auto"]}
              tickFormatter={(v) => v.toFixed(5)}
              tick={{ fontSize: 10 }}
              label={{
                value: "Longitude",
                position: "insideBottom",
                offset: -2,
                fontSize: 11,
              }}
            />
            <YAxis
              type="number"
              dataKey="y"
              name={latCol}
              domain={["auto", "auto"]}
              tickFormatter={(v) => v.toFixed(5)}
              tick={{ fontSize: 10 }}
              width={80}
              label={{
                value: "Latitude",
                angle: -90,
                position: "insideLeft",
                fontSize: 11,
              }}
            />
            <ZAxis range={[8, 8]} />
            <Tooltip
              cursor={false}
              formatter={(value: unknown) => [(value as number).toFixed(6)]}
            />
            <Scatter
              data={points}
              fill="#3b82f6"
              opacity={0.7}
              onClick={() => {}}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── Time Series tab ────────────────────────────────────────────────────────────

function TimeSeriesView({ file }: { file: CsvFile }) {
  const numericCols = useMemo(
    () =>
      file.columns.filter((c) => !SKIP_COLS.has(c) && isNumeric(c, file.rows)),
    [file],
  )

  const timeCol = file.columns.find((c) => TIME_COLS.has(c.toLowerCase()))
  const [selectedCol, setSelectedCol] = useState<string>(numericCols[0] ?? "")

  useEffect(() => {
    if (numericCols.length > 0 && !numericCols.includes(selectedCol)) {
      setSelectedCol(numericCols[0])
    }
  }, [numericCols, selectedCol])

  const chartData = useMemo(() => {
    return file.rows
      .map((r, i) => {
        const t = timeCol ? Number(r[timeCol]) : i
        const v = selectedCol ? r[selectedCol] : null
        return {
          t: Number.isFinite(t) ? t : i,
          v: v != null ? Number(v) : null,
        }
      })
      .filter((d) => d.v != null && Number.isFinite(d.v as number))
  }, [file.rows, timeCol, selectedCol])

  if (numericCols.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        No numeric columns found in this file.
      </div>
    )
  }

  const xLabel = timeCol ?? "Row index"

  return (
    <div className="h-full flex flex-col gap-3">
      <div className="shrink-0 flex items-center gap-3">
        <span className="text-xs text-muted-foreground">Column:</span>
        <Select value={selectedCol} onValueChange={setSelectedCol}>
          <SelectTrigger className="h-7 w-52 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {numericCols.map((c) => (
              <SelectItem key={c} value={c} className="text-xs">
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {chartData.length} points
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 16 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              type="number"
              dataKey="t"
              name={xLabel}
              domain={["auto", "auto"]}
              tickFormatter={tickFormatter}
              tick={{ fontSize: 10 }}
              label={{
                value: xLabel,
                position: "insideBottom",
                offset: -12,
                fontSize: 11,
              }}
            />
            <YAxis
              type="number"
              dataKey="v"
              name={selectedCol}
              tickFormatter={tickFormatter}
              tick={{ fontSize: 10 }}
              width={72}
              label={{
                value: selectedCol,
                angle: -90,
                position: "insideLeft",
                fontSize: 11,
              }}
            />
            <ZAxis range={[16, 16]} />
            <Tooltip
              cursor={false}
              formatter={(value: unknown) => [
                (value as number)?.toFixed
                  ? (value as number).toFixed(6)
                  : String(value),
              ]}
              labelFormatter={(l) => `${xLabel}: ${tickFormatter(Number(l))}`}
            />
            <Scatter
              data={chartData}
              fill="#3b82f6"
              opacity={0.7}
              onClick={() => {}}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── Smoothing tab ──────────────────────────────────────────────────────────────

const DIR_TO_DEG: Record<string, number> = {
  North: 0,
  East: 90,
  South: 180,
  West: 270,
}
const DIR_ORDER = ["North", "East", "South", "West"]

function SmoothedDirectionView({ file }: { file: CsvFile }) {
  const hasRaw = file.columns.includes("direction_raw")
  const hasSmoothed = file.columns.includes("direction")

  const timeCol = file.columns.find((c) => TIME_COLS.has(c.toLowerCase()))

  const { rawData, smoothedData } = useMemo(() => {
    const raw: { t: number; v: number }[] = []
    const smoothed: { t: number; v: number }[] = []
    file.rows.forEach((r, i) => {
      const t = timeCol ? Number(r[timeCol]) : i
      const x = Number.isFinite(t) ? t : i
      const rawDir = r.direction_raw
      const smDir = r.direction
      if (hasRaw && rawDir != null && DIR_TO_DEG[String(rawDir)] != null)
        raw.push({ t: x, v: DIR_TO_DEG[String(rawDir)] })
      if (hasSmoothed && smDir != null && DIR_TO_DEG[String(smDir)] != null)
        smoothed.push({ t: x, v: DIR_TO_DEG[String(smDir)] })
    })
    return { rawData: raw, smoothedData: smoothed }
  }, [file.rows, timeCol, hasRaw, hasSmoothed])

  if (!hasRaw && !hasSmoothed) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        No direction columns found. Re-process data to generate smoothing data.
      </div>
    )
  }

  const xLabel = timeCol ?? "Row index"

  return (
    <div className="h-full flex flex-col gap-3">
      <div className="shrink-0 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: "#94a3b8" }}
          />
          Raw (per-frame)
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: "#3b82f6" }}
          />
          Smoothed
        </span>
        <span className="ml-auto">
          {rawData.length} raw · {smoothedData.length} smoothed frames
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 16 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              type="number"
              dataKey="t"
              domain={["auto", "auto"]}
              tickFormatter={tickFormatter}
              tick={{ fontSize: 10 }}
              label={{
                value: xLabel,
                position: "insideBottom",
                offset: -12,
                fontSize: 11,
              }}
            />
            <YAxis
              type="number"
              dataKey="v"
              domain={[-10, 280]}
              ticks={[0, 90, 180, 270]}
              tickFormatter={(v: number) => DIR_ORDER[v / 90] ?? String(v)}
              tick={{ fontSize: 10 }}
              width={52}
            />
            <ZAxis range={[10, 10]} />
            <Tooltip
              cursor={false}
              formatter={(value: unknown) => {
                const deg = value as number
                return [DIR_ORDER[deg / 90] ?? String(deg)]
              }}
              labelFormatter={(l) => `${xLabel}: ${tickFormatter(Number(l))}`}
            />
            {hasRaw && (
              <Scatter
                name="Raw"
                data={rawData}
                fill="#94a3b8"
                opacity={0.45}
                onClick={() => {}}
              />
            )}
            {hasSmoothed && (
              <Scatter
                name="Smoothed"
                data={smoothedData}
                fill="#3b82f6"
                opacity={0.75}
                onClick={() => {}}
              />
            )}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── Main dialog ────────────────────────────────────────────────────────────────

type ViewTab = "table" | "latlon" | "timeseries" | "smoothing"

export function MetadataViewerDialog({
  objectPath,
  onClose,
}: {
  /** MinIO object path of the CSV (no bucket). null = closed. */
  objectPath: string | null
  onClose: () => void
}) {
  const [activeTab, setActiveTab] = useState<ViewTab>("table")
  const label = objectPath?.split("/").pop() ?? ""

  const csv = useQuery({
    queryKey: ["files", "metadata-csv", objectPath],
    queryFn: async (): Promise<CsvFile> => {
      const res = await fetch(
        apiUrl(`/api/files/download/${DEFAULT_BUCKET}/${objectPath}`),
        { headers: { Authorization: `Bearer ${getToken()}` } },
      )
      if (!res.ok) throw new Error(`Couldn't read ${label}: HTTP ${res.status}`)
      return toCsvFile(await res.text(), label)
    },
    enabled: Boolean(objectPath),
    staleTime: 60_000,
  })
  const file = csv.data

  const hasDirectionData = file
    ? file.columns.includes("direction_raw") ||
      file.columns.includes("direction")
    : false

  useEffect(() => {
    if (activeTab === "smoothing" && !hasDirectionData) setActiveTab("table")
  }, [activeTab, hasDirectionData])

  const TAB_LABELS: { id: ViewTab; label: string }[] = [
    { id: "table", label: "Table" },
    { id: "latlon", label: "Lat / Lon" },
    { id: "timeseries", label: "Time Series" },
    ...(hasDirectionData
      ? [{ id: "smoothing" as ViewTab, label: "Smoothing" }]
      : []),
  ]

  return (
    <Dialog open={objectPath !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="flex h-[90vh] w-[92vw] max-w-6xl flex-col sm:max-w-6xl"
        data-testid="metadata-viewer"
      >
        <DialogHeader className="flex-row items-center justify-between gap-4 space-y-0">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-sm">{label}</DialogTitle>
            <DialogDescription className="text-xs">
              {file
                ? `${file.columns.length} columns · ${file.rows.length} rows`
                : "GPS / metadata CSV"}
            </DialogDescription>
          </div>
          <div className="flex overflow-hidden rounded-md border text-xs">
            {TAB_LABELS.map(({ id, label: tabLabel }) => (
              <button
                type="button"
                key={id}
                onClick={() => setActiveTab(id)}
                data-testid={`metadata-tab-${id}`}
                className={`px-3 py-1.5 transition-colors ${
                  activeTab === id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {tabLabel}
              </button>
            ))}
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden">
          {csv.isLoading && (
            <div className="flex h-full items-center justify-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          )}
          {csv.isError && (
            <div className="flex h-full items-center justify-center text-destructive text-sm">
              {(csv.error as Error).message}
            </div>
          )}
          {file && file.rows.length === 0 && (
            <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
              This CSV has no rows.
            </div>
          )}
          {file && file.rows.length > 0 && (
            <>
              {activeTab === "table" && <TableView file={file} />}
              {activeTab === "latlon" && <LatLonView file={file} />}
              {activeTab === "timeseries" && <TimeSeriesView file={file} />}
              {activeTab === "smoothing" && (
                <SmoothedDirectionView file={file} />
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
