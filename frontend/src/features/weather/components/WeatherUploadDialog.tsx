/**
 * Weather data → one tidy file per station. The person says what each
 * column is (as for a field design), which temperature unit it holds, and
 * how finely to keep it; the files (one per day, say) are joined in time
 * order and saved under the site's Weather folder (lib/weather.ts).
 */
import { Loader2, Save } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { uploadFileChunked } from "@/lib/chunkedUpload"
import {
  type ColumnSetup,
  guessRole,
  isTemperatureRole,
  mainSpan,
  outName,
  type ParsedTable,
  parseTable,
  parseTime,
  ROLES,
  type Role,
  type StationMeta,
  stationFile,
  type TempUnit,
  tempUnitOf,
  tidy,
  toCsv,
  weatherFolder,
} from "../lib/weather"

/** Roles one station has one of: a second guess of these is left out. */
const SINGLE: Role[] = [
  "time",
  "air_temp",
  "rh",
  "vpd",
  "solar",
  "par",
  "wind_speed",
  "wind_dir",
  "rain",
]

const INTERVALS = [
  { m: 0, label: "As recorded" },
  { m: 1, label: "1-minute means" },
  { m: 5, label: "5-minute means" },
  { m: 15, label: "15-minute means" },
  { m: 60, label: "Hourly means" },
]

