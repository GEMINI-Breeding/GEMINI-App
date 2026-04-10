/**
 * React Query hooks for reference dataset access in dashboard widgets.
 */

import { useQuery, useQueries } from "@tanstack/react-query"

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
    const error: any = new Error(err.detail ?? `HTTP ${res.status}`)
    error.status = res.status
    throw error
  }
  return res.json()
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ReferenceDataset {
  id: string
  name: string
  experiment: string | null
  location: string | null
  population: string | null
  date: string | null
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

/** All reference datasets (global list — used for the config UI picker). */
export function useReferenceDatasets() {
  return useQuery<ReferenceDataset[]>({
    queryKey: ["reference-datasets"],
    queryFn: () => get<ReferenceDataset[]>("/api/v1/reference-data/"),
    staleTime: 5 * 60_000,
    retry: (failureCount, error: any) => error?.status !== 404 && failureCount < 2,
  })
}

/** All plots for a dataset (up to 10 000) — for frontend aggregation/temporal use. */
export function useReferencePlots(datasetId: string | null) {
  return useQuery<ReferencePlotRow[]>({
    queryKey: ["reference-plots-all", datasetId],
    queryFn: () =>
      get<{ data: ReferencePlotRow[]; count: number }>(
        `/api/v1/reference-data/${datasetId}/plots-all`
      ).then((r) => r.data),
    enabled: !!datasetId,
    staleTime: 10 * 60_000,
    retry: (failureCount, error: any) => error?.status !== 404 && failureCount < 2,
  })
}

/** SQL aggregate for a single metric across all plots in a dataset. */
export function useReferenceAggregate(
  datasetId: string | null,
  metric: string | null,
  aggregation: "avg" | "min" | "max" = "avg"
) {
  return useQuery<ReferenceAggregate>({
    queryKey: ["reference-aggregate", datasetId, metric, aggregation],
    queryFn: () =>
      get<ReferenceAggregate>(
        `/api/v1/reference-data/${datasetId}/aggregate?metric=${encodeURIComponent(metric!)}&aggregation=${aggregation}`
      ),
    enabled: !!datasetId && !!metric,
    staleTime: 10 * 60_000,
    retry: (failureCount, error: any) => error?.status !== 404 && failureCount < 2,
  })
}

/** Batch-fetch aggregates for multiple (datasetId, metric, aggregation) combos. */
export function useMultiReferenceAggregates(
  requests: Array<{ datasetId: string; metric: string; aggregation: "avg" | "min" | "max" }>
) {
  return useQueries({
    queries: requests.map(({ datasetId, metric, aggregation }) => ({
      queryKey: ["reference-aggregate", datasetId, metric, aggregation],
      queryFn: () =>
        get<ReferenceAggregate>(
          `/api/v1/reference-data/${datasetId}/aggregate?metric=${encodeURIComponent(metric)}&aggregation=${aggregation}`
        ),
      staleTime: 10 * 60_000,
      retry: (failureCount: number, error: any) => error?.status !== 404 && failureCount < 2,
    })),
  })
}
