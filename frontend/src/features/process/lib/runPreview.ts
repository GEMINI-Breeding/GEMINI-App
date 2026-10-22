/**
 * One representative image per run, for cards (the workspace tiles).
 *
 * Preference: something the pipeline made (a plot image, a stitched plot)
 * over a raw photo of the flight or drive. Finding it costs one short
 * listing (a page of a few files, not the folder); the answer is kept in
 * localStorage per run, so later visits fetch only the small thumbnail.
 * "Nothing yet" is remembered for a short while only, since processing
 * produces images later.
 */
import { useQuery } from "@tanstack/react-query"

import { FilesService } from "@/client"
import {
  type AerialScope,
  processedPrefix,
  rawScopePrefix,
} from "@/features/process/lib/paths"
import type { Run } from "@/features/process/lib/runStore"

const KEY = "gemini.process.runPreview.v1"
const MISS_TTL_MS = 15 * 60_000
const IMAGE = /\.(png|jpe?g|webp)$/i

type Cached = { path: string | null; at: number }

function readCache(): Record<string, Cached> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<
      string,
      Cached
    >
  } catch {
    return {}
  }
}

function writeCache(runId: string, path: string | null): void {
  try {
    const all = readCache()
    all[runId] = { path, at: Date.now() }
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    // storage full or blocked: previews are just looked up again next time
  }
}

async function firstImage(
  prefix: string,
  limit: number,
  prefer?: RegExp,
): Promise<string | null> {
  try {
    const res =
      (await FilesService.apiFilesListPaginatedFilePathListFilesPaginated({
        filePath: `gemini/${prefix}`,
        limit,
        offset: 0,
      })) as { files?: { object_name?: string }[] } | null
    const names = (res?.files ?? [])
      .map((f) => f.object_name ?? "")
      .filter((n) => IMAGE.test(n))
    return (prefer && names.find((n) => prefer.test(n))) || names[0] || null
  } catch {
    return null
  }
}

function scopeOf(run: Run): AerialScope | null {
  const u = run.uploadScope
  if (!u?.year || !u.experiment || !u.date || !u.platform || !u.sensor)
    return null
  return {
    year: u.year,
    experiment: u.experiment,
    location: u.location,
    population: u.population,
    date: u.date,
    platform: u.platform,
    sensor: u.sensor,
  }
}

export async function resolveRunPreview(run: Run): Promise<string | null> {
  const cached = readCache()[run.id]
  if (cached?.path) return cached.path
  if (cached && Date.now() - cached.at < MISS_TTL_MS) return null
  const scope = scopeOf(run)
  if (!scope) return null
  const made = await firstImage(
    processedPrefix(scope),
    60,
    /\/(PlotImages|AgRowStitch_v\d+)\//,
  )
  // The upload's own folder when the run names one (drone uploads keep
  // images in {id}/Images/, rover ones in {id}/RGB/Images/left/).
  const shortId = run.uploadScope?.datasetShortIds?.[0]
  const path =
    made ??
    (await firstImage(
      `${rawScopePrefix(scope)}${shortId ? `${shortId}/` : ""}`,
      20,
    ))
  writeCache(run.id, path)
  return path
}

export function useRunPreview(run: Run | undefined) {
  return useQuery({
    queryKey: ["run-preview", run?.id],
    queryFn: () => (run ? resolveRunPreview(run) : null),
    enabled: Boolean(run),
    staleTime: MISS_TTL_MS,
  })
}

/** The runs whose pictures best show a workspace: finished first, newest. */
export function previewRuns(runs: Run[], n = 3): Run[] {
  const rank = (r: Run) => (r.status === "completed" ? 0 : 1)
  const seen = new Set<string>()
  const out: Run[] = []
  for (const r of [...runs].sort(
    (a, b) => rank(a) - rank(b) || b.updatedAt.localeCompare(a.updatedAt),
  )) {
    const u = r.uploadScope
    const where = u ? `${u.location}/${u.date}/${u.platform}` : r.id
    if (seen.has(where)) continue
    seen.add(where)
    out.push(r)
    if (out.length === n) break
  }
  return out
}
