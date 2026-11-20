/**
 * Plot images from a ground track's raw frames (GROUND_PLOT_FRAMES, in the
 * geo worker): each marked plot's frames that do not overlap (tiles/) and
 * its middle one (straightened/), under the run's PlotFrames/ folder.
 */
import { authHeaders } from "@/components/Common/PlotImage"
import { apiUrl, DEFAULT_BUCKET } from "@/features/files/lib/download"

export interface GroundFramesPlot {
  marked_plot: number
  plot?: string
  accession?: string
  properties?: Record<string, unknown>
  named_by?: string
  frames?: string[]
  tiles?: string[]
  straightened?: string
  error?: string
}

export interface GroundFramesManifest {
  source: "ground_frames"
  plots: GroundFramesPlot[]
}

export async function readGroundFrames(
  manifestPath: string,
): Promise<GroundFramesManifest | null> {
  try {
    const res = await fetch(
      apiUrl(`/api/files/download/${DEFAULT_BUCKET}/${manifestPath}`),
      { headers: authHeaders() },
    )
    if (!res.ok) return null
    const doc = (await res.json()) as { source?: string }
    return doc?.source === "ground_frames"
      ? (doc as GroundFramesManifest)
      : null
  } catch {
    return null
  }
}

/** The plots of a ground-frames run as features with their properties
 *  (no geometry): what the counts are filed under when the run has no plot
 *  boundaries (plots named from a field design). */
export async function groundFramesPlots(
  manifestPath: string,
): Promise<GeoJSON.FeatureCollection | undefined> {
  const m = await readGroundFrames(manifestPath)
  if (!m) return undefined
  const features = m.plots
    .filter((p) => !p.error)
    .map((p) => ({
      type: "Feature" as const,
      geometry: null as unknown as GeoJSON.Geometry,
      properties: { ...(p.properties ?? {}), plot: p.plot },
    }))
  return features.length ? { type: "FeatureCollection", features } : undefined
}
