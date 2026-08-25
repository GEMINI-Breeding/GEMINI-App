/**
 * ThermalDirectoryUpload — DJI-specific guided flow: pick a directory,
 * preview detected _T/_V thermal+RGB pairs, upload, then run the thermal
 * conversion utility inline with live progress — without navigating to a
 * pipeline run (which doesn't exist yet at Files-upload time; see
 * backend/app/processing/thermal_jobs.py for why this needs its own
 * upload-scoped job registry instead of the pipeline-run-scoped one).
 */

import { useEffect, useState } from "react"
import { ChevronDown, ChevronUp, FolderOpen, History, Loader2 } from "lucide-react"
import { ThermalService, type WeatherStationFilePublic } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { dataTypes } from "@/config/dataTypes"
import { pickFiles } from "@/lib/platform"
import { useProcess } from "@/contexts/ProcessContext"
import { DataStructureForm } from "./DataStructureForm"
import { WeatherFileUploadForm } from "./WeatherFileUploadForm"
import { useFileUpload } from "../hooks/useFileUpload"

interface ScanResult {
  total_count: number
  thermal_count: number
  paired_count: number
  other_count: number
  thermal_paths: string[]
  rgb_paths: string[]
}

interface PendingConversion {
  file_upload_id: string
  storage_path: string
  experiment: string
  location: string
  population: string
  date: string
  platform: string | null
  sensor: string | null
  thermal_count: number
  paired_count: number
  created_at: string
}

interface ConvertedImage {
  name: string
  path: string
  min_temp: number
  max_temp: number
  mean_temp: number
}

interface JobStatus {
  status: "pending" | "running" | "done" | "error"
  total: number
  done: number
  images: ConvertedImage[]
  error: string | null
  // Only set on macOS, only while the Docker-based conversion tool is being
  // built (first use) — cleared to "" once real per-image conversion starts.
  message: string | null
}

type Step = "pick" | "scanned" | "uploading" | "uploaded" | "converting" | "done"

