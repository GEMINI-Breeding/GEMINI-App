/**
 * Canopy − air temperature per plot (CTD), a trait from a thermal reading and
 * a weather station's air temperature at the time that plot was flown.
 *
 * - Air temperature is the station's mean over ± `halfWindow` minutes around
 *   the reading's own timestamp (the flight time; the camera's clock and the
 *   logger's are both taken as local wall-clock time).
 * - The station: one whose "stands for" (treatment) appears in the thermal
 *   run's name or in the plot's field-design values; otherwise the chosen
 *   default (one station, or the mean of all of them).
 * - CTD below zero: the canopy is cooler than the air (transpiring); near or
 *   above zero suggests stress.
 * - CTD vs field: the plot's CTD minus the median CTD of its flight. It takes
 *   out what changes from day to day (weather, calibration), so plots and
 *   lines compare across dates.
 */
import type { StationMeta, TidyRow } from "./weather"

export interface Station {
  meta: StationMeta
  columns: string[]
  rows: TidyRow[]
}

/** The stored trait names (shown through traitLabel). */
export const CTD_TRAIT = "CTD_C"
export const CTD_REL_TRAIT = "CTD_rel_C"

/** A station's air-temperature column. */
export const airCol = (s: Station): string | undefined =>
  s.columns.find((c) => c === "air_temp_c") ??
  s.columns.find((c) => c.startsWith("air_temp_c"))

/** "2026-07-27T09:34:07-07:00" → "2026-07-27 09:34:07" (wall clock as stored). */
export function wallClock(ts: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)/.exec(ts)
  if (!m) return null
  return `${m[1]} ${m[2].length === 5 ? `${m[2]}:00` : m[2]}`
}

function shift(time: string, minutes: number): string {
  // Plain arithmetic on the wall clock (no time zone involved).
  const d = new Date(`${time.replace(" ", "T")}Z`)
  d.setUTCMinutes(d.getUTCMinutes() + minutes)
  return d.toISOString().slice(0, 19).replace("T", " ")
}

