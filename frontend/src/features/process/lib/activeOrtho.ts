/**
 * activeOrtho — pick the ortho version to display on a map and build the
 * s3:// URL TiTiler needs to serve it.
 *
 * Defaults to the newest version (matches OrthoVersionsPanel's ordering).
 * When a version has a `-Pyramid.tif` COG sibling, that's used instead of
 * the source TIF — TiTiler tile reads against the pyramid build are much
 * faster than against the source.
 */
import type { FileMetadata } from "@/client"
import {
  buildOrthoVersions,
  type OrthoVersion,
} from "@/features/process/lib/orthoVersions"
import type { AerialScope } from "@/features/process/lib/paths"
import type { Run } from "@/features/process/lib/runStore"

export function resolveActiveOrtho(
  run: Run | undefined,
  scope: AerialScope | null,
  files: FileMetadata[],
): OrthoVersion | null {
  return buildOrthoVersions(run, scope, files)[0] ?? null
}

/**
 * Build the s3:// URL TiTiler needs. The version's `path` already starts
 * with the bucket segment (e.g. `gemini/Processed/.../odm_orthophoto.tif`).
 * Prefer the COG sibling when present.
 */
export function s3UrlForOrtho(v: OrthoVersion): string {
  const path = v.hasCog ? v.path.replace(/\.tiff?$/i, "-Pyramid.tif") : v.path
  return `s3://${path}`
}

/**
 * Build the Leaflet XYZ tile-URL template for a TiTiler-served COG.
 *
 * Built explicitly with `encodeURIComponent` rather than reused from
 * tilejson's `tiles[0]` because TiTiler 2.0.1 emits the s3 URL with `+`
 * substituted for spaces (form-encoded query convention). When the
 * browser/proxy round-trip that URL, S3 receives literal `+` rather than
 * spaces and 404s on object keys with spaces (e.g. "Cowpea MAGIC").
 * `encodeURIComponent` always uses `%20`, which S3 decodes correctly.
 */
export function buildTitilerTileUrl(s3Url: string): string {
  return `/titiler/cog/tiles/WebMercatorQuad/{z}/{x}/{y}?url=${encodeURIComponent(s3Url)}&tilesize=256`
}
