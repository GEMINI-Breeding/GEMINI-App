/**
 * orthoVersions — derive the per-Run orthomosaic version list.
 *
 * Main read `GET /pipeline-runs/{id}/orthomosaics` which returned a
 * server-side OrthoVersion[]. GEMINIbase has no equivalent — orthos are
 * just files at `Processed/{scope}/odm_orthophoto.tif` (and rotated
 * sibling files for re-runs). We synthesize the list client-side by:
 *
 *   1. Listing `Processed/{scope}/` via FilesService.
 *   2. Filtering for the orthomosaic TIF (and excluding `-Pyramid` COGs).
 *   3. Joining with the Run's RUN_ODM job ids + import-ortho registrations
 *      so each version carries a label, source, and createdAt timestamp.
 *
 * Renames and import-ortho registrations live in runStore under
 * `Run.steps.orthomosaic.outputs.versions`. The actual TIF files on disk
 * are the source of truth for "which versions exist"; outputs is where
 * the *metadata* (rename label, import flag) lives.
 */
import type { FileMetadata } from "@/client"

import type { AerialScope } from "@/features/process/lib/paths"
import { processedPrefix } from "@/features/process/lib/paths"
import type { Run } from "@/features/process/lib/runStore"

export interface OrthoVersionMeta {
  /** Filename of the .tif (e.g. `odm_orthophoto.tif`). */
  filename: string
  /**
   * Path the file lives at, MinIO-style and including the leading bucket
   * segment (e.g. `gemini/Processed/2026/.../odm_orthophoto.tif` for ODM
   * outputs, `gemini/Raw/2026/.../Orthomosaic/foo.tif` for imports).
   * Optional for backward-compat: pre-R4b RUN_ODM entries default to the
   * Processed/{scope}/odm_orthophoto.tif layout in `buildOrthoVersions`.
   */
  path?: string
  /** User-applied display name; falls back to `v{n}` in the UI. */
  label?: string
  /** "RUN_ODM" job id when generated, undefined for imported orthos. */
  jobId?: string
  /** Source provenance: "RUN_ODM" or "imported". */
  source: "RUN_ODM" | "imported"
  /** When the version was registered in runStore (ISO). */
  createdAt: string
}

export interface OrthoVersion {
  /** 1-based index, newest first. Stable across reloads because it derives
   *  from the run's outputs.versions array order. */
  version: number
  filename: string
  /** Full MinIO path including the bucket prefix (e.g. `gemini/Processed/...`). */
  path: string
  label: string | null
  source: "RUN_ODM" | "imported"
  jobId?: string
  createdAt: string | null
  /** True when the corresponding `-Pyramid.tif` COG exists alongside it. */
  hasCog: boolean
}

const DEFAULT_BUCKET = "gemini"

/** The ortho TIFs the geo worker writes alongside RUN_ODM. */
const ORTHO_FILENAME = "odm_orthophoto.tif"
const COG_FILENAME = "odm_orthophoto-Pyramid.tif"

export function readOrthoOutputs(run: Run | undefined): OrthoVersionMeta[] {
  const outs = run?.steps?.orthomosaic?.outputs as
    | { versions?: OrthoVersionMeta[] }
    | undefined
  return outs?.versions ?? []
}

/**
 * Synthesize OrthoVersion[] from a runStore Run + a directory listing.
 * Returned newest-first (highest version number first).
 *
 * The `files` argument should contain the listings from any prefixes the
 * user might have orthos at (typically Processed/{scope}/ for RUN_ODM
 * outputs and Raw/{scope}/Orthomosaic/ for imports).
 */
export function buildOrthoVersions(
  run: Run | undefined,
  scope: AerialScope | null,
  files: FileMetadata[],
): OrthoVersion[] {
  if (!scope) return []
  const prefix = processedPrefix(scope)
  const defaultProcessedPath = (filename: string) =>
    `${DEFAULT_BUCKET}/${prefix}${filename}`
  const meta = readOrthoOutputs(run)

  // Index every file by basename + full object_name, and capture each
  // file's MinIO last_modified so the "Created" column can fall back to
  // the on-disk timestamp when no runStore metadata is recorded.
  const filesByName = new Set<string>()
  const filesByPath = new Set<string>()
  const lastModifiedByName = new Map<string, string>()
  const lastModifiedByPath = new Map<string, string>()
  for (const f of files) {
    const name = f.object_name ?? ""
    const basename = name.split("/").pop() ?? ""
    filesByName.add(basename)
    filesByPath.add(name)
    const lm = (f as { last_modified?: string }).last_modified
    if (lm) {
      lastModifiedByName.set(basename, lm)
      lastModifiedByPath.set(name, lm)
    }
  }
  const cogPresent = filesByName.has(COG_FILENAME)
  const orthoPresent = filesByName.has(ORTHO_FILENAME)

  function metaExists(m: OrthoVersionMeta): boolean {
    if (m.path) {
      const relative = m.path.replace(/^[^/]+\//, "")
      return filesByPath.has(relative)
    }
    return filesByName.has(m.filename)
  }

  function lastModifiedFor(m: OrthoVersionMeta): string | null {
    if (m.path) {
      const relative = m.path.replace(/^[^/]+\//, "")
      return lastModifiedByPath.get(relative) ?? null
    }
    return lastModifiedByName.get(m.filename) ?? null
  }

  const versions: OrthoVersion[] = []
  for (const m of meta) {
    if (!metaExists(m)) continue
    const path = m.path ?? defaultProcessedPath(m.filename)
    versions.push({
      version: 0,
      filename: m.filename,
      path,
      label: m.label ?? null,
      source: m.source,
      jobId: m.jobId,
      // Prefer the runStore metadata's createdAt (set when the user
      // imports / when R4a's job submission writes one); fall back to
      // MinIO's last_modified for legacy on-disk files we never recorded.
      createdAt: m.createdAt ?? lastModifiedFor(m),
      hasCog: m.filename === ORTHO_FILENAME && cogPresent,
    })
  }
  if (orthoPresent && !meta.some((m) => m.filename === ORTHO_FILENAME)) {
    versions.push({
      version: 0,
      filename: ORTHO_FILENAME,
      path: defaultProcessedPath(ORTHO_FILENAME),
      label: null,
      source: "RUN_ODM",
      createdAt: lastModifiedByName.get(ORTHO_FILENAME) ?? null,
      hasCog: cogPresent,
    })
  }

  versions.sort((a, b) => {
    const aMs = a.createdAt ? Date.parse(a.createdAt) : 0
    const bMs = b.createdAt ? Date.parse(b.createdAt) : 0
    return bMs - aMs
  })
  versions.forEach((v, i) => {
    v.version = versions.length - i
  })
  return versions
}

export function isOrthoTif(name: string): boolean {
  return /\.tif?f$/i.test(name) && !/-Pyramid\.tif?f$/i.test(name)
}
