/**
 * One flight, several cameras: a drone's RGB camera with a thermal (or
 * multispectral) camera beside it. Each sensor's upload becomes its own run,
 * but a person processes the flight once: the RGB run is the flight's run, and
 * the other cameras' runs of the same flight fold into it.
 *
 *  - Their frames are used by the RGB run's plot images from the raw frames
 *    (matched to the RGB frames by capture time, cut per plot), with nothing
 *    to do in their own runs.
 *  - Their own run is kept only to build that sensor's orthomosaic, if wanted
 *    (started from the RGB run).
 *
 * "Same flight": same experiment, site, population, date and platform, the
 * same run of the day, and a treatment the RGB run holds. A sensor's run with
 * no RGB run of its flight stays a run of its own (thermal-only processing).
 */
import type { Run } from "./runStore"

/** "run 12:54 · drought" → { run: "12:54", treatment: "drought" }. */
export function splitBatchLabel(label?: string | null): {
  run?: string
  treatment?: string
} {
  const out: { run?: string; treatment?: string } = {}
  for (const part of (label ?? "")
    .split("·")
    .map((p) => p.trim())
    .filter(Boolean)) {
    if (/^run\s+/i.test(part)) out.run = part.replace(/^run\s+/i, "").trim()
    else out.treatment = part
  }
  return out
}

const PRIMARY = new Set(["rgb", "visible", "wide"])

/** The sensor a flight's processing run is built on (the RGB camera's). */
export function isPrimarySensor(sensor?: string | null): boolean {
  // "RGB-SonyA7R": another RGB camera than the platform's own, still RGB.
  return PRIMARY.has((sensor ?? "").trim().split("-")[0].toLowerCase())
}

const PLACE = [
  "experiment",
  "location",
  "population",
  "date",
  "platform",
] as const

function sameFlightPlace(a: Run, b: Run): boolean {
  const x = a.uploadScope
  const y = b.uploadScope
  return (
    Boolean(x && y) && PLACE.every((k) => (x?.[k] ?? "") === (y?.[k] ?? ""))
  )
}

/** A run's treatments: its own label's, or (a run pooling several batches)
 * its batches' labels'. */
export function runTreatments(
  run: Run,
  batchLabels: Record<string, string> = {},
): string[] {
  const own = splitBatchLabel(run.uploadScope?.batchLabel).treatment
  if (own) return [own]
  return [
    ...new Set(
      (run.uploadScope?.datasetShortIds ?? [])
        .map((id) => splitBatchLabel(batchLabels[id]).treatment)
        .filter((t): t is string => Boolean(t)),
    ),
  ]
}

function belongs(
  other: Run,
  primary: Run,
  batchLabels: Record<string, string>,
): boolean {
  if (!sameFlightPlace(other, primary)) return false
  const a = splitBatchLabel(other.uploadScope?.batchLabel)
  const b = splitBatchLabel(primary.uploadScope?.batchLabel)
  if ((a.run ?? "") !== (b.run ?? "")) return false
  const mine = runTreatments(other, batchLabels)
  const theirs = runTreatments(primary, batchLabels)
  // No treatment on either side, or the other camera's treatment among the RGB run's.
  return (
    mine.length === 0 ||
    theirs.length === 0 ||
    mine.every((t) => theirs.includes(t))
  )
}

/** The RGB run a sensor's run folds into, if its flight has one. */
export function primaryRunOf(
  run: Run,
  runs: Run[],
  batchLabels: Record<string, string> = {},
): Run | null {
  if (isPrimarySensor(run.uploadScope?.sensor)) return null
  return (
    runs.find(
      (r) =>
        r.id !== run.id &&
        isPrimarySensor(r.uploadScope?.sensor) &&
        belongs(run, r, batchLabels),
    ) ?? null
  )
}

/** The other cameras' runs that fold into this RGB run, by sensor name. */
export function companionRunsOf(
  run: Run,
  runs: Run[],
  batchLabels: Record<string, string> = {},
): Run[] {
  if (!isPrimarySensor(run.uploadScope?.sensor)) return []
  return runs
    .filter(
      (r) =>
        r.id !== run.id &&
        !isPrimarySensor(r.uploadScope?.sensor) &&
        primaryRunOf(r, runs, batchLabels)?.id === run.id,
    )
    .sort((a, b) =>
      (a.uploadScope?.sensor ?? "").localeCompare(b.uploadScope?.sensor ?? ""),
    )
}
