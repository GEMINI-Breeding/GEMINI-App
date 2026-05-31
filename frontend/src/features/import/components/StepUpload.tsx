/**
 * Phase 9e step 4 (terminal step before Confirm): orchestrate the trait
 * import.
 *
 *   1. Setup-create entities the metadata step said are new
 *      (sensor platform, sensor, datasets). Experiment was already
 *      materialized by the Files page's `resolveScope` before the
 *      wizard mounted (see ImportWizardDialog).
 *   2. Upload the spreadsheet file via the chunked-upload queue (which
 *      records each upload in `experiment_files` so cascade-delete
 *      cleans them up).
 *   3. Pre-create per-sheet entities the bulk record insert needs:
 *      traits, populations, seasons, sites, optional inline accessions/
 *      lines, and plots (bulk-chunked at 500/POST).
 *   4. POST trait records 500 at a time to
 *      `apiTraitsIdTraitIdRecordsBulkBulkAddTraitRecords`, grouped by
 *      `(season, site)`.
 *
 * The pure record-walking + plot-spec logic lives in `lib/recordBuilder.ts`.
 *
 * Ported from `backend/gemini-ui/src/components/import-wizard/step-upload.tsx`.
 */
import { useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, CheckCircle, Loader2, XCircle } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import {
  AccessionsService,
  type ExperimentOutput,
  ExperimentsService,
  LinesService,
  PopulationsService,
  SeasonsService,
  type SensorOutput,
  type SensorPlatformOutput,
  SensorPlatformsService,
  SensorsService,
  SitesService,
  type TraitOutput,
  TraitsService,
} from "@/client"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useUploadQueue } from "@/features/files/hooks/useUploadQueue"
import { createOrGetDatasetForUpload } from "@/features/files/lib/datasetForUpload"
import { germplasmMappingMode } from "@/features/import/lib/germplasmMode"
import {
  humanizeImportError,
  type ImportErrorHint,
} from "@/features/import/lib/importErrorHints"
import {
  buildTraitRecords,
  collectPlotSpecs,
  collectPopulationNames,
  collectSeasonAndSiteNames,
  collectTraitUnits,
  type PlotSpec,
} from "@/features/import/lib/recordBuilder"
import { rollbackCreatedPlots } from "@/features/import/lib/rollbackPlots"
import type {
  ColumnMapping,
  FileWithPath,
  GermplasmReview,
  ImportMetadata,
  SensorClassification,
  UploadResults,
} from "@/features/import/lib/types"
import { extractApiErrorMessage } from "@/lib/apiError"
import { runWithConcurrency } from "@/lib/concurrency"
import { DataFormat, DataType, SensorType } from "@/lib/geminiEnums"

interface StepUploadProps {
  files: FileWithPath[]
  metadata: ImportMetadata
  columnMapping?: ColumnMapping | null
  germplasmReview?: GermplasmReview | null
  /** Forwarded to the host dialog so it can prompt the user before
   *  closing while ingest is mid-flight. Called with `true` while
   *  setup-creates / file-upload / record-ingest are running and
   *  `false` once the run reaches `done` or `error`. */
  onBusyChange?: (busy: boolean) => void
  onNext: (results: UploadResults) => void
  onBack: () => void
}

interface CreationStep {
  type: string
  name: string
  status: "pending" | "creating" | "done" | "skipped" | "error"
  id?: string
  error?: string
}

interface SetupProgress {
  traits: { done: number; total: number }
  populations: { done: number; total: number }
  seasons: { done: number; total: number }
  sites: { done: number; total: number }
  germplasm: { done: number; total: number }
  plots: { done: number; total: number }
}

const EMPTY_SETUP: SetupProgress = {
  traits: { done: 0, total: 0 },
  populations: { done: 0, total: 0 },
  seasons: { done: 0, total: 0 },
  sites: { done: 0, total: 0 },
  germplasm: { done: 0, total: 0 },
  plots: { done: 0, total: 0 },
}

const PLOT_CHUNK = 500
const RECORD_BATCH_SIZE = 500
/** Per-loop concurrency cap for setup creates (populations, seasons,
 *  sites, inline germplasm) and per-(season, site) bulk record POSTs.
 *  Picked to keep the backend's per-request DB pressure modest while
 *  still saturating network round-trip latency. */
const SETUP_CONCURRENCY = 4
const RECORD_CONCURRENCY = 4
const PLOT_CHUNK_CONCURRENCY = 2

type Phase = "creating" | "uploading" | "ingesting" | "done" | "error"

function buildObjectName(experimentName: string, file: FileWithPath): string {
  const today = new Date().toISOString().slice(0, 10)
  const path = file.path || file.name
  const dateMatch = path.match(/(\d{4}-\d{2}-\d{2})/)
  const date = dateMatch ? dateMatch[1] : today
  return `Raw/${date}/${experimentName}/${file.name}`
}

