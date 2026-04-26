/**
 * ExtractTraitsTool — submit an EXTRACT_TRAITS job and render the results.
 *
 * Worker contract (backend/gemini/workers/ml/worker.py:_extract_traits_job):
 *   - orthomosaic_path: MinIO object path to a 3-channel RGB ortho
 *   - boundary_geojson_path: MinIO object path to a FeatureCollection of plot polys
 *   - output_traits_geojson_path: MinIO object path to write
 *   - dem_path?: MinIO path to a DEM for canopy-height computation
 *   - exg_threshold?: ExG mask threshold (default 0.1)
 *
 * The active plot-geometry version supplies the boundaries — we serialise it
 * as a small JSON blob and upload via the chunked-upload primitive (one
 * chunk for any reasonable plot count). Output is rendered on a deck.gl
 * map colored by `Vegetation_Fraction`.
 */
import { useEffect, useMemo, useState } from "react"
import { Link } from "@tanstack/react-router"
import { ChevronLeft } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useProcess } from "@/contexts/ProcessContext"
import {
  AerialScopePicker,
  buildAerialScope,
  readStoredAerialFields,
  useAerialScopeContext,
  writeStoredAerialFields,
  type AerialScopeFields,
} from "@/features/process/components/AerialScopePicker"
import { TraitMap } from "@/features/process/components/TraitMap"
import { useCancelJob, useSubmitJob } from "@/features/process/hooks/useJobs"
import {
  useLoadPlotGeometryVersion,
  usePlotGeometryVersions,
} from "@/features/process/hooks/usePlotGeometry"
import {
  isAerialScopeComplete,
  orthomosaicPath,
  processedPrefix,
} from "@/features/process/lib/paths"
import useCustomToast from "@/hooks/useCustomToast"
import { uploadFileChunked } from "@/lib/chunkedUpload"

const DEFAULT_BUCKET = "gemini"

