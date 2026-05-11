/**
 * Types + helpers for GWAS job results.
 *
 * The worker (backend/gemini/workers/gwas/worker.py) writes the full
 * GwasResult shape into job.result. SDK types it as JSONB; cast once
 * here and downstream consumers see a typed shape.
 */
import type { JobOutput } from "@/client"

export type GwasStatusVariant = "default" | "secondary" | "destructive" | "outline"

export interface GwasArtifacts {
  manhattan?: string
  qq?: string
  /** Worker-rendered kinship heatmap PNG (hierarchically clustered). */
  kinship_heatmap?: string
  assoc?: string
  kinship?: string
  qc_log?: string
  pca_eigenvec?: string
  covar?: string
  result_json?: string
  qc_bed?: string
  qc_bim?: string
  qc_fam?: string
  [k: string]: string | undefined
}

export interface GwasTopHit {
  rs: string
  chr?: number | null
  pos?: number | null
  p: number
  beta?: number
  se?: number
  af?: number
}

export interface GwasResult {
  artifacts?: GwasArtifacts
  study_id?: string | number
  study_name?: string
  trait_ids?: Array<string | number>
  model?: string
  lmm_test?: string
  n_pcs_used?: number
  n_variants_input?: number
  n_variants_passed_qc?: number
  n_samples_input?: number
  n_samples_passed_qc?: number
  n_samples_with_phenotype?: number
  genomic_inflation_lambda?: number
  n_genome_wide_sig?: number
  n_suggestive?: number
  n_bonferroni_sig?: number
  bonferroni_threshold?: number
  p_column?: string
  top_hits?: GwasTopHit[]
}

export function parseGwasResult(job: JobOutput | null | undefined): GwasResult | null {
  if (!job || !job.result || typeof job.result !== "object") return null
  return job.result as unknown as GwasResult
}

export function parseProgressDetail(
  job: JobOutput | null | undefined,
): Record<string, unknown> | null {
  if (!job?.progress_detail || typeof job.progress_detail !== "object") return null
  return job.progress_detail as Record<string, unknown>
}

/**
 * Convert "s3://gemini/gwas/<id>/manhattan.png" →
 * "/api/files/download/gemini/gwas/<id>/manhattan.png". Returns null
 * when the input is not an s3:// URL we recognise.
 */
export function s3UrlToDownload(s3: unknown): string | null {
  if (typeof s3 !== "string") return null
  const m = s3.match(/^s3:\/\/([^/]+)\/(.+)$/)
  if (!m) return null
  const [, bucket, key] = m
  return `/api/files/download/${bucket}/${key}`
}

export function statusVariant(
  status: string | null | undefined,
): GwasStatusVariant {
  switch (String(status ?? "").toLowerCase()) {
    case "completed":
      return "default"
    case "failed":
    case "cancelled":
      return "destructive"
    case "running":
      return "secondary"
    default:
      return "outline"
  }
}

/**
 * Human-readable stage label for a job row.
 *
 * `progress_detail.stage` is set by the worker at each checkpoint
 * (`extract_genotypes`, `qc`, `pca`, `kinship`, `association`, `plot`,
 * `upload`, etc). When a job hits a terminal state we don't want the
 * UI to keep showing the last in-flight stage — "upload" next to a
 * COMPLETED badge reads like the job is still working. Override with
 * a state-appropriate label instead.
 */
export function displayStage(
  status: string | null | undefined,
  stage: string | null | undefined,
): string {
  switch (String(status ?? "").toLowerCase()) {
    case "completed":
      return "Finished"
    case "failed":
      return "Failed"
    case "cancelled":
      return "Cancelled"
    default:
      return stage && stage.length > 0 ? stage : "—"
  }
}