/**
 * Greatest common parent directory across a list of MinIO object
 * paths. Used to derive the thermal worker's `dataset_prefix` from
 * the per-file object paths the wizard already built. The trailing
 * `/` is included so the worker can pass the prefix straight to
 * `list_objects` without re-checking. Returns `""` if the inputs
 * have no shared parent.
 */
function commonParentPrefix(paths: string[]): string {
  if (paths.length === 0) return ""
  const parts = paths.map((p) => p.split("/"))
  // Strip the trailing filename segment from every path before
  // comparison — we want the parent directory, not the longest
  // shared filename prefix.
  const dirs = parts.map((segs) => segs.slice(0, -1))
  const minLen = Math.min(...dirs.map((d) => d.length))
  const common: string[] = []
  for (let i = 0; i < minLen; i++) {
    const seg = dirs[0][i]
    if (dirs.every((d) => d[i] === seg)) common.push(seg)
    else break
  }
  return common.length === 0 ? "" : `${common.join("/")}/`
}

export function StepUpload({
  files,
  metadata,
  columnMapping,
  germplasmReview,
  onBusyChange,
  onNext,
  onBack,
}: StepUploadProps) {
  const [creationSteps, setCreationSteps] = useState<CreationStep[]>([])
  const [phase, setPhase] = useState<Phase>("creating")
  const [setupProgress, setSetupProgress] = useState<SetupProgress>(EMPTY_SETUP)
  const [ingestionTotal, setIngestionTotal] = useState(0)
  const [ingestionDone, setIngestionDone] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [errorHint, setErrorHint] = useState<ImportErrorHint | null>(null)
  const [uploadedCount, setUploadedCount] = useState(0)
  const [uploadFailed, setUploadFailed] = useState(0)

  const startedRef = useRef(false)
  const abortedRef = useRef(false)
  const expIdRef = useRef<string | null>(metadata.experimentId)
  const createdRef = useRef<UploadResults["createdEntities"]>([])
  // Plots committed during this run, recorded so a mid-flight failure can
  // roll them back (they persist before the records that may fail).
  const createdPlotSpecsRef = useRef<PlotSpec[]>([])
  // True when the target experiment had ZERO plots before this run started.
  // That's the safe gate for bulk-rolling-back created plots on failure:
  // every plot now in the experiment is ours, so deleting them can't touch
  // anyone else's data. (`metadata.createNew.experiment` can't be used —
  // the Files page materializes "+ Create new" into an existing-experiment
  // choice via resolveScope before the wizard mounts.)
  const experimentWasEmptyRef = useRef(false)

  const uploadQueue = useUploadQueue()
  const queryClient = useQueryClient()

  const tickSetup = (key: keyof SetupProgress) =>
    setSetupProgress((prev) => ({
      ...prev,
      [key]: { done: prev[key].done + 1, total: prev[key].total },
    }))

  // Run once on mount. The hook only fires the orchestration once; an
  // abort flips `abortedRef` so the in-flight loops bail out.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run-once guard
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    // Tell the host dialog to refuse external dismissal until the run
    // reaches a terminal state. Using a ref here so we don't capture
    // a stale callback if React re-renders the component mid-run.
    onBusyChange?.(true)

    const steps: CreationStep[] = []
    if (metadata.createNew.experiment) {
      steps.push({
        type: "Experiment",
        name: metadata.experimentName,
        status: metadata.experimentId ? "done" : "pending",
        id: metadata.experimentId ?? undefined,
      })
    } else {
      steps.push({
        type: "Experiment",
        name: metadata.experimentName,
        status: "skipped",
        id: metadata.experimentId ?? undefined,
      })
    }
    if (metadata.createNew.sensorPlatform) {
      steps.push({
        type: "Sensor Platform",
        name: metadata.sensorPlatformName,
        status: "pending",
      })
    }
    if (metadata.createNew.sensor) {
      steps.push({
        type: "Sensor",
        name: metadata.sensorName,
        status: "pending",
      })
    }
    for (const dsName of metadata.datasetNames) {
      steps.push({ type: "Dataset", name: dsName, status: "pending" })
    }
    setCreationSteps([...steps])

    const updateStep = (index: number, patch: Partial<CreationStep>) => {
      setCreationSteps((prev) => {
        const next = [...prev]
        if (!next[index]) return prev
        next[index] = { ...next[index], ...patch }
        return next
      })
      Object.assign(steps[index], patch)
    }

    const orchestrate = async () => {
      try {
        await runOrchestration()
      } finally {
        // Whether we reached `done`, `error`, or aborted, the dialog
        // is now safe to close — release the busy lock.
        onBusyChange?.(false)
        // Invalidate every cache key the import could have written to.
        // Without this, the Files-page Upload form's `useScopeOptions`
        // dropdowns (population / season / site / sensor / sensorPlatform
        // / experiment / trait / dataset) keep serving stale empty
        // lists until the page is reloaded — visible right after a
        // trait import when the user opens an Image Upload and the
        // Population dropdown shows no options. Even on partial /
        // aborted runs we may have written some rows, so invalidate
        // unconditionally.
        for (const key of [
          "experiments",
          "datasets",
          "traits",
          "populations",
          "seasons",
          "sites",
          "sensors",
          "sensorPlatforms",
          "accessions",
          "lines",
          "plots",
        ]) {
          queryClient.invalidateQueries({ queryKey: [key] })
        }
        // The Manage tab keys ["experiments", "<id>", "files"] etc. are
        // covered by the broad `["experiments"]` invalidation above.
      }
    }

    const runOrchestration = async () => {
      try {
        const created: UploadResults["createdEntities"] = []
        const experimentName = metadata.experimentName
        let experimentId = metadata.experimentId
        let stepIdx = 0

        if (metadata.createNew.experiment) {
          if (!experimentId) {
            updateStep(stepIdx, { status: "creating" })
            const exp = await createExperimentOrGet(experimentName)
            experimentId = exp.id ? String(exp.id) : null
            expIdRef.current = experimentId
            updateStep(stepIdx, {
              status: "done",
              id: experimentId ?? undefined,
            })
            created.push({
              type: "Experiment",
              name: experimentName,
              id: experimentId ?? "",
            })
          }
          stepIdx++
        } else {
          stepIdx++
        }
        if (abortedRef.current) return

        if (metadata.createNew.sensorPlatform) {
          updateStep(stepIdx, { status: "creating" })
          const sp = await createSensorPlatformOrGet(
            metadata.sensorPlatformName,
            experimentName,
          )
          updateStep(stepIdx, {
            status: "done",
            id: sp.id ? String(sp.id) : undefined,
          })
          created.push({
            type: "Sensor Platform",
            name: metadata.sensorPlatformName,
            id: sp.id ? String(sp.id) : "",
          })
          stepIdx++
        }
        if (abortedRef.current) return

        if (metadata.createNew.sensor) {
          updateStep(stepIdx, { status: "creating" })
          const sensor = await createSensorOrGet(
            metadata.sensorName,
            experimentName,
            metadata.sensorPlatformName,
            metadata.sensorClassification ?? null,
          )
          updateStep(stepIdx, {
            status: "done",
            id: sensor.id ? String(sensor.id) : undefined,
          })
          created.push({
            type: "Sensor",
            name: metadata.sensorName,
            id: sensor.id ? String(sensor.id) : "",
          })
          stepIdx++
        }
        if (abortedRef.current) return

        const createdDatasetIds: string[] = []
        for (const dsName of metadata.datasetNames) {
          updateStep(stepIdx, { status: "creating" })
          const result = await createOrGetDatasetForUpload({
            experimentName,
            dataTypeLabel: "Trait Data",
            explicitName: dsName,
          })
          const ds = result.dataset
          updateStep(stepIdx, {
            status: "done",
            id: ds.id ? String(ds.id) : undefined,
          })
          created.push({
            type: "Dataset",
            name: dsName,
            id: ds.id ? String(ds.id) : "",
          })
          if (ds.id) createdDatasetIds.push(String(ds.id))
          stepIdx++
        }
        if (abortedRef.current) return

        createdRef.current = created

        // Upload the file(s).
        setPhase("uploading")
        if (files.length > 0) {
          const tasks = files.map((file) => ({
            file,
            objectPath: buildObjectName(experimentName, file),
          }))
          // For thermal imports, kick off a single THERMAL_EXTRACT
          // after all uploads finish. The dataset prefix is the
          // common parent of every uploaded object path; the worker
          // lists thermal-extensioned objects under that prefix and
          // writes RGB previews + raw + JSON sidecars alongside.
          let postUploadJob:
            | {
                jobType: "THERMAL_EXTRACT"
                parameters: Record<string, unknown>
              }
            | undefined
          if (metadata.thermalCalibration && tasks.length > 0) {
            const datasetPrefix = commonParentPrefix(
              tasks.map((t) => t.objectPath),
            )
            postUploadJob = {
              jobType: "THERMAL_EXTRACT",
              parameters: {
                dataset_prefix: datasetPrefix,
                thermal_calibration: metadata.thermalCalibration,
              },
            }
          }
          try {
            const result = await uploadQueue.run(tasks, {
              title: `Importing ${tasks.length} file(s)`,
              experimentId: experimentId ?? undefined,
              // Trait CSV imports almost always create exactly one
              // dataset; if there happen to be several, the first one
              // owns the uploaded source CSV. Multi-dataset trait
              // imports are vanishingly rare and the helper still
              // works for them via the explicitName path above.
              datasetId: createdDatasetIds[0],
              postUploadJob,
            })
            setUploadedCount(result.uploaded.length)
          } catch (err) {
            setUploadFailed(files.length)
            throw err
          }
        }
        if (abortedRef.current) return

        // No record ingestion if there's no column mapping (genomic flow
        // never reaches StepUpload, but guard anyway).
        if (!columnMapping || columnMapping.recordType !== "trait") {
          setPhase("done")
          return
        }

        setPhase("ingesting")
        // Snapshot whether the experiment is empty BEFORE we create any
        // plots — gates the on-failure rollback (see experimentWasEmptyRef).
        experimentWasEmptyRef.current = await experimentHasNoPlots(
          metadata.experimentName,
        )
        await ingestTraitRecords({
          mapping: columnMapping,
          metadata,
          germplasmReview: germplasmReview ?? null,
          setSetupProgress,
          tickSetup: (k) => tickSetup(k),
          setIngestionTotal,
          setIngestionDone,
          abortedRef,
          onPlotsCreated: (specs) => {
            createdPlotSpecsRef.current = specs
          },
        })
        if (abortedRef.current) return
        setPhase("done")
      } catch (err) {
        const msg = extractApiErrorMessage(err)
        // Roll back plots this run committed before the failure — they
        // persist ahead of the records, and the backend never updates an
        // existing plot's accession, so leaving them poisons a corrected
        // retry. Only safe to bulk-delete when the experiment had NO plots
        // before this run (every plot in it is then ours). For experiments
        // that already had plots we can't tell ours from prior ones, so we
        // skip auto-delete and tell the user to retry in a fresh experiment.
        const finalMsg = await maybeRollbackPlots({
          rawMessage: msg,
          experimentCreatedThisRun: experimentWasEmptyRef.current,
          experimentName: metadata.experimentName,
          specs: createdPlotSpecsRef.current,
          abortedRef,
        })
        setErrorMessage(finalMsg)
        setErrorHint(humanizeImportError(finalMsg))
        setPhase("error")
        setCreationSteps((prev) => {
          const next = [...prev]
          const i = next.findIndex((s) => s.status === "creating")
          if (i >= 0) next[i] = { ...next[i], status: "error", error: msg }
          return next
        })
      }
    }
    void orchestrate()
  }, [])

  const isComplete = phase === "done"

  const handleContinue = () => {
    onNext({
      createdEntities: createdRef.current,
      uploadedFiles: uploadedCount,
      failedFiles: uploadFailed,
      experimentId: expIdRef.current,
    })
  }

  const handleAbort = () => {
    abortedRef.current = true
    setPhase("error")
    setErrorMessage(
      (prev) => prev ?? "Aborted by user — no further records will ingest.",
    )
    // The orchestrator's finally block also releases busy, but the
    // in-flight awaited POST may take a beat to unwind. Release here
    // too so the X button is immediately safe.
    onBusyChange?.(false)
  }

  return (
    <div className="space-y-6" data-testid="step-upload">
      <CreationStepsList steps={creationSteps} />

      {(phase === "ingesting" || (phase === "done" && columnMapping)) && (
        <SetupProgressCard progress={setupProgress} />
      )}

      {(phase === "ingesting" || (phase === "done" && columnMapping)) &&
        ingestionTotal > 0 && (
          <RecordIngestionCard done={ingestionDone} total={ingestionTotal} />
        )}

      {phase === "error" && errorMessage && (
        <div
          className="border-destructive/50 bg-destructive/5 flex items-start gap-2 rounded-md border p-4"
          data-testid="upload-error"
        >
          <AlertTriangle className="text-destructive mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-2 text-sm">
            <p className="text-destructive font-medium">Upload failed</p>
            {errorHint ? (
              <>
                <p
                  className="text-destructive/90"
                  data-testid="upload-error-hint"
                >
                  {errorHint.summary}
                </p>
                <p className="text-destructive/90 font-medium">
                  What to do:{" "}
                  <span className="font-normal">{errorHint.action}</span>
                </p>
                <details className="text-destructive/70">
                  <summary className="cursor-pointer select-none">
                    Technical detail
                  </summary>
                  <p className="mt-1 break-words">{errorHint.detail}</p>
                </details>
              </>
            ) : (
              <p className="text-destructive/80">{errorMessage}</p>
            )}
          </div>
        </div>
      )}

      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={phase === "error" ? onBack : handleAbort}
          disabled={isComplete}
        >
          {phase === "error" ? "Back" : isComplete ? "Back" : "Abort"}
        </Button>
        <Button
          onClick={handleContinue}
          disabled={!isComplete}
          data-testid="upload-continue"
        >
          Continue
        </Button>
      </div>
    </div>
  )
}