export function ExtractTraitsTool() {
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

  const [exgThreshold, setExgThreshold] = useState("0.1")
  const [demPath, setDemPath] = useState("")
  const [traitColumn, setTraitColumn] = useState<string>("Vegetation_Fraction")
  const [traitsGeojson, setTraitsGeojson] = useState<GeoJSON.FeatureCollection | null>(null)
  const [submittedJobId, setSubmittedJobId] = useState<string | null>(null)

  const submit = useSubmitJob()
  const cancel = useCancelJob()
  const { addProcess } = useProcess()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const outputPath = useMemo(() => {
    if (!scope) return null
    return `${processedPrefix(scope)}Traits-WGS84.geojson`
  }, [scope])

  async function onSubmit() {
    if (!scope || !loaded.data?.state_snapshot?.boundaries || !outputPath) return
    const boundaryPath = `${processedPrefix(scope)}plot-boundaries.geojson`
    try {
      // 1. Upload boundaries as a single small chunk so the worker has a path.
      const blob = new Blob(
        [JSON.stringify(loaded.data.state_snapshot.boundaries)],
        { type: "application/geo+json" },
      )
      await uploadFileChunked({
        file: blob,
        fileIdentifier: `traits-bounds-${Date.now()}`,
        objectName: boundaryPath,
        bucketName: DEFAULT_BUCKET,
      })
      // 2. Submit the job.
      const job = await submit.mutateAsync({
        jobType: "EXTRACT_TRAITS",
        parameters: {
          orthomosaic_path: orthomosaicPath(scope),
          boundary_geojson_path: boundaryPath,
          output_traits_geojson_path: outputPath,
          ...(demPath.trim() ? { dem_path: demPath.trim() } : {}),
          ...(exgThreshold ? { exg_threshold: Number(exgThreshold) } : {}),
        },
        experimentId: ctx.experimentId,
      })
      const jobId = String(job.id ?? "")
      if (!jobId) throw new Error("Job submitted but no id returned")
      setSubmittedJobId(jobId)
      addProcess({
        type: "processing",
        title: `Extract traits — ${scope.date} ${scope.platform}/${scope.sensor}`,
        status: "running",
        items: [],
        runId: jobId,
        link: `/process/jobs/${jobId}`,
        cancel: () => cancel.mutate(jobId),
      })
      showSuccessToast("Extract-traits job submitted")
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : "Failed to submit job")
    }
  }

  // Once the job lands COMPLETED (we just poll the file existence), fetch the
  // output GeoJSON and stash it for the map.
  useEffect(() => {
    if (!outputPath) return
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null
    async function poll() {
      try {
        const res = await fetch(
          `${(await import("@/client/core/OpenAPI")).OpenAPI.BASE?.replace(/\/$/, "") ?? ""}/api/files/download/${DEFAULT_BUCKET}/${outputPath}`,
          {
            headers: {
              Authorization: `Bearer ${(await import("@/lib/auth")).getToken()}`,
            },
          },
        )
        if (!res.ok) return
        const fc = (await res.json()) as GeoJSON.FeatureCollection
        if (!cancelled) setTraitsGeojson(fc)
        if (timer) clearInterval(timer)
      } catch {
        // keep polling
      }
    }
    void poll()
    timer = setInterval(poll, 7_000)
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [outputPath, submittedJobId])

  const traitColumns = useMemo(() => {
    if (!traitsGeojson?.features?.length) return []
    const props = traitsGeojson.features[0].properties ?? {}
    return Object.keys(props).filter((k) => typeof (props as Record<string, unknown>)[k] === "number")
  }, [traitsGeojson])

  // Default the picker to whichever numeric column appears first if the
  // server didn't expose Vegetation_Fraction (older outputs / column rename).
  useEffect(() => {
    if (traitColumns.length === 0) return
    if (!traitColumns.includes(traitColumn)) setTraitColumn(traitColumns[0])
  }, [traitColumns, traitColumn])

  return (
    <div className="container max-w-6xl space-y-4 px-4 py-6">
      <Button asChild variant="ghost" size="sm">
        <Link to="/process">
          <ChevronLeft className="mr-1 h-4 w-4" /> Pipeline
        </Link>
      </Button>

      <header>
        <h1 className="text-xl font-semibold">Extract traits</h1>
        <p className="text-muted-foreground text-sm">
          Compute Vegetation_Fraction (and canopy height with a DEM) per plot.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Flight scope</CardTitle>
          <CardDescription>
            Reads the ortho at <code>odm_orthophoto.tif</code> under this prefix.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AerialScopePicker value={fields} onChange={setFields} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Inputs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Orthomosaic</p>
              <code className="bg-muted block break-all rounded px-2 py-1 text-xs">
                {scope ? orthomosaicPath(scope) : "—"}
              </code>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Active boundary</p>
              {activeVersion ? (
                <p>
                  v{activeVersion.version} —{" "}
                  {(loaded.data?.state_snapshot?.boundaries?.features?.length ?? 0)} plots
                </p>
              ) : (
                <p className="text-muted-foreground">
                  No active version; visit{" "}
                  <Link className="underline" to="/process/plot-boundaries">
                    Plot boundaries
                  </Link>
                  .
                </p>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Options</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="exg" className="mb-1.5 text-xs">ExG threshold</Label>
              <Input
                id="exg"
                type="number"
                step="0.01"
                value={exgThreshold}
                onChange={(e) => setExgThreshold(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="dem" className="mb-1.5 text-xs">DEM path (optional)</Label>
              <Input
                id="dem"
                placeholder="Processed/.../dem.tif"
                value={demPath}
                onChange={(e) => setDemPath(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>
      </div>

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
          {submit.isPending ? "Submitting…" : "Run extract traits"}
        </Button>
        {submittedJobId && (
          <Button asChild variant="outline">
            <Link to="/process/jobs/$jobId" params={{ jobId: submittedJobId }}>
              Open job
            </Link>
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Trait map</CardTitle>
            {traitColumns.length > 0 && (
              <Select value={traitColumn} onValueChange={setTraitColumn}>
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {traitColumns.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {traitsGeojson ? (
            <TraitMap data={traitsGeojson} traitColumn={traitColumn} />
          ) : (
            <p className="text-muted-foreground text-sm">
              Submit an extract-traits job. The map will render here once the worker writes the
              output GeoJSON.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
