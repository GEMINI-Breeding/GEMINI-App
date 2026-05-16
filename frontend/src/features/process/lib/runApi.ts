/**
 * runApi — step-execution facade for the restored RunDetail.
 *
 * Main's RunDetail called `ProcessingService.executeStep({step, ...})` and
 * waited on an SSE stream keyed by pipeline_run_id. GEMINIbase has no
 * pipeline-run state machine and no `/execute-step` route; instead each
 * compute step is a plain Job submission.
 *
 * This module bridges the two: per `runId + step`, decide which Job (if
 * any) to submit, write the resulting job id back into the runStore so
 * runEvents/wsManager can subscribe, and expose markStepComplete /
 * markStepSkipped for steps that have no backend work.
 *
 * R4a wires data_sync, gcp_selection, orthomosaic. R4b/R4c/R5/R6 add the
 * remaining step types in this same file.
 */
import { type JobOutput, JobsService } from "@/client"

import type { AerialScope } from "@/features/process/lib/paths"
import {
  appendStepJobId,
  getRun,
  type Id,
  type RunStepStatus,
  setStepState,
  updateRun,
} from "@/features/process/lib/runStore"
import {
  checkThermalGpsPreflight,
  ThermalGpsRequiredError,
} from "@/features/process/lib/thermalGpsPreflight"

export interface OrthomosaicParams {
  reconstruction_quality?: string
  custom_options?: string
}

export interface TraitExtractionParams {
  /** MinIO path to the chosen ortho TIF (no bucket prefix). */
  orthomosaicPath: string
  /** MinIO path to the active plot-boundary GeoJSON (no bucket prefix). */
  boundaryGeojsonPath: string
  /** Optional MinIO path to a DEM TIF. */
  demPath?: string
  /** ExG vegetation threshold; defaults to 0.1 in the worker. */
  exgThreshold?: number
  /** MinIO path the worker should write the traits GeoJSON to (no bucket prefix). */
  outputTraitsGeojsonPath: string
}

export interface InferenceParams {
  /** MinIO path to the input image (no bucket prefix). */
  imagePath: string
  /** Roboflow API key. */
  apiKey: string
  /** "workspace/model/version" or "workspace/model". */
  modelId: string
  /** Default 0.1 in the worker. */
  confidenceThreshold?: number
  /** Default 0.5 in the worker. */
  iouThreshold?: number
  /** Where to write the predictions JSON (no bucket prefix). */
  outputPredictionsPath: string
}

export interface StitchingParams {
  /** MinIO object paths in stitch order (no bucket prefix). */
  imagePaths: string[]
  /** MinIO path to write the resulting mosaic (no bucket prefix). */
  outputMosaicPath: string
  /** AgRowStitch YAML knobs from the pipeline params. */
  config?: Record<string, unknown>
  /** AgRowStitch treats 0 as "auto"; defaults to (cores - 1) in the worker. */
  cpuCount?: number
}

export interface ExecuteStepInput {
  runId: Id
  stepKey: string
  /** Resolved aerial scope (date, platform, sensor, name path components). */
  scope: AerialScope
  /**
   * Dataset short-ids selected for this step. Empty / undefined means
   * "all datasets at this scope" — the worker recurses the scope root.
   * Set to one or more 8-hex segments to restrict the job to specific
   * uploads.
   */
  datasetShortIds?: string[]
  /** GEMINIbase Experiment.id from the workspace. */
  experimentId: string
  /** Per-step parameters. */
  orthomosaic?: OrthomosaicParams
  traitExtraction?: TraitExtractionParams
  inference?: InferenceParams
  stitching?: StitchingParams
}

export interface ExecuteStepResult {
  /** Job uuid if a backend job was submitted; null for no-op steps. */
  jobId: string | null
  /** True if the step is now complete (no further user action needed). */
  done: boolean
}

/**
 * Submit (or virtually-execute) a step. Updates the runStore in place.
 * Throws if the step type is unknown — callers should pre-check kind.
 */
