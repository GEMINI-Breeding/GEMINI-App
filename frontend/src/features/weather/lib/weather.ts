/**
 * Weather station data: read Campbell Scientific TOA5 (.dat) and CSV files,
 * give each column a role (time, air temperature, humidity …), convert
 * temperatures to °C, average to a fixed interval and write one tidy CSV per
 * station. Stored next to the experiment's other processed data:
 *
 *   Processed/{year}/{experiment}/{site}/Weather/{station}.csv   (the data)
 *   Processed/{year}/{experiment}/{site}/Weather/{station}.json  (what it is)
 *
 * TOA5: line 1 the logger, line 2 the column names, line 3 their units, line
 * 4 how each was recorded (Smp, Avg …), then the rows. Times are the logger's
 * clock (usually local standard time) and are kept as written.
 */

export type Role =
  | "skip"
  | "time"
  | "air_temp"
  | "rh"
  | "solar"
  | "par"
  | "wind_speed"
  | "wind_dir"
  | "rain"
  | "vpd"
  | "soil_moisture"
  | "soil_temp"
  | "other"

export const ROLES: { role: Role; label: string; temperature?: boolean }[] = [
  { role: "skip", label: "Leave out" },
  { role: "time", label: "Date & time" },
  { role: "air_temp", label: "Air temperature", temperature: true },
  { role: "rh", label: "Relative humidity (%)" },
  { role: "vpd", label: "Vapour pressure deficit (kPa)" },
  { role: "solar", label: "Solar radiation (W/m²)" },
  { role: "par", label: "PAR / PPFD (µmol/m²/s)" },
  { role: "wind_speed", label: "Wind speed (m/s)" },
  { role: "wind_dir", label: "Wind direction (°)" },
  { role: "rain", label: "Rain (mm)" },
  { role: "soil_moisture", label: "Soil moisture" },
  { role: "soil_temp", label: "Soil temperature", temperature: true },
  { role: "other", label: "Keep as is" },
]

export const isTemperatureRole = (r: Role) =>
  ROLES.find((x) => x.role === r)?.temperature === true

export type TempUnit = "C" | "F" | "K"

export interface ColumnSetup {
  name: string
  role: Role
  /** For temperatures: what the file holds (converted to °C). */
  unit?: TempUnit
  /** The file's own unit text (TOA5 line 3), shown to the person. */
  fileUnit?: string
  /** Name in the tidy file (defaults from role and name). */
  out?: string
}

export interface ParsedTable {
  format: "toa5" | "csv"
  names: string[]
  units: string[]
  rows: string[][]
  /** TOA5 line 1 (station, logger, program, table). */
  logger?: string[]
}

/** One CSV line, honouring quotes. */
export function splitCsvLine(line: string, sep = ","): string[] {
  const out: string[] = []
  let cur = ""
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else q = false
      } else cur += c
    } else if (c === '"') q = true
    else if (c === sep) {
      out.push(cur)
      cur = ""
    } else cur += c
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

export function isToa5(text: string): boolean {
  return /^\s*"?TOA5"?\s*,/.test(text.slice(0, 200))
}

/** A TOA5 or CSV file. `headerRow` (CSV only): which line holds the names. */
export function parseTable(text: string, headerRow = 0): ParsedTable {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .filter((l) => l.trim())
  if (isToa5(text)) {
    return {
      format: "toa5",
      logger: splitCsvLine(lines[0]),
      names: splitCsvLine(lines[1] ?? ""),
      units: splitCsvLine(lines[2] ?? ""),
      rows: lines.slice(4).map((l) => splitCsvLine(l)),
    }
  }
  const sep = (lines[headerRow] ?? "").includes("\t") ? "\t" : ","
  const names = splitCsvLine(lines[headerRow] ?? "", sep)
  return {
    format: "csv",
    names,
    units: names.map(() => ""),
    rows: lines.slice(headerRow + 1).map((l) => splitCsvLine(l, sep)),
  }
}

