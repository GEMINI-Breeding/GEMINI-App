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

/** A plot in one of another camera's frames (a thermal camera beside the RGB one). */
export interface CompanionFrame {
  rank: number
  /** The other camera's raw frame. */
  image: string
  /** The RGB frame taken with it. */
  rgb_frame: string
  seconds_from_rgb: number
  inside: number
  off_nadir_deg: number
  gsd_cm: number
  /** The plot's values (°C for a thermal camera), when the frame holds values. */
  crop?: string
  /** The same crop, coloured, to look at. */
  crop_preview: string
  aligned?: { by: "frame" | "flight"; score: number | null; shift_px?: number }
}

/** A plot's temperature from a thermal camera: over its plants (found in the RGB view). */
export interface CanopyTemperature {
  canopy_mean_c?: number
  canopy_median_c?: number
  canopy_iqr_c?: number
  soil_mean_c?: number
  plant_share: number
  plant_cells: number
  seen_cells: number
  /** Which thermal cells count as plant: ">= 0.8 with neighbours", … */
  plant_cells_rule?: string
}

export interface CompanionView {
  frames: CompanionFrame[]
  /** Top-down view of the best frame: values (.tif) and coloured (.png). */
  straightened?: string
  straightened_preview?: string
  canopy?: CanopyTemperature
  /** Share of the plot the pieced-together view covers (1 = all of it). */
  cover?: number
  /** Frames the view is pieced together from (this camera sees less ground). */
  frames_pieced?: number
  /** Each filling frame's offset to the best one (°C), levelled away. */
  levelled_c?: number[]
}

/** What the job did with another camera of the flight. */
export interface CompanionSection {
  /** That camera's frames uploaded for this date. */
  frames: number
  matched?: number
  of_rgb_frames?: number
  max_seconds_apart?: number
  alignment?: {
    k: number
    x0: number
    y0: number
    pairs_used: number
    pairs_tried: number
    spread_px: number
    score: number
  }
  frames_aligned_on_their_own?: number
  /** "temperature (°C)" or "image (no temperatures)". */
  values?: string
  plots_seen?: number
  canopy_temperature_plots?: number
  /** Where its files are: …/PlotFrames/{Sensor}/. */
  prefix?: string
  traits?: string
  /** The colour scale of the previews (°C). */
  preview_window?: [number, number]
  plot_cover_median?: number
  error?: string
  trait_error?: string
}

export interface PlotFramesEntry {
  plot: string | number
  accession: string
  ground_z: number
  /** The best frame warped to a top-down view of the plot. */
  straightened: string | null
  frames: PlotFrame[]
  /** The same plot from the flight's other cameras, by sensor. */
  companions?: Record<string, CompanionView>
}

export interface PlotFramesManifest {
  orthomosaics: string[]
  crs: string
  frames_per_plot: number
  /** Where the ground heights came from: "dsm", "takeoff height". */
  ground: string[]
  /** The sensor the frames are from (the boundaries' orthomosaic's). */
  sensor?: string
  companions?: Record<string, CompanionSection>
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

/** The other cameras that gave plot images (thermal, …), in name order. */
export function companionSensors(m: PlotFramesManifest): string[] {
  return Object.entries(m.companions ?? {})
    .filter(([, s]) => (s.plots_seen ?? 0) > 0)
    .map(([name]) => name)
    .sort()
}

/** "All" = the frames' own sensor and every other camera, each in its own folder. */
export const ALL_SENSORS = "*"

/** The files of one download, each with its name in the zip. ``sensor``: the
 * frames' own (default), another camera's, or ALL_SENSORS. Another camera's
 * crops and straightened views come as values (.tif, °C) and coloured. */
export function framesDownload(
  m: PlotFramesManifest,
  which: FramesDownload,
  sensor?: string,
): { object: string; name: string }[] {
  const own = m.sensor ?? "RGB"
  if (sensor === ALL_SENSORS) {
    return [own, ...companionSensors(m)].flatMap((s) =>
      framesDownload(m, which, s).map((e) => ({
        ...e,
        name: `${s}/${e.name}`,
      })),
    )
  }
  if (sensor && sensor !== own) return companionDownload(m, which, sensor)
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

function companionDownload(
  m: PlotFramesManifest,
  which: FramesDownload,
  sensor: string,
): { object: string; name: string }[] {
  const out: { object: string; name: string }[] = []
  const add = (object: string | undefined) => {
    if (object) out.push({ object, name: base(object) })
  }
  for (const p of m.plots) {
    const v = p.companions?.[sensor]
    if (!v) continue
    if (which === "straightened") {
      add(v.straightened)
      add(v.straightened_preview)
      continue
    }
    const frames = which.endsWith("best") ? v.frames.slice(0, 1) : v.frames
    for (const f of frames) {
      if (which.startsWith("crops")) {
        add(f.crop)
        add(f.crop_preview)
      } else
        out.push({
          object: f.image,
          name: `${plotStem(p)}_frame${f.rank}_${base(f.image)}`,
        })
    }
  }
  return out
}

/** Each plot's canopy temperature from a thermal camera, in plot order. */
export interface PlotCanopy {
  plot: string | number
  accession: string
  c: CanopyTemperature
  cover?: number
  pieced?: number
}

export function canopyTemperatures(
  m: PlotFramesManifest,
  sensor: string,
): PlotCanopy[] {
  const out: PlotCanopy[] = []
  for (const p of m.plots) {
    const v = p.companions?.[sensor]
    if (v?.canopy?.canopy_mean_c == null) continue
    out.push({
      plot: p.plot,
      accession: p.accession,
      c: v.canopy,
      cover: v.cover,
      pieced: v.frames_pieced,
    })
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