export function WeatherUploadDialog({
  open,
  files,
  scope,
  onClose,
}: {
  open: boolean
  files: File[]
  scope: { experiment?: string; season?: string; location?: string }
  onClose: () => void
}) {
  const [tables, setTables] = useState<ParsedTable[]>([])
  const [headerRow, setHeaderRow] = useState(0)
  const [setup, setSetup] = useState<ColumnSetup[]>([])
  const [station, setStation] = useState("")
  const [treatment, setTreatment] = useState("")
  const [minutes, setMinutes] = useState(1)
  const [saving, setSaving] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)

  // Read every file (in name order: daily files sort by date).
  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name))
        const texts = await Promise.all(sorted.map((f) => f.text()))
        if (!live) return
        const parsed = texts.map((t) => parseTable(t, headerRow))
        setTables(parsed)
        const first = parsed[0]
        if (!first) return
        const seen = new Set<Role>()
        setSetup(
          first.names.map((name, i) => {
            let role = guessRole(name, first.units[i])
            if (SINGLE.includes(role) && seen.has(role)) role = "skip"
            seen.add(role)
            return {
              name,
              role,
              fileUnit: first.units[i] || undefined,
              unit: tempUnitOf(first.units[i] ?? "") ?? "C",
            }
          }),
        )
        // A station name from the logger line (station, table).
        const logger = first.logger
        if (logger)
          setStation(
            (cur) =>
              cur || `Station ${logger[1] ?? ""} ${logger[7] ?? ""}`.trim(),
          )
        // Fine logger records (seconds apart): keep 1-minute means.
        const times = first.rows.slice(0, 3).map((r) => r[0])
        setMinutes(
          times.length > 1 && times[0].slice(0, 16) === times[1].slice(0, 16)
            ? 1
            : 0,
        )
        setReadError(null)
      } catch (e) {
        setReadError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      live = false
    }
  }, [files, headerRow])

  const mismatched = tables.filter(
    (t) => t.names.join("|") !== tables[0]?.names.join("|"),
  ).length
  // The dates to keep: by default the span holding the data, without stray
  // dates from a logger clock reset.
  const span = useMemo(() => {
    const ti = setup.find((c) => c.role === "time")
    if (!ti) return { from: "", to: "", outside: [] as string[] }
    const times: string[] = []
    for (const t of tables) {
      const i = t.names.indexOf(ti.name)
      if (i < 0) continue
      for (const r of t.rows) {
        const v = parseTime(r[i] ?? "")
        if (v) times.push(v)
      }
    }
    return mainSpan(times)
  }, [tables, setup])
  const [keepFrom, setKeepFrom] = useState("")
  const [keepTo, setKeepTo] = useState("")
  useEffect(() => {
    setKeepFrom(span.from)
    setKeepTo(span.to)
  }, [span.from, span.to])
  const result = useMemo(
    () =>
      tables.length && setup.length
        ? tidy(tables, setup, minutes, { from: keepFrom, to: keepTo })
        : null,
    [tables, setup, minutes, keepFrom, keepTo],
  )
  const hasTime = setup.some((c) => c.role === "time")
  const sample = (i: number) =>
    tables[0]?.rows
      .slice(0, 3)
      .map((r) => r[i])
      .join(", ") ?? ""

  const save = async () => {
    if (!result || !scope.experiment || !scope.season || !scope.location) return
    setSaving(true)
    try {
      const folder = weatherFolder({
        year: scope.season,
        experiment: scope.experiment,
        site: scope.location,
      })
      const base = folder + stationFile(station)
      const csv = toCsv(result.columns, result.rows)
      const kept = setup.filter((c) => c.role !== "skip" && c.role !== "time")
      const meta: StationMeta = {
        station: station.trim(),
        treatment: treatment.trim() || undefined,
        columns: result.columns,
        describe: Object.fromEntries(
          kept.map((c) => [
            outName(c, setup),
            {
              role: c.role,
              source: c.name,
              unit: isTemperatureRole(c.role) ? "°C" : (c.fileUnit ?? ""),
            },
          ]),
        ),
        interval_minutes: minutes,
        first: result.rows[0]?.time ?? "",
        last: result.rows.at(-1)?.time ?? "",
        rows: result.rows.length,
        files: files.map((f) => f.name),
        clock: "the logger's clock, as recorded",
        uploaded: new Date().toISOString(),
      }
      for (const [path, body, type] of [
        [`${base}.csv`, csv, "text/csv"],
        [`${base}.json`, JSON.stringify(meta, null, 1), "application/json"],
      ] as const) {
        const blob = new Blob([body], { type })
        await uploadFileChunked({
          file: new File([blob], path.split("/").pop() ?? "weather", { type }),
          fileIdentifier: `${path}-${blob.size}-${Date.now()}`,
          objectName: path,
        })
      }
      toast.success(
        `Saved ${result.rows.length.toLocaleString()} rows for ${station} (Analyze → Weather).`,
      )
      onClose()
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Could not save the weather data",
      )
    } finally {
      setSaving(false)
    }
  }

  const csvFiles = tables.some((t) => t.format === "csv")

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="max-h-[90svh] overflow-y-auto sm:max-w-4xl"
        data-testid="weather-dialog"
      >
        <DialogHeader>
          <DialogTitle>Weather data: what each column is</DialogTitle>
          <DialogDescription>
            {files.length} file{files.length === 1 ? "" : "s"} for{" "}
            {[scope.experiment, scope.season, scope.location]
              .filter(Boolean)
              .join(" · ") || "— pick the experiment, season and site first"}
            . Files are joined in time order; temperatures are saved in °C.
          </DialogDescription>
        </DialogHeader>

        {readError && <p className="text-destructive text-sm">{readError}</p>}
        {mismatched > 0 && (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            {mismatched} file{mismatched === 1 ? " has" : "s have"} different
            columns from the first: only columns with the same names are read
            from {mismatched === 1 ? "it" : "them"}. Upload different loggers or
            tables (ambient vs soil) separately.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="wx-station" className="text-xs">
              Station name
            </Label>
            <Input
              id="wx-station"
              value={station}
              onChange={(e) => setStation(e.target.value)}
              placeholder="Station 1 (well-watered)"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wx-treatment" className="text-xs">
              Stands for (optional)
            </Label>
            <Input
              id="wx-treatment"
              value={treatment}
              onChange={(e) => setTreatment(e.target.value)}
              placeholder="well-watered / drought"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wx-interval" className="text-xs">
              Keep
            </Label>
            <select
              id="wx-interval"
              className="bg-background h-9 w-full rounded-md border px-2 text-sm"
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
            >
              {INTERVALS.map((i) => (
                <option key={i.m} value={i.m}>
                  {i.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Keep dates</Label>
            <span className="flex items-center gap-1">
              <Input
                type="date"
                className="h-9"
                value={keepFrom}
                onChange={(e) => setKeepFrom(e.target.value)}
                aria-label="Keep from"
              />
              –
              <Input
                type="date"
                className="h-9"
                value={keepTo}
                onChange={(e) => setKeepTo(e.target.value)}
                aria-label="Keep to"
              />
            </span>
          </div>
          {csvFiles && (
            <div className="space-y-1">
              <Label htmlFor="wx-header" className="text-xs">
                Column names are on line
              </Label>
              <Input
                id="wx-header"
                type="number"
                min={1}
                value={headerRow + 1}
                onChange={(e) =>
                  setHeaderRow(Math.max(0, Number(e.target.value) - 1))
                }
              />
            </div>
          )}
        </div>

        <div className="max-h-[42svh] overflow-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted sticky top-0">
              <tr>
                <th className="px-2 py-1.5 text-left">Column</th>
                <th className="px-2 py-1.5 text-left">First values</th>
                <th className="px-2 py-1.5 text-left">Is</th>
                <th className="px-2 py-1.5 text-left">Unit</th>
              </tr>
            </thead>
            <tbody>
              {setup.map((c, i) => (
                <tr
                  key={c.name}
                  className={`border-t ${c.role === "skip" ? "text-muted-foreground" : ""}`}
                >
                  <td className="px-2 py-1 font-mono">
                    {c.name}
                    {c.fileUnit && (
                      <span className="text-muted-foreground ml-1">
                        ({c.fileUnit})
                      </span>
                    )}
                  </td>
                  <td
                    className="max-w-48 truncate px-2 py-1 font-mono"
                    title={sample(i)}
                  >
                    {sample(i)}
                  </td>
                  <td className="px-2 py-1">
                    <select
                      className="bg-background h-7 rounded border px-1"
                      value={c.role}
                      onChange={(e) =>
                        setSetup((s) =>
                          s.map((x, k) =>
                            k === i
                              ? { ...x, role: e.target.value as Role }
                              : x,
                          ),
                        )
                      }
                      aria-label={`What ${c.name} is`}
                      data-testid={`wx-role-${c.name}`}
                    >
                      {ROLES.map((r) => (
                        <option key={r.role} value={r.role}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    {isTemperatureRole(c.role) ? (
                      <select
                        className="bg-background h-7 rounded border px-1"
                        value={c.unit ?? "C"}
                        onChange={(e) =>
                          setSetup((s) =>
                            s.map((x, k) =>
                              k === i
                                ? { ...x, unit: e.target.value as TempUnit }
                                : x,
                            ),
                          )
                        }
                        aria-label={`${c.name} unit`}
                      >
                        <option value="C">°C</option>
                        <option value="F">°F → °C</option>
                        <option value="K">K → °C</option>
                      </select>
                    ) : (
                      <span className="text-muted-foreground">
                        {c.fileUnit ?? ""}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {result && (
          <p className="text-muted-foreground text-xs" data-testid="wx-summary">
            {hasTime ? (
              <>
                {result.rows.length.toLocaleString()} rows,{" "}
                {result.rows[0]?.time} → {result.rows.at(-1)?.time} · columns:{" "}
                {result.columns.join(", ") || "none"}
                {result.skipped > 0 &&
                  ` · ${result.skipped} rows without a readable time left out`}
                {result.outside > 0 &&
                  ` · ${result.outside.toLocaleString()} rows outside the dates kept left out${
                    span.outside.length
                      ? ` (stray dates ${span.outside.slice(0, 3).join(", ")}: likely a logger clock reset)`
                      : ""
                  }`}
                {result.rows[0] &&
                  result.columns.includes("air_temp_c") &&
                  ` · first air temperature ${result.rows[0].values.air_temp_c} °C`}
              </>
            ) : (
              "Pick which column is the date & time."
            )}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            disabled={
              saving ||
              !hasTime ||
              !result?.rows.length ||
              !station.trim() ||
              !scope.experiment ||
              !scope.season ||
              !scope.location
            }
            data-testid="wx-save"
          >
            {saving ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Save className="mr-1.5 size-4" />
            )}
            Save station data
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