/** Index of the first row at or after `time` (rows are sorted by time). */
function lowerBound(rows: TidyRow[], time: string): number {
  let lo = 0
  let hi = rows.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (rows[mid].time < time) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Mean of a column over [time − half, time + half] minutes, or null. */
export function meanAround(
  rows: TidyRow[],
  column: string,
  time: string,
  halfWindow: number,
): number | null {
  const from = shift(time, -halfWindow)
  const to = shift(time, halfWindow)
  let sum = 0
  let n = 0
  for (let i = lowerBound(rows, from); i < rows.length; i++) {
    const r = rows[i]
    if (r.time > to) break
    const v = r.values[column]
    if (v != null && Number.isFinite(v)) {
      sum += v
      n++
    }
  }
  return n ? sum / n : null
}

/** Vapour pressure deficit (kPa) from air temperature (°C) and RH (%). */
export function vpd(airC: number, rh: number): number {
  const es = 0.6108 * Math.exp((17.27 * airC) / (airC + 237.3))
  return es * (1 - Math.min(100, Math.max(0, rh)) / 100)
}

const norm = (s: string) => s.trim().toLowerCase()

/** The station whose treatment the run's name or the plot's values name. */
export function stationFor(
  stations: Station[],
  datasetName: string,
  plotValues: string[],
): number | null {
  const name = norm(datasetName)
  const values = new Set(plotValues.map(norm))
  for (let i = 0; i < stations.length; i++) {
    const t = stations[i].meta.treatment
    if (!t?.trim()) continue
    if (values.has(norm(t))) return i
  }
  for (let i = 0; i < stations.length; i++) {
    const t = stations[i].meta.treatment
    if (!t?.trim()) continue
    // Whole words only, so "watered" never matches "well-watered".
    const re = new RegExp(
      `(^|[^a-z0-9-])${norm(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9-])`,
    )
    if (re.test(name)) return i
  }
  return null
}

/** A thermal reading, as the trait-records endpoint returns it. */
export interface ThermalRecord {
  trait_value: number | string
  timestamp?: string | null
  collection_date?: string | null
  dataset_name?: string | null
  plot_id?: string | null
  plot_number?: number | string | null
  plot_row_number?: number | null
  plot_column_number?: number | null
  population_name?: string | null
  accession_name?: string | null
}

export type StationChoice = "mean" | number

export interface CanopyAirRow {
  record: ThermalRecord
  date: string
  /** The flight time used (wall clock). */
  time: string
  canopy: number
  air: number
  ctd: number
  /** CTD minus its flight's median CTD. */
  ctdRel: number
  rh: number | null
  vpd: number | null
  /** The station(s) the air temperature came from. */
  station: string
  /** Matched by treatment (true) or the default choice. */
  matched: boolean
}

export interface CanopyAirResult {
  rows: CanopyAirRow[]
  /** Readings with no air temperature near their time (station gap, no timestamp). */
  missing: number
  /** Per flight (thermal run): date, time, plots, mean air, mean CTD. */
  flights: {
    dataset: string
    date: string
    time: string
    plots: number
    air: number
    ctd: number
    vpd: number | null
  }[]
}

export function canopyAir(
  records: ThermalRecord[],
  stations: Station[],
  opts: {
    choice: StationChoice
    halfWindow?: number
    /** plot_id → the plot's field-design values (for treatment matching). */
    plotValues?: Map<string, string[]>
  },
): CanopyAirResult {
  const half = opts.halfWindow ?? 10
  const withAir = stations.filter((s) => airCol(s))
  const rows: Omit<CanopyAirRow, "ctdRel">[] = []
  let missing = 0

  // One flight time per thermal run: its readings share the timestamp, but
  // take the median in case a run carries several.
  const flightTime = new Map<string, string>()
  const byRun = new Map<string, string[]>()
  for (const r of records) {
    const t = r.timestamp ? wallClock(r.timestamp) : null
    if (!t) continue
    const k = r.dataset_name ?? ""
    byRun.set(k, [...(byRun.get(k) ?? []), t])
  }
  for (const [k, ts] of byRun) {
    ts.sort()
    flightTime.set(k, ts[ts.length >> 1])
  }

  const at = (s: Station, time: string) => {
    const col = airCol(s)
    const air = col ? meanAround(s.rows, col, time, half) : null
    const rh = s.columns.includes("rh")
      ? meanAround(s.rows, "rh", time, half)
      : null
    return { air, rh }
  }

  for (const r of records) {
    const canopy = Number(r.trait_value)
    const time = r.timestamp ? wallClock(r.timestamp) : null
    const run = r.dataset_name ?? ""
    const when = flightTime.get(run) ?? time
    if (!Number.isFinite(canopy) || !when || !withAir.length) {
      missing++
      continue
    }
    const plotVals = (r.plot_id && opts.plotValues?.get(r.plot_id)) || []
    const hit = stationFor(withAir, run, plotVals)
    let air: number | null = null
    let rh: number | null = null
    let station = ""
    if (hit != null) {
      ;({ air, rh } = at(withAir[hit], when))
      station = withAir[hit].meta.station
    } else if (opts.choice === "mean" || withAir.length === 1) {
      const got = withAir.map((s) => at(s, when))
      const airs = got.map((g) => g.air).filter((v): v is number => v != null)
      const rhs = got.map((g) => g.rh).filter((v): v is number => v != null)
      air = airs.length ? airs.reduce((a, b) => a + b, 0) / airs.length : null
      rh = rhs.length ? rhs.reduce((a, b) => a + b, 0) / rhs.length : null
      station =
        withAir.length === 1
          ? withAir[0].meta.station
          : `mean of ${withAir.map((s) => s.meta.station).join(", ")}`
    } else {
      const s = withAir[opts.choice] ?? withAir[0]
      ;({ air, rh } = at(s, when))
      station = s.meta.station
    }
    if (air == null) {
      missing++
      continue
    }
    rows.push({
      record: r,
      date: when.slice(0, 10),
      time: when,
      canopy,
      air,
      ctd: canopy - air,
      rh,
      vpd: rh == null ? null : vpd(air, rh),
      station,
      matched: hit != null,
    })
  }

  // CTD vs field: against the median of the same flight.
  const groups = new Map<string, number[]>()
  for (const r of rows) {
    const k = r.record.dataset_name ?? r.date
    groups.set(k, [...(groups.get(k) ?? []), r.ctd])
  }
  const medians = new Map<string, number>()
  for (const [k, v] of groups) medians.set(k, median(v))
  const out: CanopyAirRow[] = rows.map((r) => ({
    ...r,
    ctdRel: r.ctd - (medians.get(r.record.dataset_name ?? r.date) ?? 0),
  }))

  const flights = [...groups.keys()].map((k) => {
    const rs = out.filter((r) => (r.record.dataset_name ?? r.date) === k)
    const vp = rs.map((r) => r.vpd).filter((v): v is number => v != null)
    return {
      dataset: k,
      date: rs[0].date,
      time: rs[0].time.slice(11, 16),
      plots: rs.length,
      air: mean(rs.map((r) => r.air)),
      ctd: mean(rs.map((r) => r.ctd)),
      vpd: vp.length ? mean(vp) : null,
    }
  })
  flights.sort((a, b) => a.date.localeCompare(b.date))
  return { rows: out, missing, flights }
}

function mean(v: number[]): number {
  return v.reduce((a, b) => a + b, 0) / v.length
}

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
