/** Typed fetch wrappers for the /analyze backend endpoints. */

function apiUrl(path: string): string {
  const base = (window as any).__GEMI_BACKEND_URL__ ?? import.meta.env.VITE_API_URL ?? ""
  return base ? `${base}${path}` : path
}

function authHeaders() {
  const token = localStorage.getItem("access_token") || ""
  return { Authorization: `Bearer ${token}` }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path), { headers: authHeaders() })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? `HTTP ${res.status}`)
  }
  return res.json()
}

// ── Legacy run-based types (used by AnalyzeRun detail page) ───────────────────

export interface AnalyzableRun {
  run_id: string
  pipeline_id: string
  pipeline_name: string
  pipeline_type: "aerial" | "ground"
  workspace_name: string
  date: string
  experiment: string
  location: string
  population: string
  platform: string
  sensor: string
  status: string
  available: string[]
  created_at: string
}

export interface TraitsResponse {
  geojson: GeoJSON.FeatureCollection
  metric_columns: string[]
  feature_count: number
}

export interface OrthoInfoResponse {
  available: boolean
  path: string | null
  bounds: [[number, number], [number, number]] | null
  /** Downscaled JPEG preview endpoint (much faster than serving the full TIF) */
  preview_url?: string | null
}

// ── TraitRecord — versioned provenance for each extraction ───────────────────

export interface TraitRecord {
  id: string
  run_id: string
  pipeline_id: string
  pipeline_name: string
  pipeline_type: "aerial" | "ground"
  workspace_id: string
  workspace_name: string
  date: string
  experiment: string
  location: string
  population: string
  platform: string
  sensor: string
  /** Sequential extraction version within this run (1-based) */
  version: number
  /** Ortho version number used (aerial only) */
  ortho_version: number | null
  /** User-given name for that ortho version, if any */
  ortho_name: string | null
  /** Stitch version number used (ground only) */
  stitch_version: number | null
  /** User-given name for that stitch version, if any */
  stitch_name: string | null
  /** Boundary version number used (null = canonical file) */
  boundary_version: number | null
  /** User-given name for that boundary version, if any */
  boundary_name: string | null
  plot_count: number
  trait_columns: string[]
  created_at: string
}

// ── API calls ─────────────────────────────────────────────────────────────────

export const analyzeApi = {
  // Legacy run-based (used by AnalyzeRun detail page)
  listRuns: () => get<AnalyzableRun[]>("/api/v1/analyze/runs"),
  getTraits: (runId: string) => get<TraitsResponse>(`/api/v1/analyze/runs/${runId}/traits`),
  getOrthoInfo: (runId: string) => get<OrthoInfoResponse>(`/api/v1/analyze/runs/${runId}/ortho-info`),

  // Trait record provenance
  listTraitRecords: () => get<TraitRecord[]>("/api/v1/analyze/trait-records"),
  listTraitRecordsByRun: (runId: string) =>
    get<TraitRecord[]>(`/api/v1/analyze/trait-records?run_id=${runId}`),
  getTraitRecordGeojson: (id: string) => get<TraitsResponse>(`/api/v1/analyze/trait-records/${id}/geojson`),
  getTraitRecordOrthoInfo: (id: string) => get<OrthoInfoResponse>(`/api/v1/analyze/trait-records/${id}/ortho-info`),
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format a version number + optional name as "v1 — My Name" or just "v1". */
export function versionLabel(version: number | null, name: string | null | undefined): string {
  if (version == null) return "—"
  const v = `v${version}`
  return name ? `${v} — ${name}` : v
}
