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
 * One recursive listing of everything under a population's Processed/
 * prefix. Plot images and ortho underlays both derive from it, so the map
 * makes a single request for both.
 */
function populationListingQuery(prefix: string | null) {
  return {
    queryKey: ["analyze", "population-listing", prefix],
    queryFn: async (): Promise<FileMetadata[]> => {
      if (!prefix) return []
      const res = await FilesService.apiFilesListFilePathListFiles({
        filePath: `${DEFAULT_BUCKET}/${prefix}`,
      })
      return (res as FileMetadata[] | null) ?? []
    },
    enabled: isLoggedIn() && Boolean(prefix),
    staleTime: 60_000,
  }
}

/**
 * Plot images for an Analyze scope. `prefix` is the Processed/ path down to
 * the population (no trailing date), e.g.
 * `Processed/2024/MyExp/Davis/Cowpea/`.
 */
export function usePlotImages(prefix: string | null) {
  return useQuery({
    ...populationListingQuery(prefix),
    select: indexPlotImages,
  })
}

export interface OrthoUnderlay {
  /** `{date} · {platform}/{sensor}` — what the picker shows. */
  label: string
  /** s3:// URL TiTiler reads. The COG (`-Pyramid`) sibling when present. */
  s3Url: string
  date: string
}

/**
 * ODM orthomosaics under a population prefix, newest flight first, at most
 * one per (date, platform, sensor) folder — the newest file in it.
 *
 * Prefers the `-Pyramid.tif` COG sibling: TiTiler tile reads against the
 * pyramid are much faster than against the source (same rule as
 * activeOrtho.s3UrlForOrtho).
 */
export function orthosFromListing(
  files: FileMetadata[],
  withPopulation = false,
): OrthoUnderlay[] {
  const names = new Set(files.map((f) => f.object_name ?? ""))
  const byFolder = new Map<string, { name: string; modified: string }>()
  for (const f of files) {
    const name = f.object_name ?? ""
    const base = name.split("/").pop() ?? ""
    if (!/^odm_orthophoto.*\.tiff?$/i.test(base)) continue
    if (base.includes("-Pyramid.")) continue
    const folder = name.slice(0, name.length - base.length)
    const modified = f.last_modified ?? ""
    const prev = byFolder.get(folder)
    if (!prev || modified > prev.modified)
      byFolder.set(folder, { name, modified })
  }
  const out: OrthoUnderlay[] = []
  for (const [folder, { name }] of byFolder) {
    // .../{pop}/{date}/{platform}/{sensor}/
    const parts = folder.split("/").filter(Boolean)
    const [population, date, platform, sensor] = parts.slice(-4)
    const pyramid = name.replace(/\.tiff?$/i, "-Pyramid.tif")
    const chosen = names.has(pyramid) ? pyramid : name
    out.push({
      label: `${date} · ${platform}/${sensor}${withPopulation ? ` · ${population}` : ""}`,
      s3Url: `s3://${DEFAULT_BUCKET}/${chosen}`,
      date: date ?? "",
    })
  }
  return out.sort((a, b) => b.date.localeCompare(a.date))
}

/**
 * Orthomosaics under `prefix`: a population prefix, or a site prefix
 * (`withPopulation`) when no population is picked, in which case each
 * label also names its population.
 */
export function usePopulationOrthos(
  prefix: string | null,
  withPopulation = false,
) {
  return useQuery({
    ...populationListingQuery(prefix),
    select: (files: FileMetadata[]) => orthosFromListing(files, withPopulation),
  })
}