function CreationStepsList({ steps }: { steps: CreationStep[] }) {
  if (steps.length === 0) return null
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <h3 className="font-medium">Creating Entities</h3>
      <div className="space-y-2">
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            {step.status === "done" && (
              <CheckCircle className="h-4 w-4 shrink-0 text-green-600" />
            )}
            {step.status === "creating" && (
              <Loader2 className="text-primary h-4 w-4 shrink-0 animate-spin" />
            )}
            {step.status === "pending" && (
              <div className="border-muted-foreground h-4 w-4 shrink-0 rounded-full border" />
            )}
            {step.status === "skipped" && (
              <CheckCircle className="text-muted-foreground h-4 w-4 shrink-0" />
            )}
            {step.status === "error" && (
              <XCircle className="text-destructive h-4 w-4 shrink-0" />
            )}
            <span
              className={
                step.status === "skipped" ? "text-muted-foreground" : ""
              }
            >
              {step.type}: <span className="font-medium">{step.name}</span>
              {step.status === "skipped" && " (existing)"}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SetupProgressCard({ progress }: { progress: SetupProgress }) {
  const total =
    progress.traits.total +
    progress.populations.total +
    progress.seasons.total +
    progress.sites.total +
    progress.germplasm.total +
    progress.plots.total
  if (total === 0) return null

  const rows: [string, { done: number; total: number }][] = (
    [
      ["Traits", progress.traits],
      ["Populations", progress.populations],
      ["Seasons", progress.seasons],
      ["Sites", progress.sites],
      ["Germplasm", progress.germplasm],
      ["Plots", progress.plots],
    ] as const
  ).filter(([, p]) => p.total > 0) as [
    string,
    { done: number; total: number },
  ][]

  return (
    <div
      className="space-y-3 rounded-lg border p-4"
      data-testid="setup-progress"
    >
      <h3 className="font-medium">Preparing Records</h3>
      <div className="space-y-1.5 text-sm">
        {rows.map(([label, p]) => {
          const finished = p.done >= p.total
          return (
            <div key={label} className="flex items-center gap-2">
              {finished ? (
                <CheckCircle className="h-4 w-4 shrink-0 text-green-600" />
              ) : (
                <Loader2 className="text-primary h-4 w-4 shrink-0 animate-spin" />
              )}
              <span className="font-medium">{label}</span>
              <span className="text-muted-foreground ml-auto tabular-nums">
                {p.done} / {p.total}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RecordIngestionCard({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div
      className="space-y-3 rounded-lg border p-4"
      data-testid="ingestion-progress"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Record Ingestion</h3>
        <span className="text-muted-foreground text-sm tabular-nums">
          {done} / {total} records
        </span>
      </div>
      <Progress value={pct} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Idempotent create helpers — try to create, fall back to GET-by-name on
// failure (covers the StrictMode double-mount + cross-tab dedup case).
// ---------------------------------------------------------------------------

async function createExperimentOrGet(
  experimentName: string,
): Promise<ExperimentOutput> {
  try {
    return (await ExperimentsService.apiExperimentsCreateExperiment({
      requestBody: { experiment_name: experimentName },
    })) as ExperimentOutput
  } catch (err) {
    const existing = (await ExperimentsService.apiExperimentsGetExperiments({
      experimentName,
    })) as ExperimentOutput[] | null
    const match = existing?.find((e) => e.experiment_name === experimentName)
    if (match) return match
    throw err
  }
}

async function createSensorPlatformOrGet(
  sensorPlatformName: string,
  experimentName: string,
): Promise<SensorPlatformOutput> {
  try {
    return (await SensorPlatformsService.apiSensorPlatformsCreateSensorPlatform(
      {
        requestBody: {
          sensor_platform_name: sensorPlatformName,
          experiment_name: experimentName,
        },
      },
    )) as SensorPlatformOutput
  } catch (err) {
    const existing =
      (await SensorPlatformsService.apiSensorPlatformsGetSensorPlatforms({
        sensorPlatformName,
      })) as SensorPlatformOutput[] | null
    const match = existing?.find(
      (s) => s.sensor_platform_name === sensorPlatformName,
    )
    if (match) return match
    throw err
  }
}

async function createSensorOrGet(
  sensorName: string,
  experimentName: string,
  sensorPlatformName: string,
  classification: SensorClassification | null | undefined,
): Promise<SensorOutput> {
  // Default to (Default, Default, Default) when the caller didn't classify
  // — keeps the wizard usable for tabular/genomic imports that don't go
  // through StepMetadata's sensor branch. Image imports must classify or
  // downstream thermal/RGB branching can't tell sensors apart.
  const sensorTypeId = classification?.sensorTypeId ?? SensorType.Default
  const dataTypeId = classification?.dataTypeId ?? DataType.Default
  const dataFormatId = classification?.dataFormatId ?? DataFormat.Default
  try {
    return (await SensorsService.apiSensorsCreateSensor({
      requestBody: {
        sensor_name: sensorName,
        sensor_type_id: sensorTypeId as unknown as string,
        sensor_data_type_id: dataTypeId as unknown as string,
        sensor_data_format_id: dataFormatId as unknown as string,
        experiment_name: experimentName,
        sensor_platform_name: sensorPlatformName,
      },
    })) as SensorOutput
  } catch (err) {
    const existing = (await SensorsService.apiSensorsGetSensors({
      sensorName,
    })) as SensorOutput[] | null
    const match = existing?.find((s) => s.sensor_name === sensorName)
    if (match) return match
    throw err
  }
}

// ---------------------------------------------------------------------------
// Trait-record ingest — pulls every entity out of the column mapping +
// germplasm review, creates them (idempotent at the controller layer),
// then bulk-POSTs records grouped by (season, site).
// ---------------------------------------------------------------------------

interface IngestArgs {
  mapping: ColumnMapping
  metadata: ImportMetadata
  germplasmReview: GermplasmReview | null
  setSetupProgress: (
    fn: SetupProgress | ((prev: SetupProgress) => SetupProgress),
  ) => void
  tickSetup: (key: keyof SetupProgress) => void
  setIngestionTotal: (n: number) => void
  setIngestionDone: (n: number | ((prev: number) => number)) => void
  abortedRef: React.MutableRefObject<boolean>
  /** Called once the plot bulk-create has committed, with the specs that
   *  were submitted. Lets the orchestrator roll those plots back if a
   *  later record-insert fails (plots commit before records, so a failed
   *  import would otherwise leave orphan plots that poison a retry). */
  onPlotsCreated?: (specs: PlotSpec[]) => void
}

async function ingestTraitRecords({
  mapping,
  metadata,
  germplasmReview,
  setSetupProgress,
  tickSetup,
  setIngestionTotal,
  setIngestionDone,
  abortedRef,
  onPlotsCreated,
}: IngestArgs): Promise<void> {
  const { experimentName, datasetNames } = {
    experimentName: metadata.experimentName,
    datasetNames: metadata.datasetNames,
  }
  const traitUnits = collectTraitUnits(mapping)
  const populationNames = collectPopulationNames(mapping)
  const { seasonNames, siteNames } = collectSeasonAndSiteNames(mapping)
  const { plotSpecs, inlineGermplasmNames } = collectPlotSpecs(
    mapping,
    germplasmReview,
  )
  const mode = germplasmMappingMode(mapping)

  setSetupProgress({
    traits: { done: 0, total: traitUnits.size },
    populations: { done: 0, total: populationNames.size },
    seasons: { done: 0, total: seasonNames.size },
    sites: { done: 0, total: siteNames.size },
    germplasm: {
      done: 0,
      total:
        mode === "accession-only" || mode === "line-only"
          ? inlineGermplasmNames.size
          : 0,
    },
    plots: { done: 0, total: plotSpecs.length },
  })

  // Traits: create_or_get is server-side. Run in parallel; collect ids
  // as each finishes so the record-ingest phase can look them up.
  const traitIdByName = new Map<string, string>()
  const traitTasks: Array<() => Promise<void>> = []
  for (const [name, units] of traitUnits) {
    traitTasks.push(async () => {
      if (abortedRef.current) return
      const created = (await TraitsService.apiTraitsCreateTrait({
        requestBody: {
          trait_name: name,
          trait_units: units.trim() || undefined,
          trait_level_id: 0 as unknown as string,
          experiment_name: experimentName,
        },
      })) as TraitOutput
      if (!created.id) {
        throw new Error(`Failed to resolve trait ID for "${name}"`)
      }
      traitIdByName.set(name, String(created.id))
      tickSetup("traits")
    })
  }
  await runWithConcurrency(traitTasks, SETUP_CONCURRENCY)
  if (abortedRef.current) return

  // Populations / seasons / sites: server-side create_or_get; ignore
  // already-exists errors. All three groups run independently in
  // parallel within their own concurrency pool.
  const popTasks = Array.from(populationNames, (name) => async () => {
    if (abortedRef.current) return
    try {
      await PopulationsService.apiPopulationsCreatePopulation({
        requestBody: {
          population_name: name,
          experiment_name: experimentName,
        },
      })
    } catch {
      // already exists — safe to ignore
    }
    tickSetup("populations")
  })
  const seasonTasks = Array.from(seasonNames, (name) => async () => {
    if (abortedRef.current) return
    try {
      await SeasonsService.apiSeasonsCreateSeason({
        requestBody: {
          season_name: name,
          experiment_name: experimentName,
        },
      })
    } catch {
      // already exists — safe to ignore
    }
    tickSetup("seasons")
  })
  const siteTasks = Array.from(siteNames, (name) => async () => {
    if (abortedRef.current) return
    try {
      await SitesService.apiSitesCreateSite({
        requestBody: { site_name: name, experiment_name: experimentName },
      })
    } catch {
      // already exists — safe to ignore
    }
    tickSetup("sites")
  })
  await Promise.all([
    runWithConcurrency(popTasks, SETUP_CONCURRENCY),
    runWithConcurrency(seasonTasks, SETUP_CONCURRENCY),
    runWithConcurrency(siteTasks, SETUP_CONCURRENCY),
  ])
  if (abortedRef.current) return

  // Inline germplasm creation (unambiguous mapping). Map each name to
  // its first-seen population so the cascade-delete chain stays intact.
  if (mode === "accession-only" || mode === "line-only") {
    const populationForAccession = new Map<string, string>()
    for (const spec of plotSpecs) {
      if (!spec.accessionName || !spec.population) continue
      if (!populationForAccession.has(spec.accessionName)) {
        populationForAccession.set(spec.accessionName, spec.population)
      }
    }
    const germplasmTasks = Array.from(
      inlineGermplasmNames,
      (name) => async () => {
        if (abortedRef.current) return
        const popName = populationForAccession.get(name)
        if (mode === "line-only") {
          try {
            await LinesService.apiLinesCreateLine({
              requestBody: { line_name: name },
            })
          } catch {
            // already exists — safe to ignore
          }
          try {
            await AccessionsService.apiAccessionsCreateAccession({
              requestBody: {
                accession_name: name,
                line_name: name,
                ...(popName ? { population_name: popName } : {}),
              },
            })
          } catch {
            // already exists — safe to ignore
          }
        } else {
          try {
            await AccessionsService.apiAccessionsCreateAccession({
              requestBody: {
                accession_name: name,
                ...(popName ? { population_name: popName } : {}),
              },
            })
          } catch {
            // already exists — safe to ignore
          }
        }
        tickSetup("germplasm")
      },
    )
    await runWithConcurrency(germplasmTasks, SETUP_CONCURRENCY)
    if (abortedRef.current) return
  }

  // Bulk plot create. Each chunk is already 500 specs / POST; running a
  // couple of chunks in parallel cuts the wall-clock for tens-of-
  // thousands-of-rows spreadsheets in half without flooding the
  // backend.
  const plotChunkTasks: Array<() => Promise<void>> = []
  for (let i = 0; i < plotSpecs.length; i += PLOT_CHUNK) {
    const chunk = plotSpecs.slice(i, i + PLOT_CHUNK)
    plotChunkTasks.push(async () => {
      if (abortedRef.current) return
      // PlotsService schema requires plot_info on each plot — pass {} so
      // the optional-but-listed field is always present.
      await PlotsServiceCreateBulk(chunk, experimentName)
      for (let j = 0; j < chunk.length; j++) tickSetup("plots")
    })
  }
  await runWithConcurrency(plotChunkTasks, PLOT_CHUNK_CONCURRENCY)
  if (abortedRef.current) return
  // Record what we committed so the orchestrator can roll these plots
  // back if a record-insert fails below (plots are already persisted).
  if (plotSpecs.length > 0) onPlotsCreated?.(plotSpecs)

  // Build trait-record groups.
  const { groups, grandTotal } = buildTraitRecords(mapping)
  setIngestionTotal(grandTotal)
  setIngestionDone(0)

  // The bulk endpoint creates several name-keyed sibling rows
  // (dataset_seasons, dataset_sites, etc.) on the FIRST insert for a
  // new (trait, season, site, dataset) tuple — and the backend
  // re-raises DBAPIError as a 422 when a unique-constraint violation
  // happens. Two POSTs racing to seed the same tuple lose to that
  // unique constraint. To dodge the race, we send the FIRST batch in
  // each tuple sequentially (a warm-up pass that creates the sibling
  // rows), then run the remaining batches in parallel — at that point
  // every concurrent POST is just an INSERT into trait_records with
  // ON CONFLICT DO NOTHING and is safe.
  type Batch = {
    traitId: string
    season: string
    site: string
    population?: string
    collectionDate?: string
    records: Array<{ [key: string]: unknown }>
  }
  const buckets = new Map<string, Batch[]>()
  for (const group of groups) {
    const traitId = traitIdByName.get(group.traitName)
    if (!traitId) {
      throw new Error(
        `Trait "${group.traitName}" was not resolved during setup`,
      )
    }
    for (const [groupKey, groupRecords] of group.bySeasonSite) {
      const [groupSeason, groupSite] = groupKey.split("::")
      const bucketKey = `${traitId}::${groupSeason}::${groupSite}`
      const list: Batch[] = buckets.get(bucketKey) ?? []
      for (let off = 0; off < groupRecords.length; off += RECORD_BATCH_SIZE) {
        const slice = groupRecords.slice(off, off + RECORD_BATCH_SIZE)
        list.push({
          traitId,
          season: groupSeason,
          site: groupSite,
          population: group.population,
          collectionDate: group.collectionDate,
          records: slice as unknown as Array<{ [key: string]: unknown }>,
        })
      }
      buckets.set(bucketKey, list)
    }
  }

  const postBatch = async (b: Batch) => {
    if (abortedRef.current) return
    await TraitsService.apiTraitsIdTraitIdRecordsBulkBulkAddTraitRecords({
      traitId: b.traitId,
      requestBody: {
        records: b.records,
        experiment_name: experimentName,
        season_name: b.season,
        site_name: b.site,
        population_name: b.population,
        dataset_name: datasetNames[0] || undefined,
        collection_date: b.collectionDate,
      },
    })
    setIngestionDone((prev) => prev + b.records.length)
  }

  // Phase A — warm-up: send the first batch of each bucket FULLY
  // SEQUENTIALLY (concurrency 1). The Postgres `check_trait_validity`
  // trigger does a check-then-insert pattern on `gemini.datasets`,
  // `gemini.trait_datasets`, and `valid_trait_dataset_combinations`.
  // Concurrent first-time inserts for the same dataset row race on
  // the unique constraint and one wins while the others get a 422
  // bubbled up by `DBAPIError`. By serializing the first batch per
  // (trait, season, site) tuple, the trigger's INSERTs run one at a
  // time and we never lose a race.
  //
  // Cross-trait warm-ups also share unique constraints (every trait
  // we write to the same `dataset_name` writes one new row to
  // `trait_datasets` keyed on (trait_id, dataset_id) — concurrency-1
  // there too is the safe choice).
  const warmupTasks: Array<() => Promise<void>> = []
  const followupTasks: Array<() => Promise<void>> = []
  for (const list of buckets.values()) {
    if (list.length === 0) continue
    const [first, ...rest] = list
    warmupTasks.push(() => postBatch(first))
    for (const b of rest) followupTasks.push(() => postBatch(b))
  }
  await runWithConcurrency(warmupTasks, 1)
  if (abortedRef.current) return

  // Phase B — followups: every remaining batch can now run in parallel
  // safely. The sibling rows it would have raced to create already
  // exist; the trait_records INSERT itself uses ON CONFLICT DO NOTHING.
  await runWithConcurrency(followupTasks, RECORD_CONCURRENCY)
}

// PlotsService.apiPlotsBulkCreatePlotsBulk takes { plots: PlotInput[] }
// where each PlotInput is the plot_info-bearing shape. We materialize
// the bulk request inline here so the call site reads cleanly.
async function PlotsServiceCreateBulk(
  specs: import("@/features/import/lib/recordBuilder").PlotSpec[],
  experimentName: string,
): Promise<void> {
  const { PlotsService } = await import("@/client")
  await PlotsService.apiPlotsBulkCreatePlotsBulk({
    requestBody: {
      plots: specs.map(
        (spec) =>
          ({
            plot_number: spec.plotNumber,
            plot_row_number: spec.plotRow,
            plot_column_number: spec.plotCol,
            // experiment + season + site + accession + population are
            // resolved on the server from the provided names.
            experiment_name: experimentName,
            season_name: spec.season,
            site_name: spec.site,
            site_name_actual: undefined,
            population_name: spec.population,
            accession_name: spec.accessionName,
          }) as unknown as import("@/client").PlotInput,
      ),
    },
  })
}

/** True when the experiment currently has no plots — used to decide
 *  whether an on-failure rollback can safely bulk-delete created plots.
 *  Errs on the side of `false` (no rollback) if the lookup fails. */
async function experimentHasNoPlots(experimentName: string): Promise<boolean> {
  try {
    const { PlotsService } = await import("@/client")
    const plots = await PlotsService.apiPlotsGetPlots({ experimentName })
    return Array.isArray(plots) && plots.length === 0
  } catch {
    return false
  }
}

/**
 * On a failed import, roll back the plots this run committed (so a retry
 * starts clean) and return a message that tells the user the cleanup
 * outcome. Only auto-deletes when the experiment had no plots before this
 * run; otherwise it returns guidance to retry in a fresh experiment.
 */
async function maybeRollbackPlots(args: {
  rawMessage: string
  experimentCreatedThisRun: boolean
  experimentName: string
  specs: PlotSpec[]
  abortedRef: React.MutableRefObject<boolean>
}): Promise<string> {
  const { rawMessage, experimentCreatedThisRun, experimentName, specs } = args
  if (specs.length === 0) return rawMessage

  if (!experimentCreatedThisRun) {
    return (
      `${rawMessage}\n\n` +
      `Note: this import added plots to an existing experiment, so they ` +
      `were left in place. If you retry, do it in a brand-new experiment ` +
      `(or delete the partially-imported plots first) — otherwise the ` +
      `leftover plots from this attempt can cause the same error again.`
    )
  }

  try {
    const { PlotsService } = await import("@/client")
    const result = await rollbackCreatedPlots(
      PlotsService as Parameters<typeof rollbackCreatedPlots>[0],
      experimentName,
      specs,
      {
        signal: {
          get aborted() {
            return args.abortedRef.current
          },
        },
      },
    )
    if (result.failed > 0) {
      return (
        `${rawMessage}\n\n` +
        `Cleaned up ${result.deleted} of ${result.deleted + result.failed} ` +
        `plots created during this attempt (${result.failed} could not be ` +
        `removed automatically). You can safely fix the mapping and retry.`
      )
    }
    return (
      `${rawMessage}\n\n` +
      `The ${result.deleted} plots created during this attempt were rolled ` +
      `back, so you can fix the mapping and retry cleanly.`
    )
  } catch {
    return rawMessage
  }
}
