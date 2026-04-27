/**
 * OrthomosaicTool — submit a RUN_ODM job and watch it.
 *
 * The pre-migration version had a 1308-line GcpPicker that drove an SSE
 * stream and per-image GCP tagging. The new flow is simpler and matches the
 * upstream worker contract (`backend/gemini/workers/odm/worker.py`):
 *   1. User picks scope (date / platform / sensor) on top of the experiment
 *      scope from the sidebar.
 *   2. We confirm raw images exist at the expected MinIO prefix.
 *   3. User clicks Submit; we POST `/api/jobs/submit` with JOB_TYPE=RUN_ODM
 *      and the path-component params the worker uses to discover images.
 *   4. ProcessContext picks up the runId and ProcessPanel streams progress
 *      via wsManager (already wired in Phase 4/6).
 *   5. When the job lands COMPLETED, we link to the produced ortho artifact.
 *
 * GCP CSV upload + per-image tagging are intentionally simplified: the
 * worker accepts a `custom_options` string passed through to NodeODM, and a
 * GCP CSV can be added by uploading it into the same Raw/.../Images/
 * prefix (NodeODM auto-detects `gcp_list.txt`). A richer GCP-picking UI is
 * deferred — flagged in Phase 12 if needed.
 */
import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ChevronLeft, ImageIcon } from "lucide-react"

import { FilesService, type FileMetadata } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useProcess } from "@/contexts/ProcessContext"
import {
  AerialScopePicker,
  buildAerialScope,
  readStoredAerialFields,
  useAerialScopeContext,
  writeStoredAerialFields,
  type AerialScopeFields,
} from "@/features/process/components/AerialScopePicker"
import { useCancelJob, useSubmitJob } from "@/features/process/hooks/useJobs"
import {
  isAerialScopeComplete,
  rawImagesPrefix,
} from "@/features/process/lib/paths"
import useCustomToast from "@/hooks/useCustomToast"
import { isLoggedIn } from "@/lib/auth"

const RECONSTRUCTION_QUALITY = ["Default", "Lowest", "Low", "Medium", "High", "Ultra", "Custom"] as const

// Hint copy shown under the quality dropdown so users know what each
// preset actually does. The flag values mirror QUALITY_PRESETS in
// backend/gemini/workers/odm/worker.py — keep in sync if you tweak
// the worker side.
const QUALITY_HINTS: Record<(typeof RECONSTRUCTION_QUALITY)[number], string> = {
  Default: "Worker defaults (full-quality reconstruction).",
  Lowest:
    "Memory-friendly: feature/pc/depthmap all 'lowest', max 4 cores. Designed to fit in a 7-8 GiB Docker engine.",
  Low: "feature/pc-quality 'low', depthmap 512px. Faster + lower RAM than Default.",
  Medium:
    "feature/pc-quality 'medium', depthmap 640px. Balanced; the safest first try on large flights.",
  High: "feature/pc-quality 'high'. Higher detail, ~2x more RAM than Default.",
  Ultra:
    "feature/pc-quality 'ultra', depthmap 1280px. Highest detail; needs 16-32 GiB+ RAM headroom.",
  Custom: "Use the textbox below to pass raw NodeODM CLI flags.",
}
const DEFAULT_BUCKET = "gemini"

