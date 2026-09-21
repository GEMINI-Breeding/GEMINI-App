/**
 * React Query hooks for reference dataset access in dashboard widgets.
 */

import { useQueries, useQuery } from "@tanstack/react-query"

function apiUrl(path: string): string {
  const base =
    (window as any).__GEMI_BACKEND_URL__ ?? import.meta.env.VITE_API_URL ?? ""
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
    const error: any = new Error(err.detail ?? `HTTP ${res.status}`)
    error.status = res.status
    throw error
  }
  return res.json()
}

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * Mirrors `ReferenceDatasetOutput` in the backend's rest_api/models.py.
 * Note `dataset_date`, not `date` — the old `/api/v1` surface used `date`,
 * and this type still said so while pointing at a 404, so the mismatch was
 * invisible.
 */
export interface ReferenceDataset {
  id: string
  name: string
  experiment: string | null
  location: string | null
  population: string | null
  dataset_date: string | null
  plot_count: number
  trait_columns: string[]
  created_at: string
}

export interface ReferencePlotRow {
  id: string
  dataset_id: string
  plot_id: string
  col: string | null
  row: string | null
  accession: string | null
  traits: Record<string, number> | null
}

export interface ReferenceAggregate {
  dataset_id: string
  metric: string
  aggregation: string
  value: number | null
  count: number
}

// ── Hooks ──────────────────────────────────────────────────────────────────────

/**
 * All reference datasets (global list — used for the config UI picker).
 *
 * These hooks used to call the old backend's `/api/v1/reference-data/...`
 * paths, which 404 on GEMINIbase, so the query was disabled by default to
 * keep the dashboard mount clean — reference data could be uploaded but was
 * readable nowhere. The routes do exist, just at `/api/reference_data/`
 * with an `/id/` segment, so they are now repointed and enabled.
 */
export function useReferenceDatasets(options: { enabled?: boolean } = {}) {
  return useQuery<ReferenceDataset[]>({
    queryKey: ["reference-datasets"],
    queryFn: () => get<ReferenceDataset[]>("/api/reference_data/"),
    enabled: options.enabled ?? true,
    staleTime: 5 * 60_000,
    retry: (failureCount, error: any) =>
      error?.status !== 404 && failureCount < 2,
  })
}

/** All plots for a dataset (up to 10 000) — for frontend aggregation/temporal use. */
export function useReferencePlots(datasetId: string | null) {
  return useQuery<ReferencePlotRow[]>({
    queryKey: ["reference-plots-all", datasetId],
    queryFn: () =>
      get<{ data: ReferencePlotRow[]; count: number }>(
        `/api/reference_data/id/${datasetId}/plots-all`,
      ).then((r) => r.data),
    enabled: !!datasetId,
    staleTime: 10 * 60_000,
    retry: (failureCount, error: any) =>
      error?.status !== 404 && failureCount < 2,
  })
}

/** SQL aggregate for a single metric across all plots in a dataset. */
export function useReferenceAggregate(
  datasetId: string | null,
  metric: string | null,
  aggregation: "avg" | "min" | "max" = "avg",
) {
  return useQuery<ReferenceAggregate>({
    queryKey: ["reference-aggregate", datasetId, metric, aggregation],
    queryFn: () =>
      get<ReferenceAggregate>(
        `/api/reference_data/id/${datasetId}/aggregate?metric=${encodeURIComponent(metric!)}&aggregation=${aggregation}`,
      ),
    enabled: !!datasetId && !!metric,
    staleTime: 10 * 60_000,
    retry: (failureCount, error: any) =>
      error?.status !== 404 && failureCount < 2,
  })
}

/** Batch-fetch aggregates for multiple (datasetId, metric, aggregation) combos. */
export function useMultiReferenceAggregates(
  requests: Array<{
    datasetId: string
    metric: string
    aggregation: "avg" | "min" | "max"
  }>,
) {
  return useQueries({
    queries: requests.map(({ datasetId, metric, aggregation }) => ({
      queryKey: ["reference-aggregate", datasetId, metric, aggregation],
      queryFn: () =>
        get<ReferenceAggregate>(
          `/api/reference_data/id/${datasetId}/aggregate?metric=${encodeURIComponent(metric)}&aggregation=${aggregation}`,
        ),
      staleTime: 10 * 60_000,
      retry: (failureCount: number, error: any) =>
        error?.status !== 404 && failureCount < 2,
    })),
  })
}