function targetRootDirFor(dataType: string, values: Record<string, string>): string {
  const config = dataTypes[dataType as keyof typeof dataTypes]
  return config.directory.map((field) => values[field.toLowerCase()] || field).join("/")
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type UpdateProcessFn = ReturnType<typeof useProcess>["updateProcess"]

// Deliberately not tied to the component's lifecycle (no useEffect/interval
// cleanup on unmount) — conversion can take a while, and navigating away
// from this page shouldn't stop it from being tracked. `updateProcess`
// closes over the always-mounted ProcessProvider (see _layout.tsx), so
// those calls keep working forever; `onUpdate` drives this page's own local
// UI and is a safe no-op if the component has since unmounted (React 18+
// silently ignores state updates on unmounted function components).
async function pollConversionJob(
  jobId: string,
  processId: string,
  updateProcess: UpdateProcessFn,
  onUpdate: (status: JobStatus) => void,
): Promise<void> {
  while (true) {
    let status: JobStatus
    try {
      status = (await ThermalService.convertDirectoryStatus({ jobId })) as unknown as JobStatus
    } catch {
      await sleep(1500)
      continue
    }

    onUpdate(status)

    const isDone = status.status === "done" || status.status === "error"
    updateProcess(processId, {
      status: status.status === "done" ? "completed" : status.status === "error" ? "error" : "running",
      progress: status.total > 0 ? Math.round((status.done / status.total) * 100) : 0,
      message: status.message || `${status.done}/${status.total} converted`,
      error: status.status === "error" ? (status.error ?? undefined) : undefined,
      completedAt: isDone ? new Date() : undefined,
    })

    if (isDone) return
    await sleep(1500)
  }
}

export function ThermalDirectoryUpload() {
  const [step, setStep] = useState<Step>("pick")
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [formValues, setFormValues] = useState<Record<string, string>>({})
  const [uploadedDir, setUploadedDir] = useState<string | null>(null)
  const [fileUploadId, setFileUploadId] = useState<string | null>(null)
  const [pendingConversions, setPendingConversions] = useState<PendingConversion[]>([])
  const [weatherFiles, setWeatherFiles] = useState<WeatherStationFilePublic[]>([])
  const [weatherFileId, setWeatherFileId] = useState("")
  const [showWeatherUpload, setShowWeatherUpload] = useState(false)
  const [distance, setDistance] = useState(5.0)
  const [humidity, setHumidity] = useState(70.0)
  const [emissivity, setEmissivity] = useState(1.0)
  const [ambientTemp, setAmbientTemp] = useState(25.0)
  const [progress, setProgress] = useState<JobStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { uploadFiles } = useFileUpload()
  const { addProcess, updateProcess } = useProcess()

  // Thermal directories are uploaded before conversion runs, so a user who
  // navigates away (or closes the app) after uploading but before starting/
  // finishing conversion shouldn't have to re-pick and re-upload the folder
  // — surface anything still awaiting conversion so they can jump straight
  // back to the conversion step.
  useEffect(() => {
    ThermalService.pendingConversions()
      .then((res) => setPendingConversions(res as unknown as PendingConversion[]))
      .catch(() => {})
  }, [])

  function resumeConversion(pc: PendingConversion) {
    setError(null)
    setUploadedDir(pc.storage_path)
    setFileUploadId(pc.file_upload_id)
    setScan({
      total_count: pc.thermal_count + pc.paired_count,
      thermal_count: pc.thermal_count,
      paired_count: pc.paired_count,
      other_count: 0,
      thermal_paths: [],
      rgb_paths: [],
    })
    setStep("uploaded")
    ThermalService.listWeatherFiles().then(setWeatherFiles).catch(() => {})
  }

  async function handlePickDirectory() {
    setError(null)
    const selected = await pickFiles({ directory: true })
    if (!selected || selected.length === 0) return
    const path = typeof selected[0] === "string" ? selected[0] : null
    if (!path) {
      setError("Directory selection isn't available in this environment.")
      return
    }
    try {
      const result = (await ThermalService.scanDirectory({
        path,
        platform: "dji",
      })) as unknown as ScanResult
      if (result.thermal_count === 0) {
        setError(`No DJI thermal images (_T.JPG) found in ${path}.`)
        return
      }
      setScan(result)
      setStep("scanned")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to scan directory")
    }
  }

  // DJI capture folders mix thermal (_T) and paired RGB (_V) shots together
  // (plus whatever else the drone wrote there, already filtered out by the
  // scan). They need to land as two separately-tagged upload batches — a
  // single image_type on the whole folder would mislabel one or the other.
  async function handleUpload() {
    if (!scan) return
    setStep("uploading")
    setError(null)
    const dataType = "Image Data"
    const targetRootDir = targetRootDirFor(dataType, formValues)

    // onComplete only fires when the batch had no copy/extraction errors —
    // files that were already present at the destination (e.g. a re-run
    // over a folder uploaded in an earlier session) are reported as
    // "skipped", not an error, so a batch that's entirely duplicates still
    // counts as a success here and should proceed straight to conversion.
    let destDir: string | null = null
    let uploadId: string | null = null
    let thermalUploaded = scan.thermal_paths.length === 0

    if (scan.thermal_paths.length > 0) {
      await uploadFiles({
        filePaths: scan.thermal_paths,
        dataType,
        targetRootDir,
        formValues: { ...formValues, image_type: "thermal" },
        onComplete: (_destPaths, meta) => {
          destDir = meta.destDir ?? destDir
          uploadId = meta.fileUploadId ?? uploadId
          thermalUploaded = true
        },
      })
    }

    if (!thermalUploaded) {
      setError("Upload failed — thermal images were not copied.")
      setStep("scanned")
      return
    }

    if (scan.rgb_paths.length > 0) {
      await uploadFiles({
        filePaths: scan.rgb_paths,
        dataType,
        targetRootDir,
        formValues: { ...formValues, image_type: "rgb" },
        onComplete: (_destPaths, meta) => {
          destDir = destDir ?? meta.destDir ?? null
          uploadId = uploadId ?? meta.fileUploadId ?? null
        },
      })
    }

    if (!destDir) {
      setError("Upload failed — no files were copied.")
      setStep("scanned")
      return
    }
    setUploadedDir(destDir)
    setFileUploadId(uploadId)
    setStep("uploaded")
    ThermalService.listWeatherFiles().then(setWeatherFiles).catch(() => {})
  }

  function handleConvert() {
    if (!uploadedDir || !scan) return
    setError(null)
    ThermalService.convertDirectory({
      requestBody: {
        path: uploadedDir,
        platform: "dji",
        distance,
        humidity,
        emissivity,
        reflected_temperature: ambientTemp,
        weather_file_id: weatherFileId || null,
        file_upload_id: fileUploadId,
      },
    })
      .then((res) => {
        const jobId = (res as unknown as { job_id: string }).job_id
        setStep("converting")
        const processId = addProcess({
          type: "processing",
          status: "running",
          title: `Converting ${scan.thermal_count} thermal image${scan.thermal_count === 1 ? "" : "s"}`,
          items: [],
          progress: 0,
          // Lets the bottom-right Process panel jump straight back to this
          // in-progress conversion's view after the user navigates away —
          // matches "__thermal__" in GuidedUpload.tsx's PLATFORM_OPTIONS.dji.
          link: "/files?section=guided&platform=dji&option=__thermal__",
        })
        // Fire-and-forget — see pollConversionJob's own comment for why this
        // intentionally outlives this component.
        pollConversionJob(jobId, processId, updateProcess, (status) => {
          setProgress(status)
          if (status.status === "done" || status.status === "error") setStep("done")
        })
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to start conversion"))
  }

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-muted-foreground text-sm">
        Pick a folder of raw DJI thermal images (paired <code>_T.JPG</code> /{" "}
        <code>_V.JPG</code> files) — they'll be uploaded, then converted to
        per-pixel Celsius GeoTIFFs right here.
      </p>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {step === "pick" && pendingConversions.length > 0 && (
        <div className="space-y-2 rounded-md border p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <History className="h-4 w-4" /> Awaiting conversion
          </p>
          <p className="text-muted-foreground text-xs">
            These folders were already uploaded but haven't been converted yet.
          </p>
          <div className="space-y-1.5">
            {pendingConversions.map((pc) => (
              <button
                key={pc.file_upload_id}
                type="button"
                onClick={() => resumeConversion(pc)}
                className="hover:border-primary/50 flex w-full items-center justify-between rounded border px-3 py-2 text-left text-sm transition-colors"
              >
                <span>
                  {[pc.experiment, pc.location, pc.population, pc.date]
                    .filter(Boolean)
                    .join(" / ")}
                </span>
                <span className="text-muted-foreground text-xs">
                  {pc.thermal_count} thermal
                  {pc.paired_count > 0 ? ` · ${pc.paired_count} paired RGB` : ""}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === "pick" && (
        <Button onClick={handlePickDirectory}>
          <FolderOpen className="mr-2 h-4 w-4" />
          Pick Thermal Image Folder
        </Button>
      )}

      {scan && step !== "pick" && (
        <div className="rounded-md border p-3 text-sm">
          <p>
            Found <strong>{scan.thermal_count}</strong> thermal images (
            <strong>{scan.paired_count}</strong> with a paired RGB image),{" "}
            {scan.total_count} files total.
          </p>
          {scan.other_count > 0 && (
            <p className="text-muted-foreground mt-1 text-xs">
              {scan.other_count} other file{scan.other_count === 1 ? "" : "s"} in this
              folder will be left behind — only thermal and paired RGB images are uploaded.
            </p>
          )}
        </div>
      )}

      {step === "scanned" && (
        <div className="space-y-4">
          <DataStructureForm
            fileType="Image Data"
            values={formValues}
            onChange={(field, value) => setFormValues((prev) => ({ ...prev, [field]: value }))}
            hideImageType
          />
          <Button onClick={handleUpload}>
            Upload {scan ? scan.thermal_count + scan.paired_count : 0} files
          </Button>
        </div>
      )}

      {step === "uploading" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Uploading…
        </p>
      )}

      {(step === "uploaded" || step === "converting" || step === "done") && (
        <div className="space-y-3 rounded-md border p-3">
          <p className="text-sm font-medium">Run Thermal Conversion</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Distance (m)</Label>
              <Input
                type="number" step="0.5" min="0" className="mt-1"
                value={distance}
                onChange={(e) => setDistance(parseFloat(e.target.value) || 0)}
                disabled={step !== "uploaded"}
              />
            </div>
            <div>
              <Label className="text-xs">Emissivity</Label>
              <Input
                type="number" step="0.05" min="0" max="1" className="mt-1"
                value={emissivity}
                onChange={(e) => setEmissivity(parseFloat(e.target.value) || 0)}
                disabled={step !== "uploaded"}
              />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">Weather Station File (optional)</Label>
              {step === "uploaded" && (
                <button
                  type="button"
                  onClick={() => setShowWeatherUpload((v) => !v)}
                  className="text-primary flex items-center gap-0.5 text-xs hover:underline"
                >
                  {weatherFiles.length === 0 ? "Add a weather file" : "Manage weather files"}
                  {showWeatherUpload ? (
                    <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                </button>
              )}
            </div>
            {weatherFiles.length === 0 && !showWeatherUpload && (
              <p className="text-muted-foreground mt-1 text-xs">
                No weather files uploaded yet — add one for automatic humidity/temperature
                matching, or use the fixed values below.
              </p>
            )}
            {showWeatherUpload && step === "uploaded" ? (
              <div className="mt-2 rounded border p-2">
                <WeatherFileUploadForm onChange={setWeatherFiles} />
              </div>
            ) : (
              <select
                className="border-input bg-background mt-1 w-full rounded border px-2 py-1.5 text-sm"
                value={weatherFileId}
                onChange={(e) => setWeatherFileId(e.target.value)}
                disabled={step !== "uploaded"}
              >
                <option value="">None — use fixed values below</option>
                {weatherFiles.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            )}
          </div>
          {!weatherFileId && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Humidity (%)</Label>
                <Input
                  type="number" step="1" min="0" max="100" className="mt-1"
                  value={humidity}
                  onChange={(e) => setHumidity(parseFloat(e.target.value) || 0)}
                  disabled={step !== "uploaded"}
                />
              </div>
              <div>
                <Label className="text-xs">Ambient Temp (°C)</Label>
                <Input
                  type="number" step="0.5" className="mt-1"
                  value={ambientTemp}
                  onChange={(e) => setAmbientTemp(parseFloat(e.target.value) || 0)}
                  disabled={step !== "uploaded"}
                />
              </div>
            </div>
          )}

          {step === "uploaded" && <Button onClick={handleConvert}>Start Conversion</Button>}

          {(step === "converting" || step === "done") && progress && (
            <div className="space-y-1.5">
              {progress.message ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                  {progress.message}
                </p>
              ) : (
                <>
                  <Progress value={progress.total > 0 ? (progress.done / progress.total) * 100 : 0} />
                  <p className="text-xs text-muted-foreground">
                    {progress.status === "error"
                      ? `Error: ${progress.error}`
                      : `${progress.done}/${progress.total} converted`}
                  </p>
                </>
              )}
              {progress.images.length > 0 && (
                <div className="grid grid-cols-3 gap-2 pt-2 sm:grid-cols-4">
                  {progress.images.map((img) => (
                    <div key={img.name} className="rounded border overflow-hidden">
                      <img
                        src={`${(window as any).__GEMI_BACKEND_URL__ ?? ""}/api/v1/thermal/preview?path=${encodeURIComponent(img.path)}`}
                        alt={img.name}
                        className="w-full aspect-square object-cover bg-black/5"
                      />
                      <div className="p-1 text-[10px] text-muted-foreground truncate">
                        {img.min_temp.toFixed(1)}–{img.max_temp.toFixed(1)}°C
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
