/**
 * ImageReviewer — interactive tool for the optional `image_review` step.
 *
 * Drops a satellite map for the run's raw-images prefix, lets the user
 * shift-drag/shift-click to mark images for exclusion, and writes the
 * resulting basename list to `Raw/{scope}/image_filter.txt` (scope
 * root, sibling of every dataset subdir). The ODM worker honors that
 * sidecar at submission time across all datasets it pools.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, MapPin, SkipForward } from "lucide-react"
import { useEffect, useState } from "react"

import { FilesService } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ImageDotMap } from "@/features/process/components/ImageDotMap"
import { useActiveDatasetShortId } from "@/features/process/hooks/useActiveDatasetShortId"
import { useImageGps } from "@/features/process/hooks/useImageGps"
import {
  parseImageFilter,
  serializeImageFilter,
} from "@/features/process/lib/imageFilter"
import { fetchObjectAsText } from "@/features/process/lib/imageGps"
import type { AerialScope } from "@/features/process/lib/paths"
import { rawScopePrefix } from "@/features/process/lib/paths"
import { type Run, setStepState } from "@/features/process/lib/runStore"
import useCustomToast from "@/hooks/useCustomToast"

const DEFAULT_BUCKET = "gemini"
const FILTER_FILENAME = "image_filter.txt"

interface ImageReviewerProps {
  run: Run
  scope: AerialScope
  onSaved?: () => void
  onCancel?: () => void
}

export function ImageReviewer({
  run,
  scope,
  onSaved,
  onCancel,
}: ImageReviewerProps) {
  const queryClient = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()

  // The map needs a single dataset to render — pulling per-image GPS
  // from the worker-cached endpoint requires one prefix. Multi-dataset
  // image-review would need a UX redesign (which dot belongs to which
  // dataset?), so we gate the tool on exactly one. When the scope has
  // only one observed dataset, that one is auto-picked.
  const { activeShortId, observedShortIds } = useActiveDatasetShortId(
    scope,
    run,
  )
  const datasetShortIds = run.uploadScope?.datasetShortIds ?? []

  // useImageGps tolerates null and disables its queries — the tool
  // shows a "pick exactly one dataset" prompt below when the user
  // hasn't narrowed to one yet.
  const {
    images,
    gpsMap,
    imageNames,
    gpsLoading,
    gpsError,
    gpsReadyCount,
    imageBbox,
    filesQuery,
    imagesPrefix,
  } = useImageGps(scope, activeShortId)

  // image_filter.txt lives at the scope root so it applies across all
  // datasets the ODM job pools. Same key as the worker's
  // `_load_image_filter` lookup.
  const scopePrefix = rawScopePrefix(scope)
  const filterObjectName = `${scopePrefix}${FILTER_FILENAME}`
  // Try to fetch on every mount; 404 → empty set. Avoids a
  // chicken-and-egg list/check pass that the per-dataset images query
  // can't satisfy (the filter file lives one directory up from the
  // images this hook lists).
  const filterQuery = useQuery<Set<string>, Error>({
    queryKey: ["image-filter", filterObjectName],
    queryFn: async () => {
      try {
        return parseImageFilter(await fetchObjectAsText(filterObjectName))
      } catch {
        return new Set<string>()
      }
    },
    enabled: Boolean(activeShortId),
  })

  // ── Selection state ───────────────────────────────────────────────────────
  // Initialize from runStore.manualMarks (preferred — fast, no network) or,
  // if absent, from the persisted image_filter.txt once it loads.
  const [excluded, setExcluded] = useState<Set<string>>(() => {
    const prev = run.steps.image_review?.manualMarks
    if (Array.isArray(prev)) return new Set(prev as string[])
    return new Set()
  })
  // Hydrate from MinIO file once when the run has no client-side state.
  useEffect(() => {
    const prev = run.steps.image_review?.manualMarks
    if (Array.isArray(prev) && prev.length > 0) return
    if (filterQuery.data) setExcluded(new Set(filterQuery.data))
  }, [filterQuery.data, run.steps.image_review?.manualMarks])

  // Persist selection into runStore so navigating away and back preserves it.
  useEffect(() => {
    const prev = run.steps.image_review?.manualMarks
    const arr = Array.from(excluded).sort()
    const prevArr = Array.isArray(prev) ? [...(prev as string[])].sort() : []
    if (
      JSON.stringify(prev) !== JSON.stringify(arr) &&
      !arraysEqual(prevArr, arr)
    ) {
      setStepState(run.id, "image_review", { manualMarks: arr })
    }
  }, [excluded, run.id, run.steps.image_review?.manualMarks])

  const noGpsCount = imageNames.filter((n) => !gpsMap[n]).length
  const includedCount = imageNames.length - excluded.size

  // ── Save flow ─────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      const text = serializeImageFilter(excluded)
      const file = new File([text], FILTER_FILENAME, { type: "text/plain" })
      await FilesService.apiFilesUploadUploadFile({
        formData: {
          file,
          bucket_name: DEFAULT_BUCKET,
          object_name: filterObjectName,
        },
      })
    },
    onSuccess: () => {
      setStepState(run.id, "image_review", {
        status: "completed",
        completedAt: new Date().toISOString(),
        manualMarks: Array.from(excluded).sort(),
        outputs: {
          ...(run.steps.image_review?.outputs ?? {}),
          imageFilterPath: filterObjectName,
          excludedCount: excluded.size,
          totalCount: imageNames.length,
        },
      })
      queryClient.invalidateQueries({
        queryKey: ["files", "list", imagesPrefix],
      })
      // Invalidate the GCP picker's image list so it picks up the
      // exclusion immediately when the user navigates over.
      queryClient.invalidateQueries({
        queryKey: ["files", "list", imagesPrefix, "gcp-picker"],
      })
      showSuccessToast(
        `Saved ${FILTER_FILENAME} (${excluded.size} excluded, ${includedCount} kept)`,
      )
      onSaved?.()
    },
    onError: (err) =>
      showErrorToast(err instanceof Error ? err.message : "Failed to save"),
  })

  function handleSkip() {
    setStepState(run.id, "image_review", {
      status: "skipped",
      completedAt: new Date().toISOString(),
    })
    showSuccessToast("Skipped image exclusion")
    onSaved?.()
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (activeShortId === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Pick exactly one dataset to review
          </CardTitle>
          <CardDescription data-testid="image-review-needs-single-dataset">
            {datasetShortIds.length > 1
              ? `This run targets ${datasetShortIds.length} datasets. The image review tool operates on one dataset at a time — narrow the selection on the run page first.`
              : `This scope has ${observedShortIds.length} datasets and no single one is selected. Open the run page and pick exactly one dataset before opening the image review tool.`}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (filesQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    )
  }
  if (gpsError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base text-destructive">
            Failed to read image GPS
          </CardTitle>
          <CardDescription data-testid="image-review-gps-error">
            {gpsError.message ||
              "The /image-gps endpoint returned an error. Check the rest-api logs for the underlying cause (commonly a schema drift in experiment_files.metadata_json)."}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }
  if (images.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">No images found</CardTitle>
          <CardDescription>
            Expected images at <code>{imagesPrefix}</code>. Run Data Sync first.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="text-base">Exclude images</CardTitle>
            <CardDescription>
              Shift-drag a box (or shift-click a single dot) to mark images for
              exclusion. ODM will skip everything you mark here.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSkip}
              data-testid="image-review-skip"
            >
              <SkipForward className="mr-1.5 h-3.5 w-3.5" />
              Skip
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExcluded(new Set())}
              disabled={excluded.size === 0}
              data-testid="image-review-clear"
            >
              Clear selection
            </Button>
            <Button
              size="sm"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              data-testid="image-review-save"
            >
              {saveMutation.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              Save & complete
            </Button>
            {onCancel ? (
              <Button variant="ghost" size="sm" onClick={onCancel}>
                Cancel
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground mb-2 flex items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {imageNames.length} images
            </span>
            <span data-testid="image-review-counts">
              {excluded.size} excluded · {includedCount} kept
            </span>
            {gpsLoading ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Reading EXIF GPS… {gpsReadyCount}/{imageNames.length}
              </span>
            ) : null}
            {!gpsLoading && noGpsCount > 0 ? (
              <span className="text-amber-700">
                {noGpsCount} image{noGpsCount === 1 ? "" : "s"} have no EXIF GPS
                and will not appear on the map (they remain included)
              </span>
            ) : null}
            {imageBbox && imageBbox.count === 0 ? (
              <span className="text-destructive">
                None of the {imageNames.length} images have EXIF GPS — image
                review is unavailable for this scope.
              </span>
            ) : null}
          </div>
          <ImageDotMap
            gpsMap={gpsMap}
            imagesPrefix={imagesPrefix}
            selected={excluded}
            onSelectionChange={setExcluded}
            mode="exclude"
          />
        </CardContent>
      </Card>
    </div>
  )
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
