/**
 * Runs grouped the way a flight day reads: one group per date, site,
 * population and platform (a drone day at Davis on sorghum), holding every
 * sensor flown (RGB and thermal together), and inside it one line per run of
 * the day (diurnal flights), each line naming its treatment(s) and listing the
 * run of each sensor.
 *
 * A run's labels come from its upload ("run 12:54 · drought"). A run that pools
 * several unlabelled-in-the-run batches (the first flights of the day, one per
 * treatment, processed together) takes its treatments from its batches' labels.
 */
import { primaryRunOf, splitBatchLabel } from "./companionRuns"
import type { Run } from "./runStore"

export { splitBatchLabel }

export interface RunInLine {
  run: Run
  sensor: string
  /** The run's own treatment(s), as its labels say. */
  treatments: string[]
  /** Other cameras of the same flight folded into this (RGB) run: their frames
   * go into its plot images; their own run only builds their orthomosaic. */
  with: RunInLine[]
}

export interface RunLine {
  key: string
  /** "12:54 · well-watered", "First flights · well-watered + drought". */
  title: string
  runs: RunInLine[]
}

export interface RunGroup {
  key: string
  date: string
  /** "Davis · Sorghum · Drone". */
  title: string
  sensors: string[]
  treatments: string[]
  lines: RunLine[]
  runs: Run[]
}

const SENSOR_ORDER = ["RGB", "Thermal", "Multispectral"]
const sensorRank = (s: string) => {
  const i = SENSOR_ORDER.indexOf(s)
  return i < 0 ? SENSOR_ORDER.length : i
}

/** Runs of the day in time order ("08:16" before "12:54"; "2" before "10"). */
function runOrder(a: string, b: string) {
  if (!a || !b) return a ? 1 : b ? -1 : 0
  return a.localeCompare(b, undefined, { numeric: true })
}

/**
 * ``batchLabels``: dataset short id → its label ("drought"), for runs that pool
 * several batches. Groups come newest date first.
 */
export function groupRuns(
  runs: Run[],
  batchLabels: Record<string, string> = {},
): RunGroup[] {
  const groups = new Map<string, RunGroup>()
  const lineOf = new Map<string, Map<string, RunLine>>()
  for (const run of runs) {
    const s = run.uploadScope
    const date = s?.date || run.createdAt.slice(0, 10)
    const where = [s?.location, s?.population, s?.platform].filter(Boolean)
    const key = [date, ...where].join("|")
    let g = groups.get(key)
    if (!g) {
      g = {
        key,
        date,
        title: where.join(" · ") || run.name || `Run ${run.id.slice(0, 8)}`,
        sensors: [],
        treatments: [],
        lines: [],
        runs: [],
      }
      groups.set(key, g)
      lineOf.set(key, new Map())
    }
    const own = splitBatchLabel(s?.batchLabel)
    const pooled = (s?.datasetShortIds ?? [])
      .map((id) => splitBatchLabel(batchLabels[id]).treatment)
      .filter((t): t is string => Boolean(t))
    const treatments = own.treatment
      ? [own.treatment]
      : [...new Set(pooled)].sort()
    const sensor = s?.sensor || "—"
    const lines = lineOf.get(key) as Map<string, RunLine>
    const lineKey = own.run ?? ""
    let line = lines.get(lineKey)
    if (!line) {
      line = { key: lineKey, title: "", runs: [] }
      lines.set(lineKey, line)
      g.lines.push(line)
    }
    line.runs.push({ run, sensor, treatments, with: [] })
    g.runs.push(run)
    if (!g.sensors.includes(sensor)) g.sensors.push(sensor)
    for (const t of treatments)
      if (!g.treatments.includes(t)) g.treatments.push(t)
  }
  for (const g of groups.values()) {
    g.sensors.sort(
      (a, b) => sensorRank(a) - sensorRank(b) || a.localeCompare(b),
    )
    g.treatments.sort()
    g.lines.sort((a, b) => runOrder(a.key, b.key))
    const several = g.lines.length > 1
    for (const line of g.lines) {
      line.runs.sort(
        (a, b) =>
          sensorRank(a.sensor) - sensorRank(b.sensor) ||
          a.treatments.join().localeCompare(b.treatments.join()),
      )
      // Other cameras of a flight fold into its RGB run (companionRuns.ts).
      const byId = new Map(line.runs.map((r) => [r.run.id, r]))
      line.runs = line.runs.filter((r) => {
        const primary = primaryRunOf(r.run, g.runs, batchLabels)
        const host = primary ? byId.get(primary.id) : undefined
        if (!host) return true
        host.with.push(r)
        return false
      })
      const ts = [
        ...new Set(
          line.runs.flatMap((r) => [
            ...r.treatments,
            ...r.with.flatMap((w) => w.treatments),
          ]),
        ),
      ].sort()
      const when = line.key || (several ? "First flights" : "")
      line.title = [when, ts.join(" + ")].filter(Boolean).join(" · ")
    }
  }
  return [...groups.values()].sort(
    (a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title),
  )
}

/** A group's status: the most pressing of its runs' (failed, running, …). */
export const TAG_PRIORITY = [
  "failed",
  "running",
  "queued",
  "waiting",
  "new",
  "complete",
] as const
