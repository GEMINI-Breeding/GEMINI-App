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

/**
 * Basename prefix for RUN_ODM outputs. The worker writes
 *   `odm_orthophoto-{job_id}.tif`
 * per run so re-runs don't overwrite prior versions; legacy runs may have
 * the unversioned `odm_orthophoto.tif`. Both are detected by this prefix.
 */
const ORTHO_BASENAME_PREFIX = "odm_orthophoto"

/** The CREATE_COG worker writes `{base}-Pyramid{ext}` next to the source TIF. */
function cogSiblingName(orthoFilename: string): string {
  return orthoFilename.replace(/\.tiff?$/i, "-Pyramid.tif")
}

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
  const knownFilenames = new Set<string>()
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
      hasCog: filesByName.has(cogSiblingName(m.filename)),
    })
    knownFilenames.add(m.filename)
  }
  // Synthesize a fallback entry for any `odm_orthophoto*.tif` on disk
  // that has no metadata. Covers legacy runs (pre-versioned filenames)
  // and the brief window after a RUN_ODM completes but before the
  // outputs.versions append has landed in runStore.
  for (const f of files) {
    const name = f.object_name ?? ""
    const basename = name.split("/").pop() ?? ""
    if (!basename.startsWith(ORTHO_BASENAME_PREFIX)) continue
    if (!isOrthoTif(basename)) continue
    if (knownFilenames.has(basename)) continue
    versions.push({
      version: 0,
      filename: basename,
      path: defaultProcessedPath(basename),
      label: null,
      source: "RUN_ODM",
      createdAt: lastModifiedByName.get(basename) ?? null,
      hasCog: filesByName.has(cogSiblingName(basename)),
    })
    knownFilenames.add(basename)
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

/**
 * Build an OrthoVersionMeta entry from a completed RUN_ODM JobOutput and
 * append it to `existing`, returning the merged array. Returns null when
 * the job didn't produce an orthophoto_path, or when a meta entry with
 * the same jobId is already present (idempotent — both the WS terminal
 * frame and the periodic poll in RunDetail can call this for the same
 * job, and only the first should land).
 */
export function mergeOrthoVersionFromJobResult(
  existing: OrthoVersionMeta[],
  job:
    | {
        id?: string | number | null
        result?: Record<string, unknown> | null
        completed_at?: string | null
      }
    | null
    | undefined,
): OrthoVersionMeta[] | null {
  if (!job) return null
  const result = job.result ?? null
  if (!result || typeof result !== "object") return null
  const orthoPath = (result as { orthophoto_path?: unknown }).orthophoto_path
  if (typeof orthoPath !== "string" || orthoPath === "") return null
  const jobId = job.id != null ? String(job.id) : undefined
  if (jobId && existing.some((m) => m.jobId === jobId)) return null
  const filename = orthoPath.split("/").pop() ?? orthoPath
  const meta: OrthoVersionMeta = {
    filename,
    path: `${DEFAULT_BUCKET}/${orthoPath}`,
    source: "RUN_ODM",
    jobId,
    createdAt: job.completed_at ?? new Date().toISOString(),
  }
  return [...existing, meta]
}
