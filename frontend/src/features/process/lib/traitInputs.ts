/**
 * Optional rasters for trait extraction: the DEM that gives canopy height
 * and the thermal orthomosaic that gives canopy temperature.
 *
 * Paths returned here are MinIO object names without the bucket, which is
 * what the EXTRACT_TRAITS worker takes.
 */
import type { FileMetadata } from "@/client"
import type { OrthoVersion } from "./orthoVersions"

export interface RasterOption {
  path: string
  label: string
}

const stripBucket = (p: string) => p.replace(/^gemini\//, "")

function tifs(files: FileMetadata[]): string[] {
  return files
    .map((f) => f.object_name ?? "")
    .filter((n) => /\.tiff?$/i.test(n) && !/-Pyramid\.tiff?$/i.test(n))
}

/** Every DEM in scope: ODM DSMs and DEMs uploaded beside imported orthos. */
export function demOptions(files: FileMetadata[]): RasterOption[] {
  return tifs(files)
    .filter((n) => {
      const base = n.split("/").pop() ?? ""
      return /^odm_dsm/i.test(base) || n.includes("/Orthomosaic-DEM/")
    })
    .map((n) => ({
      path: n,
      label: n.includes("/Orthomosaic-DEM/")
        ? `Uploaded DEM · ${n.split("/").pop()}`
        : `ODM surface model · ${n.split("/").pop()}`,
    }))
}

/**
 * The DEM that belongs to `ortho`: an ODM run's DSM carries the same job-id
 * suffix (`odm_orthophoto-<id>.tif` ↔ `odm_dsm-<id>.tif`); an imported
 * ortho uses the DEM picked when it was imported. null when there is none.
 */
export function demForOrtho(
  ortho: OrthoVersion | undefined,
  files: FileMetadata[],
  importedDemPath?: string | null,
): string | null {
  if (!ortho) return null
  if (ortho.source === "imported") return importedDemPath ?? null
  const orthoPath = stripBucket(ortho.path)
  const folder = orthoPath.slice(0, orthoPath.lastIndexOf("/") + 1)
  const suffix = (ortho.filename.match(/^odm_orthophoto(.*)\.tiff?$/i) ?? [])[1]
  if (suffix === undefined) return null
  const want = `${folder}odm_dsm${suffix}.tif`
  return tifs(files).includes(want) ? want : null
}

/**
 * Thermal orthomosaic candidates: orthomosaics of the same flight date from
 * any sensor — uploaded ones (`…/{sensor}/Orthomosaic/`) and ODM outputs —
 * other than the RGB ortho being measured. Labelled by platform/sensor so a
 * thermal camera is easy to spot.
 */
export function thermalOptions(
  files: FileMetadata[],
  rgbOrthoPath: string | null,
): RasterOption[] {
  const rgb = rgbOrthoPath ? stripBucket(rgbOrthoPath) : null
  return tifs(files)
    .filter((n) => n !== rgb)
    .filter((n) => {
      const base = n.split("/").pop() ?? ""
      return n.includes("/Orthomosaic/") || /^odm_orthophoto/i.test(base)
    })
    .map((n) => {
      const parts = n.split("/")
      const i = parts.indexOf("Orthomosaic")
      // …/{platform}/{sensor}/Orthomosaic/file or …/{platform}/{sensor}/odm_…
      const sensorIdx = i >= 0 ? i - 1 : parts.length - 2
      const platform = parts[sensorIdx - 1] ?? ""
      const sensor = parts[sensorIdx] ?? ""
      return { path: n, label: `${platform}/${sensor} · ${parts.at(-1)}` }
    })
}
