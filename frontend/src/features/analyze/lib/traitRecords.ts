import { OpenAPI, type TraitRecordOutput } from "@/client"
import { getToken } from "@/lib/auth"

/**
 * The `/api/traits/id/{trait_id}/records` endpoint streams NDJSON, but
 * the regenerated SDK is configured with `responseHeader: 'content-length'`
 * which makes it return the header value rather than the body. Until the
 * SDK regen is fixed (Phase 12 cleanup item), call the endpoint directly
 * via fetch and parse the NDJSON ourselves. This mirrors the reference
 * implementation in `backend/gemini-ui/src/api/endpoints/traits.ts:getRecords`.
 */

export function parseNdjson(raw: string): TraitRecordOutput[] {
  if (!raw) return []
  const out: TraitRecordOutput[] = []
  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    out.push(JSON.parse(trimmed) as TraitRecordOutput)
  }
  return out
}

export interface FetchTraitRecordsOptions {
  experimentName?: string | null
  seasonName?: string | null
  siteName?: string | null
  collectionDate?: string | null
}

export async function fetchTraitRecords(
  traitId: string,
  options: FetchTraitRecordsOptions = {},
): Promise<TraitRecordOutput[]> {
  const base = (OpenAPI.BASE ?? "").replace(/\/$/, "")
  const params = new URLSearchParams()
  if (options.experimentName)
    params.set("experiment_name", options.experimentName)
  if (options.seasonName) params.set("season_name", options.seasonName)
  if (options.siteName) params.set("site_name", options.siteName)
  if (options.collectionDate)
    params.set("collection_date", options.collectionDate)
  const qs = params.toString()
  const url = `${base}/api/traits/id/${encodeURIComponent(traitId)}/records${qs ? `?${qs}` : ""}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${getToken()}` },
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch trait records (${res.status})`)
  }
  const text = await res.text()
  return parseNdjson(text)
}
