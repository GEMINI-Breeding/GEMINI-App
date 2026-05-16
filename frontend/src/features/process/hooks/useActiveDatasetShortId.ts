/**
 * Resolve which dataset short-id a single-dataset tool (GCP picker,
 * image reviewer) should operate on.
 *
 * Precedence:
 *   1. If the run's uploadScope.datasetShortIds names exactly one
 *      short-id, that's it.
 *   2. Otherwise list images under the scope root; if there's exactly
 *      one observed short-id at the scope, that's it (auto-pick for
 *      the common case where a scope has only had one upload).
 *   3. Otherwise null — the tool surfaces a "pick exactly one dataset"
 *      affordance and the user narrows the selection on RunDetail.
 *
 * The hook also returns the full list of observed short-ids so the
 * tool's empty-state message can say "this scope has N datasets".
 */
import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { type FileMetadata, FilesService } from "@/client"
import type { AerialScope } from "@/features/process/lib/paths"
import { rawScopePrefix } from "@/features/process/lib/paths"
import { type Run } from "@/features/process/lib/runStore"
import { isLoggedIn } from "@/lib/auth"

const DEFAULT_BUCKET = "gemini"
const SHORT_ID_RE = /^[0-9a-f]{8}$/

export interface ActiveDatasetShortIdResult {
  /** The short-id to operate on, or null when the user must pick. */
  activeShortId: string | null
  /** Every short-id observed at this scope. */
  observedShortIds: string[]
  /** True while the scope listing is in flight. */
  isLoading: boolean
}

export function useActiveDatasetShortId(
  scope: AerialScope,
  run: Run,
): ActiveDatasetShortIdResult {
  const selected = run.uploadScope?.datasetShortIds ?? []

  const scopePrefix = rawScopePrefix(scope)
  const filesQuery = useQuery<FileMetadata[], Error>({
    queryKey: ["files", "list", scopePrefix, "scope-shortids"],
    queryFn: async () => {
      const res = await FilesService.apiFilesListFilePathListFiles({
        filePath: `${DEFAULT_BUCKET}/${scopePrefix}`,
      })
      return (res as FileMetadata[] | null) ?? []
    },
    enabled: isLoggedIn(),
    staleTime: 30_000,
  })

  const observedShortIds = useMemo<string[]>(() => {
    const set = new Set<string>()
    for (const f of filesQuery.data ?? []) {
      const name = f.object_name ?? ""
      if (!name.startsWith(scopePrefix)) continue
      const tail = name.slice(scopePrefix.length).split("/")
      // tail[0] is either an 8-hex short-id (new layout) or
      // "Images" (legacy). Only count the former.
      if (tail.length >= 2 && SHORT_ID_RE.test(tail[0])) {
        set.add(tail[0])
      }
    }
    return Array.from(set).sort()
  }, [scopePrefix, filesQuery.data])

  const activeShortId = useMemo<string | null>(() => {
    if (selected.length === 1) return selected[0]
    if (selected.length === 0 && observedShortIds.length === 1) {
      return observedShortIds[0]
    }
    return null
  }, [selected, observedShortIds])

  return {
    activeShortId,
    observedShortIds,
    isLoading: filesQuery.isLoading,
  }
}
