/**
 * Plot images from the raw frames (SPLIT_ORTHOMOSAIC source="frames"): the
 * manifest the job writes, and what each download holds. Every file is named
 * by plot and accession, like the orthomosaic's plot images.
 */

export interface PlotFrame {
  rank: number
  /** The full raw frame in storage (not copied: downloads name it per plot). */
  image: string
  /** The plot cut from this frame. */
  crop: string
  /** Share of the plot's outline inside the frame (1 = all of it). */
  inside: number
  off_nadir_deg: number
  center_offset: number
  gsd_cm: number
}

export interface PlotFramesEntry {
  plot: string | number
  accession: string
  ground_z: number
  /** The best frame warped to a top-down view of the plot. */
  straightened: string | null
  frames: PlotFrame[]
}

export interface PlotFramesManifest {
  orthomosaics: string[]
  crs: string
  frames_per_plot: number
  /** Where the ground heights came from: "dsm", "takeoff height". */
  ground: string[]
  plots: PlotFramesEntry[]
}

export type FramesDownload =
  | "straightened"
  | "crops-best"
  | "crops-all"
  | "frames-best"
  | "frames-all"

const safe = (v: unknown) => String(v).replace(/\//g, "_").replace(/ /g, "_")

/** plot_12_accession_PI_1234 — the stem every plot's files share. */
export function plotStem(p: Pick<PlotFramesEntry, "plot" | "accession">) {
  return `plot_${p.plot}_accession_${safe(p.accession)}`
}

const base = (path: string) => path.split("/").pop() ?? path

/** The files of one download, each with its name in the zip. */
export function framesDownload(
  m: PlotFramesManifest,
  which: FramesDownload,
): { object: string; name: string }[] {
  const out: { object: string; name: string }[] = []
  for (const p of m.plots) {
    if (which === "straightened") {
      if (p.straightened)
        out.push({ object: p.straightened, name: base(p.straightened) })
      continue
    }
    const frames = which.endsWith("best") ? p.frames.slice(0, 1) : p.frames
    for (const f of frames) {
      if (which.startsWith("crops"))
        out.push({ object: f.crop, name: base(f.crop) })
      else
        out.push({
          object: f.image,
          name: `${plotStem(p)}_frame${f.rank}_${base(f.image)}`,
        })
    }
  }
  return out
}

/** Plots no frame shows (outside the flight, or every view cut off). */
export function unseenPlots(m: PlotFramesManifest): (string | number)[] {
  return m.plots.filter((p) => p.frames.length === 0).map((p) => p.plot)
}

/** Plots whose best frame shows them only in part. */
export function partlySeen(m: PlotFramesManifest): (string | number)[] {
  return m.plots
    .filter((p) => p.frames.length > 0 && p.frames[0].inside < 1)
    .map((p) => p.plot)
}
