import { OpenAPI } from "@/client"
import { getToken } from "@/lib/auth"

// Mirrors the pattern in traitRecords.ts: the SDK is regenerated lazily, so
// new endpoints are exercised through a thin hand-rolled fetch client until
// `npm run generate-client` is re-run against a live backend.

export type Aggregation = "mean" | "latest" | "max" | "min" | "first" | "date"

export interface MultivariateRequest {
  trait_names: string[]
  experiment_names?: string[]
  season_names?: string[]
  site_names?: string[]
  populations?: string[]
  aggregation: Aggregation
  aggregation_date?: string // ISO date when aggregation === "date"
  collapse_replicates?: boolean
}

export interface MatrixRow {
  plot_id?: string | null
  plot_number?: number | null
  plot_row_number?: number | null
  plot_column_number?: number | null
  experiment_name?: string | null
  season_name?: string | null
  site_name?: string | null
  accession_name?: string | null
  population?: string | null
  values: Record<string, number | null>
}

export interface MatrixResponse {
  status: "ok" | "too_large" | "insufficient_data"
  n_records_fetched: number
  n_rows: number
  trait_names: string[]
  rows: MatrixRow[]
  message?: string | null
}

export interface CorrelationMatrix {
  trait_names: string[]
  matrix: (number | null)[][]
  n: number[][]
}

export interface CorrelationResponse {
  status: "ok" | "too_large" | "insufficient_data"
  n_rows: number
  pearson?: CorrelationMatrix | null
  spearman?: CorrelationMatrix | null
  message?: string | null
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const base = (OpenAPI.BASE ?? "").replace(/\/$/, "")
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let detail = ""
    try {
      const j = await res.json()
      detail = j?.error_description || j?.error || JSON.stringify(j)
    } catch {
      detail = await res.text()
    }
    throw new Error(`${path} ${res.status}: ${detail}`)
  }
  return (await res.json()) as T
}

export function fetchMatrix(req: MultivariateRequest): Promise<MatrixResponse> {
  return postJson<MatrixResponse>("/api/multivariate_analysis/matrix", req)
}

export function fetchCorrelation(
  req: MultivariateRequest,
): Promise<CorrelationResponse> {
  return postJson<CorrelationResponse>(
    "/api/multivariate_analysis/correlation",
    req,
  )
}

export interface SpatialCell {
  plot_row_number: number
  plot_column_number: number
  value: number
  accession_name?: string | null
  plot_number?: number | null
}

export interface SpatialSite {
  site_name?: string | null
  n_cells: number
  min_row: number
  max_row: number
  min_col: number
  max_col: number
  value_min: number
  value_max: number
  cells: SpatialCell[]
}

export interface SpatialResponse {
  status: "ok" | "too_large" | "insufficient_data"
  trait_name: string
  n_records_fetched: number
  sites: SpatialSite[]
  message?: string | null
}

export function fetchSpatial(
  req: MultivariateRequest,
): Promise<SpatialResponse> {
  return postJson<SpatialResponse>(
    "/api/multivariate_analysis/spatial",
    req,
  )
}

export interface AnovaTerm {
  term: string
  df: number
  sum_sq: number
  mean_sq: number
  F: number | null
  p: number | null
  eta_sq: number | null
}

export interface AnovaPanel {
  trait_name: string
  env_label: string
  kind: "one_way" | "two_way"
  n_obs: number
  n_groups: number
  replication_status: "replicated" | "unreplicated" | "insufficient_data"
  terms: AnovaTerm[]
  message?: string | null
}

export interface AnovaResponse {
  status: "ok" | "too_large" | "insufficient_data"
  n_records_fetched: number
  panels: AnovaPanel[]
  message?: string | null
}

export function fetchAnova(
  req: MultivariateRequest,
): Promise<AnovaResponse> {
  return postJson<AnovaResponse>(
    "/api/multivariate_analysis/anova",
    req,
  )
}

export interface BLUP {
  accession_name: string
  blup: number
}

export interface HeritabilityPanel {
  trait_name: string
  env_label: string
  n_obs: number
  n_groups: number
  mean_reps: number
  var_g: number | null
  var_e: number | null
  h2: number | null
  /** Reference value BLUPs are centered on — REML intercept when the
   *  fit converges, arithmetic trait mean for the moment-estimator
   *  fallback. Use as the "average" reference when computing per-
   *  accession deviation. */
  grand_mean: number | null
  convergence_status:
    | "ok"
    | "warning"
    | "failed"
    | "unreplicated"
    | "insufficient_data"
  blups: BLUP[]
  message?: string | null
}

export interface HeritabilityResponse {
  status: "ok" | "too_large" | "insufficient_data"
  n_records_fetched: number
  panels: HeritabilityPanel[]
  message?: string | null
}

export function fetchHeritability(
  req: MultivariateRequest,
): Promise<HeritabilityResponse> {
  return postJson<HeritabilityResponse>(
    "/api/multivariate_analysis/heritability",
    req,
  )
}

export interface PCAScore {
  id: string
  label?: string | null
  accession_name?: string | null
  population?: string | null
  experiment_name?: string | null
  site_name?: string | null
  components: number[]
}

export interface PCALoading {
  trait_name: string
  components: number[]
}

export interface PCAResponse {
  status: "ok" | "too_large" | "insufficient_data"
  n_records_fetched: number
  n_components: number
  explained_variance_ratio: number[]
  scores: PCAScore[]
  loadings: PCALoading[]
  trait_names: string[]
  row_kind: "plot" | "accession"
  message?: string | null
}

export function fetchPCA(req: MultivariateRequest): Promise<PCAResponse> {
  return postJson<PCAResponse>("/api/multivariate_analysis/pca", req)
}

export interface GGEPoint {
  name: string
  pc1: number
  pc2: number
}

export interface GGEResponse {
  status: "ok" | "too_large" | "insufficient_data"
  trait_name: string
  n_records_fetched: number
  n_accessions: number
  n_envs: number
  explained_variance_ratio: number[]
  accession_scores: GGEPoint[]
  env_scores: GGEPoint[]
  polygon: string[]
  message?: string | null
}

export function fetchGGE(req: MultivariateRequest): Promise<GGEResponse> {
  return postJson<GGEResponse>("/api/multivariate_analysis/gge", req)
}

export interface ManovaStat {
  name: string
  value: number
  df_num: number
  df_denom: number
  F: number | null
  p: number | null
}

export interface ManovaPanel {
  env_label: string
  kind: "one_way" | "two_way"
  n_obs: number
  n_groups: number
  n_traits: number
  replication_status: "replicated" | "unreplicated" | "insufficient_data"
  terms: Record<string, ManovaStat[]>
  message?: string | null
}

export interface ManovaResponse {
  status: "ok" | "too_large" | "insufficient_data"
  n_records_fetched: number
  trait_names: string[]
  panels: ManovaPanel[]
  message?: string | null
}

export function fetchManova(
  req: MultivariateRequest,
): Promise<ManovaResponse> {
  return postJson<ManovaResponse>("/api/multivariate_analysis/manova", req)
}