export async function executeStep(
  input: ExecuteStepInput,
): Promise<ExecuteStepResult> {
  const { runId, stepKey, scope, experimentId, orthomosaic } = input
  const datasetShortIds = input.datasetShortIds ?? []

  switch (stepKey) {
    case "data_sync": {
      // GEMINIbase has no separate sync step — uploads already populate the
      // raw image prefix when files land. Mark complete immediately; the
      // RunDetail UI will re-poll the file listing to confirm images exist.
      setStepState(runId, "data_sync", {
        status: "completed",
        completedAt: new Date().toISOString(),
      })
      return { jobId: null, done: true }
    }

    case "gcp_selection": {
      // GCP marks live client-side until the user opens the GcpPicker tool
      // (R5). Here we just flip the step to "completed" if the user clicked
      // "skip" (no marks needed) — the actual mark→gcp_list.txt upload
      // happens inside the picker. This branch is the "skip" path.
      setStepState(runId, "gcp_selection", {
        status: "skipped",
        completedAt: new Date().toISOString(),
      })
      return { jobId: null, done: true }
    }

    case "orthomosaic": {
      // Preflight: if any selected dataset is a thermal dataset whose
      // worker-written summary says `has_gps=false`, refuse to submit.
      // ODM would otherwise spin for ~10 minutes before bailing on
      // "Not enough features" — a worse UX and a wasted compute slot.
      // Non-thermal datasets (no sidecar) pass through unchanged. When
      // the user picked "all datasets at this scope" (empty list), we
      // skip the preflight: there's no canonical short-id to check
      // against and the wizard shows a separate "all datasets selected"
      // affordance for that case.
      let preflight: Awaited<
        ReturnType<typeof checkThermalGpsPreflight>
      > = { kind: "ok", thermal: false, hasGps: false }
      for (const shortId of datasetShortIds) {
        // eslint-disable-next-line no-await-in-loop
        const result = await checkThermalGpsPreflight(scope, shortId)
        if (result.kind === "missing_gps") {
          throw new ThermalGpsRequiredError(result.mode, result.totalFiles)
        }
        // First thermal-with-GPS hit wins for the quality-preset
        // heuristic below.
        if (
          result.kind === "ok" &&
          result.thermal &&
          preflight.kind === "ok" &&
          !preflight.thermal
        ) {
          preflight = result
        }
      }
      const params: Record<string, unknown> = {
        year: scope.year,
        experiment: scope.experiment,
        location: scope.location,
        population: scope.population,
        date: scope.date,
        platform: scope.platform,
        sensor: scope.sensor,
        // Worker uses dataset_short_ids to restrict listing; absent =>
        // recursive listing under the scope root (legacy / "all"
        // semantics).
        ...(datasetShortIds.length > 0
          ? { dataset_short_ids: datasetShortIds }
          : {}),
        // Default Medium quality for radiometric thermal scopes — the
        // low-contrast, narrow-temperature-range raw previews
        // over-detect features at the default High preset. The user
        // can still override via the orthomosaic params input.
        ...(preflight.kind === "ok" &&
        preflight.thermal &&
        !orthomosaic?.reconstruction_quality &&
        !orthomosaic?.custom_options
          ? { reconstruction_quality: "Medium" }
          : {}),
        ...(orthomosaic?.reconstruction_quality
          ? { reconstruction_quality: orthomosaic.reconstruction_quality }
          : {}),
        ...(orthomosaic?.custom_options
          ? { custom_options: orthomosaic.custom_options }
          : {}),
      }
      const job = (await JobsService.apiJobsSubmitSubmitJob({
        requestBody: {
          job_type: "RUN_ODM",
          parameters: params,
          experiment_id: experimentId,
        } as Parameters<
          typeof JobsService.apiJobsSubmitSubmitJob
        >[0]["requestBody"],
      })) as JobOutput
      const jobId = String(job?.id ?? "")
      if (!jobId) throw new Error("RUN_ODM submitted but no job id returned")
      appendStepJobId(runId, "orthomosaic", jobId)
      // appendStepJobId flips the step to running and sets startedAt.
      // Bump the Run's status so WorkspaceDetail's run badge reflects activity.
      const r = getRun(runId)
      if (r && r.status === "draft") updateRun(runId, { status: "running" })
      return { jobId, done: false }
    }

    case "trait_extraction": {
      if (!input.traitExtraction) {
        throw new Error("trait_extraction requires ortho + boundary inputs")
      }
      const t = input.traitExtraction
      const params: Record<string, unknown> = {
        orthomosaic_path: t.orthomosaicPath,
        boundary_geojson_path: t.boundaryGeojsonPath,
        output_traits_geojson_path: t.outputTraitsGeojsonPath,
        ...(t.demPath ? { dem_path: t.demPath } : {}),
        ...(typeof t.exgThreshold === "number"
          ? { exg_threshold: t.exgThreshold }
          : {}),
      }
      const job = (await JobsService.apiJobsSubmitSubmitJob({
        requestBody: {
          job_type: "EXTRACT_TRAITS",
          parameters: params,
          experiment_id: experimentId,
        } as Parameters<
          typeof JobsService.apiJobsSubmitSubmitJob
        >[0]["requestBody"],
      })) as JobOutput
      const jobId = String(job?.id ?? "")
      if (!jobId) {
        throw new Error("EXTRACT_TRAITS submitted but no job id returned")
      }
      appendStepJobId(runId, "trait_extraction", jobId)
      const r = getRun(runId)
      if (r && r.status === "draft") updateRun(runId, { status: "running" })
      return { jobId, done: false }
    }

    case "stitching": {
      if (!input.stitching) {
        throw new Error("stitching requires image paths + output path")
      }
      const s = input.stitching
      if (s.imagePaths.length < 2) {
        throw new Error("stitching requires at least 2 images")
      }
      const params: Record<string, unknown> = {
        image_paths: s.imagePaths,
        output_mosaic_path: s.outputMosaicPath,
        ...(s.config ? { config: s.config } : {}),
        ...(typeof s.cpuCount === "number" ? { cpu_count: s.cpuCount } : {}),
      }
      const job = (await JobsService.apiJobsSubmitSubmitJob({
        requestBody: {
          job_type: "RUN_STITCH",
          parameters: params,
          experiment_id: experimentId,
        } as Parameters<
          typeof JobsService.apiJobsSubmitSubmitJob
        >[0]["requestBody"],
      })) as JobOutput
      const jobId = String(job?.id ?? "")
      if (!jobId) throw new Error("RUN_STITCH submitted but no job id returned")
      appendStepJobId(runId, "stitching", jobId)
      const r = getRun(runId)
      if (r && r.status === "draft") updateRun(runId, { status: "running" })
      return { jobId, done: false }
    }

    case "associate_boundaries": {
      // GEMINIbase has no ASSOCIATE_BOUNDARIES worker yet — see
      // findings.md "Ground pipeline gaps". Treat as a client-side
      // no-op until the JobType + worker land. The step's outputs
      // record this so downstream consumers know the association is
      // synthetic.
      setStepState(runId, "associate_boundaries", {
        status: "completed",
        completedAt: new Date().toISOString(),
        outputs: {
          ...(getRun(runId)?.steps.associate_boundaries?.outputs ?? {}),
          synthetic: true,
          note: "Client-side no-op until ASSOCIATE_BOUNDARIES JobType + geo-worker handler land. See findings.md Ground pipeline gaps.",
        },
      })
      return { jobId: null, done: true }
    }

    case "inference": {
      if (!input.inference) {
        throw new Error("inference requires image + model + api_key")
      }
      const i = input.inference
      const params: Record<string, unknown> = {
        image_path: i.imagePath,
        api_key: i.apiKey,
        model_id: i.modelId,
        output_predictions_path: i.outputPredictionsPath,
        ...(typeof i.confidenceThreshold === "number"
          ? { confidence_threshold: i.confidenceThreshold }
          : {}),
        ...(typeof i.iouThreshold === "number"
          ? { iou_threshold: i.iouThreshold }
          : {}),
      }
      const job = (await JobsService.apiJobsSubmitSubmitJob({
        requestBody: {
          job_type: "LOCATE_PLANTS",
          parameters: params,
          experiment_id: experimentId,
        } as Parameters<
          typeof JobsService.apiJobsSubmitSubmitJob
        >[0]["requestBody"],
      })) as JobOutput
      const jobId = String(job?.id ?? "")
      if (!jobId) {
        throw new Error("LOCATE_PLANTS submitted but no job id returned")
      }
      appendStepJobId(runId, "inference", jobId)
      const r = getRun(runId)
      if (r && r.status === "draft") updateRun(runId, { status: "running" })
      return { jobId, done: false }
    }

    default:
      throw new Error(`runApi.executeStep: step "${stepKey}" not yet wired`)
  }
}

/**
 * Stop a step. Cancels every Job currently associated with it.
 */
export async function stopStep(runId: Id, stepKey: string): Promise<void> {
  const run = getRun(runId)
  if (!run) return
  const step = run.steps[stepKey]
  if (!step) return
  for (const jobId of step.jobIds) {
    try {
      await JobsService.apiJobsJobIdCancelCancelJob({ jobId })
    } catch {
      // Best-effort — the job may already be terminal.
    }
  }
  setStepState(runId, stepKey, {
    status: "failed" as RunStepStatus,
    error: "Cancelled",
    completedAt: new Date().toISOString(),
  })
}

/** Mark a step as completed without executing it (used by markStepComplete). */
export function markStepComplete(runId: Id, stepKey: string): void {
  setStepState(runId, stepKey, {
    status: "completed",
    completedAt: new Date().toISOString(),
  })
}

/** Mark a step as skipped (e.g. user chooses to skip an optional step). */
export function markStepSkipped(runId: Id, stepKey: string): void {
  setStepState(runId, stepKey, {
    status: "skipped",
    completedAt: new Date().toISOString(),
  })
}