/** A guess at each column's role from its name and unit. */
export function guessRole(name: string, unit = ""): Role {
  const n = name.toLowerCase()
  const u = unit.toLowerCase()
  if (/^(timestamp|date.?time|time.?stamp|datetime|ts)$/.test(n)) return "time"
  if (n === "record" || u === "rn") return "skip"
  if (/soil.*(temp)|^t_\d+cm|soiltemp/.test(n)) return "soil_temp"
  if (/vwc|soil.?water|soil.?moist|matric|swp/.test(n)) return "soil_moisture"
  if (/air.?t|^temp|^t_?air|airtc|temperature/.test(n)) return "air_temp"
  if (/^rh|humid/.test(n)) return "rh"
  if (/vpd/.test(n)) return "vpd"
  if (/ppfd|par\b|^par/.test(n)) return "par"
  if (/solar|srad|slrw|radiation|pyran/.test(n)) return "solar"
  if (/gust/.test(n)) return "skip"
  if (/wind.?dir|wd\b|winddir/.test(n)) return "wind_dir"
  if (/wind|^ws\b|windspeed/.test(n)) return "wind_speed"
  if (/rain|precip/.test(n)) return "rain"
  return "skip"
}

/** A temperature unit from a file's unit text ("°C", "deg F", "K"). */
export function tempUnitOf(unit: string): TempUnit | undefined {
  const u = unit.replace(/[°º\s]|deg/gi, "").toUpperCase()
  if (u === "C") return "C"
  if (u === "F") return "F"
  if (u === "K") return "K"
  return undefined
}

export function toCelsius(v: number, unit: TempUnit = "C"): number {
  if (unit === "F") return ((v - 32) * 5) / 9
  if (unit === "K") return v - 273.15
  return v
}

/**
 * A logger or spreadsheet time as "YYYY-MM-DD HH:MM:SS" (its own clock), or
 * null. Reads ISO-like ("2026-08-20 00:00:05", "2026-08-20T00:00"), US
 * ("8/20/2026 13:05", "8/20/26 1:05 PM").
 */
export function parseTime(s: string): string | null {
  const t = s.trim().replace(/^"|"$/g, "")
  let m = t.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?/,
  )
  if (m) return fmt(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0))
  m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) return fmt(+m[1], +m[2], +m[3], 0, 0, 0)
  m = t.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i,
  )
  if (m) {
    let y = +m[3]
    if (y < 100) y += 2000
    let h = +m[4]
    if (m[7]) {
      const pm = m[7].toUpperCase() === "PM"
      if (pm && h < 12) h += 12
      if (!pm && h === 12) h = 0
    }
    return fmt(y, +m[1], +m[2], h, +m[5], +(m[6] ?? 0))
  }
  return null
}

