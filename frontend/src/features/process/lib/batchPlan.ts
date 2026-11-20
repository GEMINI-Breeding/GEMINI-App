/**
 * Running steps across a pipeline's dates at once (from the run list): what
 * each date has, and so for each step whether it is done, can run now, runs
 * after another step of the same batch, or needs the person first (no plot
 * boundaries yet, no model for that crop).
 */
import type { FileMetadata } from "@/client"

export type BatchStep =
  | "quick_ortho"
  | "plot_images"
  | "trait_extraction"
  | "inference"

export const BATCH_STEPS: BatchStep[] = [
  "quick_ortho",
  "plot_images",
  "trait_extraction",
  "inference",
]

export const STEP_LABELS: Record<BatchStep, string> = {
  quick_ortho: "Quick orthomosaic",
  plot_images: "Plot images",
  trait_extraction: "Trait extraction",
  inference: "Inference",
}

/** Where inference reads plot images from, in the order to try them. */
export type ImageSource = "ortho" | "straightened" | "crops"

export const SOURCE_LABELS: Record<ImageSource, string> = {
  ortho: "Plot images from the orthomosaic",
  straightened: "Raw frames, top-down",
  crops: "Raw frame crops",
}

export const DEFAULT_SOURCES: ImageSource[] = ["ortho", "straightened", "crops"]

/** What one date (run) has, read from its folder and records. */
export interface DateFacts {
  runId: string
  date: string
  population: string
  /** An active plot-boundary version. */
  boundaries: boolean
  /** Orthomosaics the run uses (one per treatment flown apart). */
  orthos: number
  /** Camera positions from an ODM run (needed for raw-frame plot images). */
  cameras: boolean
  /** Plot images present, by source. */
  images: Record<ImageSource, boolean>
  /** Trait extraction done. */
  traits: boolean
  /** Count labels of models already run on this date. */
  inferred: string[]
}

export interface BatchOptions {
  steps: Set<BatchStep>
  /** Plot images from the orthomosaic, or each plot's best raw frames. */
  plotSource: "ortho" | "frames"
  /** Model (its count label) per crop; none = no inference for that crop. */
  /** Models (their count labels) per crop; none = no inference there. */
  modelsFor: (population: string) => string[]
  sources: ImageSource[]
  /** Run again where already done. */
  rerun: boolean
}

export type CellState =
  | { kind: "done" }
  | { kind: "ready" }
  | { kind: "after"; step: BatchStep }
  | { kind: "needs"; reason: string }
  | { kind: "off" }

/** The image source inference would use now, if any. */
export function availableSource(
  f: DateFacts,
  sources: ImageSource[],
): ImageSource | null {
  return sources.find((s) => f.images[s]) ?? null
}

/** Whether the batch's plot images step makes `source` for this date. */
function makesSource(o: BatchOptions, s: ImageSource): boolean {
  return o.plotSource === "ortho" ? s === "ortho" : s !== "ortho"
}

export function planCell(
  step: BatchStep,
  f: DateFacts,
  o: BatchOptions,
  /** The date's plan so far (earlier steps), for "after". */
  earlier: Partial<Record<BatchStep, CellState>> = {},
): CellState {
  if (!o.steps.has(step)) return { kind: "off" }
  const willRun = (s: BatchStep) => {
    const c = earlier[s]
    return c?.kind === "ready" || c?.kind === "after"
  }
  switch (step) {
    case "quick_ortho":
      if (f.cameras && !o.rerun) return { kind: "done" }
      return { kind: "ready" }
    case "plot_images": {
      const done =
        o.plotSource === "ortho" ? f.images.ortho : f.images.straightened
      if (done && !o.rerun) return { kind: "done" }
      if (!f.boundaries) return { kind: "needs", reason: "plot boundaries" }
      if (o.plotSource === "ortho") {
        if (!f.orthos) return { kind: "needs", reason: "an orthomosaic" }
        return { kind: "ready" }
      }
      if (f.cameras) return { kind: "ready" }
      if (willRun("quick_ortho")) return { kind: "after", step: "quick_ortho" }
      return { kind: "needs", reason: "camera positions (a quick orthomosaic)" }
    }
    case "trait_extraction":
      if (f.traits && !o.rerun) return { kind: "done" }
      if (!f.boundaries) return { kind: "needs", reason: "plot boundaries" }
      if (!f.orthos) return { kind: "needs", reason: "an orthomosaic" }
      return { kind: "ready" }
    case "inference": {
      if (!o.modelsFor(f.population).length)
        return {
          kind: "needs",
          reason: `a model for ${f.population || "this crop"}`,
        }
      if (!modelsToRun(f, o).length) return { kind: "done" }
      if (!f.boundaries) return { kind: "needs", reason: "plot boundaries" }
      // The first preferred source that exists now, or that this batch makes.
      for (const s of o.sources) {
        if (f.images[s]) return { kind: "ready" }
        if (willRun("plot_images") && makesSource(o, s))
          return { kind: "after", step: "plot_images" }
      }
      return { kind: "needs", reason: "plot images" }
    }
  }
}

/** The crop's models still to run on this date (all of them on a re-run). */
export function modelsToRun(f: DateFacts, o: BatchOptions): string[] {
  const all = o.modelsFor(f.population)
  return o.rerun ? all : all.filter((m) => !f.inferred.includes(m))
}

/** Every step's state for one date, in order. */
export function planDate(
  f: DateFacts,
  o: BatchOptions,
): Record<BatchStep, CellState> {
  const out: Partial<Record<BatchStep, CellState>> = {}
  for (const s of BATCH_STEPS) out[s] = planCell(s, f, o, out)
  return out as Record<BatchStep, CellState>
}

/** What a date's Processed folder listing shows (see `FACTS_MATCH`). */
export function folderFacts(
  files: FileMetadata[],
  framesKey: string,
): Pick<DateFacts, "cameras" | "images"> {
  const names = files.map((f) => f.object_name ?? "")
  const frames = `/PlotFrames/${framesKey ? `${framesKey}/` : ""}`
  const has = (re: RegExp) => names.some((n) => re.test(n))
  const esc = frames.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return {
    cameras: has(/\/odm_cameras-[^/]+\.json$/),
    images: {
      ortho: has(/\/PlotImages\/plot_[^/]+\.(png|jpe?g)$/i),
      straightened: has(
        new RegExp(`${esc}straightened/plot_[^/]+\\.(png|jpe?g)$`, "i"),
      ),
      crops: has(new RegExp(`${esc}crops/plot_[^/]+\\.(png|jpe?g)$`, "i")),
    },
  }
}

/** The names a date's facts are read from: the server sends just these. */
export const FACTS_MATCH =
  "/odm_(orthophoto|dsm|cameras)[^/]*$|/PlotImages/plot_[^/]+_accession_[^/]+\\.png$|/PlotFrames/(.+/)?straightened/plot_[^/]+\\.png$|/PlotFrames/(.+/)?crops/plot_[^/]+_frame1_[^/]+\\.jpg$|/traits/[^/]+\\.geojson$"
