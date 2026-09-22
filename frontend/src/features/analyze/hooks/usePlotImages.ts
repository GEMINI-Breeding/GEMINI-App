/**
 * Locate the per-plot PNGs that SPLIT_ORTHOMOSAIC writes, so the Analyze
 * map can show a plot's image when the user clicks it.
 *
 * The geo worker writes to
 *   `Processed/{season}/{exp}/{site}/{population}/{date}/{platform}/{sensor}/PlotImages/`
 * naming each file `plot_{n}_accession_{name}.png`.
 *
 * We index by plot number rather than reconstructing the filename: the
 * accession segment comes from the boundary feature's properties at split
 * time, so it can be "unknown", can contain characters the worker rewrote
 * (`/` and spaces become `_`), and can disagree with whatever the trait
 * records call that accession. Plot number is the stable part.
 *
 * The Analyze scope has no date/platform/sensor — a season+site may hold
 * several flights — so we list the whole experiment-scope prefix and accept
 * every PlotImages/ directory under it, newest last. Later flights
 * therefore win for a given plot, which is the behaviour a user expects
 * from "show me this plot".
 */
import { useQuery } from "@tanstack/react-query"

import { type FileMetadata, FilesService } from "@/client"
import { isLoggedIn } from "@/lib/auth"

const DEFAULT_BUCKET = "gemini"

/** `plot_12_accession_CB27.png` -> 12. Null when the name doesn't match. */
export function plotNumberFromImageName(objectName: string): number | null {
  const base = objectName.split("/").pop() ?? ""
  const m = base.match(/^plot_(\d+)(?:_|\.)/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

/**
 * Map of plot number -> MinIO object path, built from a file listing.
 * Exported for tests; the hook wraps it.
 */
export function indexPlotImages(files: FileMetadata[]): Map<number, string> {
  const byPlot = new Map<number, string>()
  const relevant = files
    .map((f) => f.object_name ?? "")
    .filter((n) => n.includes("/PlotImages/") && /\.(png|jpe?g)$/i.test(n))
    // Stable order so "last wins" is deterministic rather than dependent
    // on whatever order the listing came back in.
    .sort()
  for (const name of relevant) {
    const plot = plotNumberFromImageName(name)
    if (plot !== null) byPlot.set(plot, name)
  }
  return byPlot
}

/**
 * Plot images for an Analyze scope. `prefix` is the Processed/ path down to
 * the population (no trailing date), e.g.
 * `Processed/2024/MyExp/Davis/Cowpea/`.
 */
export function usePlotImages(prefix: string | null) {
  return useQuery<Map<number, string>, Error>({
    queryKey: ["analyze", "plot-images", prefix],
    queryFn: async () => {
      if (!prefix) return new Map()
      const res = await FilesService.apiFilesListFilePathListFiles({
        filePath: `${DEFAULT_BUCKET}/${prefix}`,
      })
      return indexPlotImages((res as FileMetadata[] | null) ?? [])
    },
    enabled: isLoggedIn() && Boolean(prefix),
    staleTime: 60_000,
  })
}