function fmt(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
) {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${y}-${p(mo)}-${p(d)} ${p(h)}:${p(mi)}:${p(s)}`
}

/** The tidy name of a column. */
export function outName(c: ColumnSetup, all: ColumnSetup[]): string {
  if (c.out) return c.out
  const base =
    c.role === "air_temp"
      ? "air_temp_c"
      : c.role === "soil_temp"
        ? "soil_temp_c"
        : c.role === "other"
          ? c.name
          : c.role
  // Several columns of one role (soil at 5, 10 … cm): keep them apart.
  const same = all.filter((x) => x.role === c.role && x.role !== "other")
  if (same.length > 1)
    return `${base}_${c.name.replace(/[^A-Za-z0-9]+/g, "_")}`.toLowerCase()
  return base
}

export interface TidyRow {
  time: string
  values: Record<string, number | null>
}

/**
 * Rows from every file (in time order, a time seen twice kept once), the
 * chosen columns only, temperatures in °C, averaged over `minutes` (0 = as
 * recorded).
 */
/**
 * The span of dates holding the data, leaving out stray dates far from the
 * rest (a logger clock reset can stamp a few minutes "2097-07-31"): every
 * date within 400 days of the median one.
 */
export function mainSpan(times: string[]): {
  from: string
  to: string
  outside: string[]
} {
  const dates = times.map((t) => t.slice(0, 10)).sort()
  if (!dates.length) return { from: "", to: "", outside: [] }
  const median = Date.parse(dates[Math.floor(dates.length / 2)])
  const far = (d: string) => Math.abs(Date.parse(d) - median) > 400 * 864e5
  const inside = dates.filter((d) => !far(d))
  return {
    from: inside[0] ?? dates[0],
    to: inside.at(-1) ?? dates.at(-1) ?? "",
    outside: [...new Set(dates.filter(far))],
  }
}

export function tidy(
  tables: ParsedTable[],
  setup: ColumnSetup[],
  minutes = 0,
  /** Keep only these dates (inclusive, YYYY-MM-DD). */
  keep?: { from?: string; to?: string },
): {
  columns: string[]
  rows: TidyRow[]
  skipped: number
  /** Rows dropped for falling outside `keep`. */
  outside: number
} {
  const timeCol = setup.find((c) => c.role === "time")
  const kept = setup.filter((c) => c.role !== "skip" && c.role !== "time")
  const columns = kept.map((c) => outName(c, setup))
  const byTime = new Map<string, Record<string, number | null>>()
  let skipped = 0
  let outside = 0
  for (const t of tables) {
    const ti = timeCol ? t.names.indexOf(timeCol.name) : -1
    const idx = kept.map((c) => t.names.indexOf(c.name))
    for (const r of t.rows) {
      const time = ti >= 0 ? parseTime(r[ti] ?? "") : null
      if (!time) {
        skipped++
        continue
      }
      const day = time.slice(0, 10)
      if ((keep?.from && day < keep.from) || (keep?.to && day > keep.to)) {
        outside++
        continue
      }
      const values: Record<string, number | null> = {}
      kept.forEach((c, k) => {
        const raw = idx[k] >= 0 ? (r[idx[k]] ?? "") : ""
        const v = Number(raw)
        values[columns[k]] =
          raw === "" || /^"?nan"?$/i.test(raw) || !Number.isFinite(v)
            ? null
            : isTemperatureRole(c.role)
              ? Math.round(toCelsius(v, c.unit ?? "C") * 1000) / 1000
              : v
      })
      byTime.set(time, values)
    }
  }
  let rows = [...byTime.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([time, values]) => ({ time, values }))
  if (minutes > 0) rows = average(rows, columns, minutes)
  return { columns, rows, skipped, outside }
}

/** Means over fixed intervals (the interval's start time). */
export function average(
  rows: TidyRow[],
  columns: string[],
  minutes: number,
): TidyRow[] {
  const bins = new Map<string, { sum: number[]; n: number[] }>()
  for (const r of rows) {
    const [d, hms] = r.time.split(" ")
    const [h, m] = hms.split(":").map(Number)
    const start = Math.floor((h * 60 + m) / minutes) * minutes
    const key = `${d} ${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}:00`
    const b = bins.get(key) ?? {
      sum: columns.map(() => 0),
      n: columns.map(() => 0),
    }
    columns.forEach((c, i) => {
      const v = r.values[c]
      if (v != null) {
        b.sum[i] += v
        b.n[i] += 1
      }
    })
    bins.set(key, b)
  }
  return [...bins.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([time, b]) => ({
      time,
      values: Object.fromEntries(
        columns.map((c, i) => [
          c,
          b.n[i] ? Math.round((b.sum[i] / b.n[i]) * 1000) / 1000 : null,
        ]),
      ),
    }))
}

export function toCsv(columns: string[], rows: TidyRow[]): string {
  const lines = [["time", ...columns].join(",")]
  for (const r of rows)
    lines.push(
      [
        r.time,
        ...columns.map((c) => (r.values[c] == null ? "" : String(r.values[c]))),
      ].join(","),
    )
  return `${lines.join("\n")}\n`
}

export function fromCsv(text: string): { columns: string[]; rows: TidyRow[] } {
  const lines = text.replace(/\r/g, "").split("\n").filter(Boolean)
  const head = splitCsvLine(lines[0] ?? "")
  const columns = head.slice(1)
  const rows = lines.slice(1).map((l) => {
    const f = splitCsvLine(l)
    return {
      time: f[0],
      values: Object.fromEntries(
        columns.map((c, i) => [c, f[i + 1] === "" ? null : Number(f[i + 1])]),
      ),
    }
  })
  return { columns, rows }
}

export interface StationMeta {
  station: string
  /** Which plots it stands for, in the person's words ("drought"). */
  treatment?: string
  columns: string[]
  /** Column → what it is and its unit after conversion. */
  describe: Record<string, { role: Role; source: string; unit: string }>
  interval_minutes: number
  first: string
  last: string
  rows: number
  files: string[]
  clock: string
  uploaded: string
}

export function weatherFolder(scope: {
  year: string
  experiment: string
  site: string
}): string {
  return `Processed/${scope.year}/${scope.experiment}/${scope.site}/Weather/`
}

export function stationFile(station: string): string {
  return station.trim().replace(/[^A-Za-z0-9._-]+/g, "_") || "station"
}

/** Mean of a column over a time-of-day window on one date. */
export function windowMean(
  rows: TidyRow[],
  column: string,
  date: string,
  from: string,
  to: string,
): { mean: number | null; n: number } {
  let sum = 0
  let n = 0
  for (const r of rows) {
    if (!r.time.startsWith(date)) continue
    const hm = r.time.slice(11, 16)
    if (hm < from || hm > to) continue
    const v = r.values[column]
    if (v != null) {
      sum += v
      n++
    }
  }
  return { mean: n ? sum / n : null, n }
}
