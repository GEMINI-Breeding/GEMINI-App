/**
 * SplitOrthomosaicTool — submit a SPLIT_ORTHOMOSAIC job.
 *
 * Per `backend/gemini/workers/geo/worker.py:_split_orthomosaic_job`, the
 * worker takes path-component params + a GeoJSON FeatureCollection
 * (`boundaries`) and writes per-plot PNGs under
 * `Processed/.../PlotImages/`. Gated on an active plot-geometry version
 * for the same scope; without one we'd ship the worker no boundaries.
 */
import { useEffect, useMemo, useState } from "react"
import { Link } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { ChevronLeft } from "lucide-react"

import { FilesService, type FileMetadata } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useProcess } from "@/contexts/ProcessContext"
import {
  AerialScopePicker,
  buildAerialScope,
  readStoredAerialFields,
  useAerialScopeContext,
  writeStoredAerialFields,
  type AerialScopeFields,
} from "@/features/process/components/AerialScopePicker"
import { PlotImageGrid } from "@/features/process/components/PlotImageGrid"
import { useCancelJob, useSubmitJob } from "@/features/process/hooks/useJobs"
import {
  useLoadPlotGeometryVersion,
  usePlotGeometryVersions,
} from "@/features/process/hooks/usePlotGeometry"
import {
  isAerialScopeComplete,
  plotImagesPrefix,
  processedPrefix,
} from "@/features/process/lib/paths"
import useCustomToast from "@/hooks/useCustomToast"
import { isLoggedIn } from "@/lib/auth"

const DEFAULT_BUCKET = "gemini"

export function SplitOrthomosaicTool() {
  const ctx = useAerialScopeContext()
  const [fields, setFields] = useState<AerialScopeFields>(() => readStoredAerialFields())
  useEffect(() => writeStoredAerialFields(fields), [fields])

  const scope = useMemo(() => {
    const s = buildAerialScope(ctx, fields)
    return isAerialScopeComplete(s) ? s : null
  }, [ctx, fields])
  const directory = scope ? processedPrefix(scope) : null

  const { data: versions = [] } = usePlotGeometryVersions(directory)
  const activeVersion = useMemo(() => versions.find((v) => v.is_active) ?? null, [versions])
  const loaded = useLoadPlotGeometryVersion(directory, activeVersion?.version ?? null)

  const submit = useSubmitJob()
  const cancel = useCancelJob()
  const { addProcess } = useProcess()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [submittedJobId, setSubmittedJobId] = useState<string | null>(null)

  const plotImagesQuery = useQuery<FileMetadata[], Error>({
    queryKey: ["files", "list", scope ? plotImagesPrefix(scope) : null],
    queryFn: async () => {
      if (!scope) return []
      try {
        const res = await FilesService.apiFilesListFilePathListFiles({
          filePath: `${DEFAULT_BUCKET}/${plotImagesPrefix(scope)}`,
        })
        return (res as FileMetadata[] | null) ?? []
      } catch {
        // 404 if PlotImages/ doesn't exist yet — that's expected before split.
        return []
      }
    },
    enabled: isLoggedIn() && Boolean(scope),
    refetchInterval: 10_000,
  })

  async function onSubmit() {
    if (!scope || !loaded.data?.state_snapshot?.boundaries) return
    try {
      const job = await submit.mutateAsync({
        jobType: "SPLIT_ORTHOMOSAIC",
        parameters: {
          year: scope.year,
          experiment: scope.experiment,
          location: scope.location,
          population: scope.population,
          date: scope.date,
          boundaries: loaded.data.state_snapshot.boundaries,
        },
        experimentId: ctx.experimentId,
      })
      const jobId = String(job.id ?? "")
      if (!jobId) throw new Error("Job submitted but no id returned")
      setSubmittedJobId(jobId)
      addProcess({
        type: "processing",
        title: `Split ortho — ${scope.date} ${scope.platform}/${scope.sensor}`,
        status: "running",
        items: [],
        runId: jobId,
        link: `/process/jobs/${jobId}`,
        cancel: () => cancel.mutate(jobId),
      })
      showSuccessToast("Split job submitted")
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : "Failed to submit job")
    }
  }

  return (
    <div className="container max-w-5xl space-y-4 px-4 py-6">
      <Button asChild variant="ghost" size="sm">
        <Link to="/process">
          <ChevronLeft className="mr-1 h-4 w-4" /> Pipeline
        </Link>
      </Button>

      <header>
        <h1 className="text-xl font-semibold">Split orthomosaic</h1>
        <p className="text-muted-foreground text-sm">
          Cut the orthomosaic into per-plot images using the active boundary version.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Flight scope</CardTitle>
          <CardDescription>The worker walks <code>Processed/.../{`{date}`}/.../</code> for orthos.</CardDescription>
        </CardHeader>
        <CardContent>
          <AerialScopePicker value={fields} onChange={setFields} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active boundary version</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {!directory ? (
            <p className="text-muted-foreground">Pick a complete scope.</p>
          ) : !activeVersion ? (
            <p className="text-muted-foreground">
              No active version. Save and activate one in{" "}
              <Link className="underline" to="/process/plot-boundaries">
                Plot boundaries
              </Link>
              .
            </p>
          ) : (
            <p>
              <span className="font-medium">v{activeVersion.version}</span>
              {activeVersion.name ? ` — ${activeVersion.name}` : ""}{" "}
              <span className="text-muted-foreground text-xs">
                ({(loaded.data?.state_snapshot?.boundaries?.features?.length ?? 0)} plots)
              </span>
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-2">
        <Button
          onClick={onSubmit}
          disabled={
            !scope ||
            !activeVersion ||
            !loaded.data?.state_snapshot?.boundaries ||
            submit.isPending
          }
        >
          {submit.isPending ? "Submitting…" : "Run split"}
        </Button>
        {submittedJobId && (
          <Button asChild variant="outline">
            <Link to="/process/jobs/$jobId" params={{ jobId: submittedJobId }}>
              Open job
            </Link>
          </Button>
        )}
      </div>

      {scope && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Plot images</CardTitle>
            <CardDescription>
              Refreshes every 10 s while a split job is running.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PlotImageGrid files={plotImagesQuery.data ?? []} prefix={plotImagesPrefix(scope)} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