export function OrthomosaicTool() {
  const ctx = useAerialScopeContext()
  const [fields, setFields] = useState<AerialScopeFields>(() => readStoredAerialFields())
  const [quality, setQuality] = useState<(typeof RECONSTRUCTION_QUALITY)[number]>("Default")
  const [customOptions, setCustomOptions] = useState("")
  const [submittedJobId, setSubmittedJobId] = useState<string | null>(null)

  useEffect(() => writeStoredAerialFields(fields), [fields])

  const submit = useSubmitJob()
  const cancel = useCancelJob()
  const { addProcess, removeProcess } = useProcess()
  const { showErrorToast, showSuccessToast } = useCustomToast()

  const scope = useMemo(() => {
    if (!fields.date || !fields.platform || !fields.sensor) return null
    const s = buildAerialScope(ctx, fields)
    return isAerialScopeComplete(s) ? s : null
  }, [ctx, fields])

  // Confirm raw images exist before submission — the worker would otherwise
  // run for several minutes only to fail with "no images found." Live count
  // also confirms the user picked the right scope.
  const rawImagesQuery = useQuery<FileMetadata[], Error>({
    queryKey: ["files", "list", scope ? rawImagesPrefix(scope) : null],
    queryFn: async () => {
      if (!scope) return []
      const res = await FilesService.apiFilesListFilePathListFiles({
        filePath: `${DEFAULT_BUCKET}/${rawImagesPrefix(scope)}`,
      })
      return (res as FileMetadata[] | null) ?? []
    },
    enabled: isLoggedIn() && Boolean(scope),
  })
  const imageFiles = useMemo(
    () => (rawImagesQuery.data ?? []).filter((f) => /\.(jpe?g|png|tif?f)$/i.test(f.object_name ?? "")),
    [rawImagesQuery.data],
  )

  async function onSubmit() {
    if (!scope) return
    try {
      const job = await submit.mutateAsync({
        jobType: "RUN_ODM",
        parameters: {
          year: scope.year,
          experiment: scope.experiment,
          location: scope.location,
          population: scope.population,
          date: scope.date,
          platform: scope.platform,
          sensor: scope.sensor,
          reconstruction_quality: quality,
          ...(customOptions.trim() ? { custom_options: customOptions.trim() } : {}),
        },
        experimentId: ctx.experimentId,
      })
      const jobId = String(job.id ?? "")
      if (!jobId) throw new Error("Job submitted but no id returned")
      setSubmittedJobId(jobId)
      const procId = addProcess({
        type: "processing",
        title: `Orthomosaic — ${scope.date} ${scope.platform}/${scope.sensor}`,
        status: "running",
        items: [],
        runId: jobId,
        link: `/process/jobs/${jobId}`,
        cancel: () => cancel.mutate(jobId),
      })
      showSuccessToast("Orthomosaic job submitted")
      // procId is owned by ProcessContext; we don't need to track it here
      // because terminal events will mark it done. removeProcess is exposed
      // for the cancel-button case below.
      void procId
      void removeProcess
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : "Failed to submit job")
    }
  }

  return (
    <div className="container max-w-3xl space-y-4 px-4 py-6">
      <Button asChild variant="ghost" size="sm">
        <Link to="/process">
          <ChevronLeft className="mr-1 h-4 w-4" /> Pipeline
        </Link>
      </Button>

      <header>
        <h1 className="text-xl font-semibold">Orthomosaic (RUN_ODM)</h1>
        <p className="text-muted-foreground text-sm">
          Stitch raw drone images into a single georeferenced orthomosaic.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Flight scope</CardTitle>
          <CardDescription>The worker uses these to locate raw images on MinIO.</CardDescription>
        </CardHeader>
        <CardContent>
          <AerialScopePicker value={fields} onChange={setFields} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Inputs</CardTitle>
          <CardDescription>Raw images expected at the prefix below.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {scope ? (
            <>
              <code className="bg-muted block break-all rounded px-2 py-1 text-xs">
                {rawImagesPrefix(scope)}
              </code>
              <p className="text-muted-foreground flex items-center gap-2">
                <ImageIcon className="h-4 w-4" />
                {rawImagesQuery.isLoading
                  ? "Looking for images…"
                  : `${imageFiles.length} image${imageFiles.length === 1 ? "" : "s"} found`}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">
              Pick experiment / season / site / population in the sidebar, plus a date,
              platform, and sensor above.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">NodeODM options</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="ortho-quality" className="mb-1.5 text-xs">
              Reconstruction quality
            </Label>
            <Select value={quality} onValueChange={(v) => setQuality(v as typeof quality)}>
              <SelectTrigger id="ortho-quality" data-testid="ortho-quality">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RECONSTRUCTION_QUALITY.map((q) => (
                  <SelectItem key={q} value={q}>
                    {q}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground mt-1 text-xs" data-testid="ortho-quality-hint">
              {QUALITY_HINTS[quality]}
            </p>
          </div>
          {quality === "Custom" && (
            <div>
              <Label htmlFor="ortho-custom" className="mb-1.5 text-xs">
                Custom NodeODM options
              </Label>
              <Input
                id="ortho-custom"
                data-testid="ortho-custom-options"
                placeholder='e.g. "--fast-orthophoto --skip-3dmodel"'
                value={customOptions}
                onChange={(e) => setCustomOptions(e.target.value)}
              />
              <p className="text-muted-foreground mt-1 text-xs">
                Forwarded as-is to NodeODM. Drop a <code>gcp_list.txt</code> alongside your raw images
                for ground-control points.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-2">
        <Button
          onClick={onSubmit}
          disabled={!scope || imageFiles.length === 0 || submit.isPending}
        >
          {submit.isPending ? "Submitting…" : "Run orthomosaic"}
        </Button>
        {submittedJobId && (
          <Button asChild variant="outline">
            <Link to="/process/jobs/$jobId" params={{ jobId: submittedJobId }}>
              Open job
            </Link>
          </Button>
        )}
      </div>
    </div>
  )
}
