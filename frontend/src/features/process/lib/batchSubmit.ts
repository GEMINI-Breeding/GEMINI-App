/**
 * Starting a step on one date without opening its run, with the defaults the
 * run page would use: the run's orthomosaic(s) (one per treatment flown
 * apart), its active plot boundaries, the elevation model beside each
 * orthomosaic, ExG 0.10. Used by the run list's "Run across dates".
 *
 * Inputs are read when the step starts, not when the batch is planned, so a
 * step queued behind another (inference after plot images) sees what that
 * one made.
 */
import {
  type FileMetadata,
  FilesService,
  type JobOutput,
  JobsService,
  OpenAPI,
  PlotGeometryService,
} from "@/client"
import { getToken } from "@/lib/auth"
import { titilerBase } from "@/lib/stack"
import {
  availableSource,
  type BatchStep,
  type DateFacts,
  FACTS_MATCH,
  folderFacts,
  type ImageSource,
} from "./batchPlan"
import {
  type InferenceModel,
  modelDisplayName,
  modelJobParams,
} from "./inferenceModels"
import {
  assignCovering,
  type Bounds,
  currentOrthoJobIds,
  type FolderOrtho,
  folderOrthos,
} from "./multiOrtho"
import {
  type AerialScope,
  framesRunKey,
  isAerialScopeComplete,
  plotFramesPrefix,
  plotImagesPrefix,
  processedPrefix,
} from "./paths"
import { countLabelOf, flightDir } from "./recountThreshold"
import { executeStep } from "./runApi"
import { getRun, type Run, setStepState } from "./runStore"

const BUCKET = "gemini"

export function runScope(run: Run): AerialScope | null {
  const u = run.uploadScope
  if (!u) return null
  const s = {
    year: u.year,
    experiment: u.experiment,
    location: u.location,
    population: u.population,
    date: u.date,
    platform: u.platform,
    sensor: u.sensor,
  }
  return isAerialScopeComplete(s) ? (s as AerialScope) : null
}

/** A date's folder: just the names facts and inputs are read from (an
 *  older server ignores the filter and sends the whole folder). */
export async function dateFiles(scope: AerialScope): Promise<FileMetadata[]> {
  const base = (OpenAPI.BASE ?? "").replace(/\/$/, "")
  const path = `${BUCKET}/${processedPrefix(scope)}`
    .split("/")
    .map(encodeURIComponent)
    .join("/")
  const res = await fetch(
    `${base}/api/files/list/${path}?match=${encodeURIComponent(FACTS_MATCH)}`,
    { headers: { Authorization: `Bearer ${getToken()}` } },
  )
  if (!res.ok) throw new Error(`Listing ${scope.date} failed (${res.status})`)
  return ((await res.json()) as FileMetadata[] | null) ?? []
}

/** The run's active plot boundaries and their version. */
export async function activeBoundaries(
  directory: string,
): Promise<{ version: number; fc: GeoJSON.FeatureCollection } | null> {
  const versions =
    ((await PlotGeometryService.apiPlotGeometryVersionsListListVersions({
      requestBody: { directory },
    })) ?? []) as Array<{ version: number; is_active?: boolean }>
  const version =
    versions.find((v) => v.is_active)?.version ?? versions[0]?.version
  if (version == null) return null
  const loaded =
    (await PlotGeometryService.apiPlotGeometryVersionsLoadLoadVersion({
      requestBody: { directory, version },
    })) as unknown as {
      state_snapshot?: { boundaries?: GeoJSON.FeatureCollection }
    }
  const fc = loaded?.state_snapshot?.boundaries
  if (!fc?.features?.length) return null
  // The outer field outline is not a plot.
  const plots = fc.features.filter(
    (f) => (f.properties as { role?: string } | null)?.role !== "outer",
  )
  return plots.length ? { version, fc: { ...fc, features: plots } } : null
}

/** The orthomosaics a run uses: its treatments' (flown apart), else its
 *  newest. Quick ones made only for raw frames are left out. */
export function runOrthos(run: Run, files: FileMetadata[]): FolderOrtho[] {
  const scope = runScope(run)
  if (!scope) return []
  const all = folderOrthos(files, processedPrefix(scope))
  const ids = new Set(currentOrthoJobIds(run))
  const mine = all.filter((o) => o.jobId && ids.has(o.jobId))
  if (mine.length) return mine
  const quick = new Set(quickOrthoJobIds(run))
  const full = all.filter((o) => !o.jobId || !quick.has(o.jobId))
  return full.length ? [full[full.length - 1]] : []
}

export function quickOrthoJobIds(run: Run): string[] {
  const out = run.steps.orthomosaic?.outputs as
    | { quickOrthoJobIds?: string[] }
    | undefined
  return out?.quickOrthoJobIds ?? []
}

/** Everything the planner needs about one date. */
export async function gatherFacts(
  run: Run,
  locateJobs: JobOutput[],
): Promise<{ facts: DateFacts; files: FileMetadata[] } | null> {
  const scope = runScope(run)
  if (!scope) return null
  const dir = processedPrefix(scope)
  const [files, bounds] = await Promise.all([
    dateFiles(scope),
    activeBoundaries(dir).catch(() => null),
  ])
  const ff = folderFacts(files, framesRunKey(run.uploadScope?.batchLabel))
  const traitsFile = files.some((f) =>
    /\/traits\/[^/]*traits[^/]*\.geojson$/.test(f.object_name ?? ""),
  )
  const inferred = locateJobs
    .filter((j) => {
      const p = String(
        ((j.parameters ?? {}) as { output_predictions_path?: string })
          .output_predictions_path ?? "",
      )
      return flightDir(p) === dir
    })
    .map(countLabelOf)
  return {
    files,
    facts: {
      runId: run.id,
      date: scope.date,
      population: scope.population,
      boundaries: Boolean(bounds),
      orthos: runOrthos(run, files).length,
      cameras: ff.cameras,
      images: ff.images,
      // A labelled run (one of a day's several flights) shares the folder:
      // only its own step says it is done.
      traits:
        run.steps.trait_extraction?.status === "completed" ||
        (traitsFile && !run.uploadScope?.batchLabel),
      inferred,
    },
  }
}

async function extent(o: FolderOrtho): Promise<Bounds> {
  const url = `s3://${BUCKET}/${o.cogPath ?? o.path}`
  const res = await fetch(
    `${titilerBase()}/cog/WebMercatorQuad/tilejson.json?url=${encodeURIComponent(url)}&tilesize=256`,
  )
  if (!res.ok)
    throw new Error(
      `Could not read the ${o.path.split("/").pop()} extent (${res.status})`,
    )
  return ((await res.json()) as { bounds: Bounds }).bounds
}

/** Each orthomosaic with the plots measured on it (the one covering each). */
async function plotsByOrtho(
  orthos: FolderOrtho[],
  fc: GeoJSON.FeatureCollection,
): Promise<{ o: FolderOrtho; features: GeoJSON.Feature[] }[]> {
  if (orthos.length < 2) return [{ o: orthos[0], features: fc.features }]
  const bounds = await Promise.all(orthos.map(extent))
  const groups = assignCovering(fc.features, bounds)
  return orthos
    .map((o, i) => ({ o, features: groups[i] }))
    .filter((g) => g.features.length)
}

async function upload(path: string, value: unknown) {
  const file = new File([JSON.stringify(value)], path.split("/").pop() ?? "x", {
    type: "application/geo+json",
  })
  await FilesService.apiFilesUploadUploadFile({
    formData: { file, bucket_name: BUCKET, object_name: path },
  })
}

export interface StartOptions {
  plotSource: "ortho" | "frames"
  model: InferenceModel | null
  localServerUrl?: string
  sources: ImageSource[]
}

/** Start `step` on one date. Returns the job ids started. */
export async function startStep(
  runId: string,
  step: BatchStep,
  o: StartOptions,
): Promise<string[]> {
  const run = getRun(runId)
  if (!run) throw new Error("run not found")
  const scope = runScope(run)
  const experimentId = run.uploadScope?.experimentId
  if (!scope || !experimentId) throw new Error("run has no complete scope")
  const dir = processedPrefix(scope)
  const files = await dateFiles(scope)

  if (step === "quick_ortho") {
    const parts = run.uploadScope?.treatments?.map((t) => [t.datasetShortId])
    const sets = parts?.length
      ? parts
      : [run.uploadScope?.datasetShortIds ?? []]
    const ids: string[] = []
    for (const dataset of sets) {
      // eslint-disable-next-line no-await-in-loop
      const job = (await JobsService.apiJobsSubmitSubmitJob({
        requestBody: {
          job_type: "RUN_ODM",
          parameters: {
            year: scope.year,
            experiment: scope.experiment,
            location: scope.location,
            population: scope.population,
            date: scope.date,
            platform: scope.platform,
            sensor: scope.sensor,
            reconstruction_quality: "Quick (boundaries + raw frames)",
            skip_gcps: true,
            ...(dataset.length ? { dataset_short_ids: dataset } : {}),
          },
          experiment_id: experimentId,
        } as Parameters<
          typeof JobsService.apiJobsSubmitSubmitJob
        >[0]["requestBody"],
      })) as JobOutput
      ids.push(String(job?.id ?? ""))
    }
    // Kept apart from the run's orthomosaics: quick ones only place frames.
    const prev = (run.steps.orthomosaic?.outputs ?? {}) as Record<
      string,
      unknown
    >
    setStepState(run.id, "orthomosaic", {
      outputs: {
        ...prev,
        quickOrthoJobIds: [...quickOrthoJobIds(run), ...ids],
      },
    })
    return ids
  }

  const bounds = await activeBoundaries(dir)
  if (!bounds) throw new Error("no active plot boundaries")

  if (step === "plot_images") {
    const ids: string[] = []
    if (o.plotSource === "frames") {
      const mine = new Set([
        ...(run.steps.orthomosaic?.jobIds ?? []),
        ...quickOrthoJobIds(run),
      ])
      const names = new Set(files.map((f) => f.object_name ?? ""))
      const withCameras = folderOrthos(files, dir).filter(
        (x) => x.jobId && names.has(`${dir}odm_cameras-${x.jobId}.json`),
      )
      const own = withCameras.filter((x) => x.jobId && mine.has(x.jobId))
      const paths = (own.length ? own : withCameras).map((x) => x.path)
      if (!paths.length)
        throw new Error("no camera positions: run a quick orthomosaic first")
      const label = run.uploadScope?.batchLabel
      const key = framesRunKey(label)
      const r = await executeStep({
        runId: run.id,
        stepKey: "split_orthomosaic",
        scope,
        experimentId,
        splitOrthomosaic: {
          boundaries: bounds.fc,
          orthomosaicPath: paths[0],
          source: "frames",
          orthomosaicPaths: paths,
          ...(key ? { runKey: key, runLabel: label ?? "" } : {}),
        },
      })
      if (r.jobId) ids.push(r.jobId)
      return ids
    }
    const orthos = runOrthos(run, files)
    if (!orthos.length) throw new Error("no orthomosaic")
    for (const g of await plotsByOrtho(orthos, bounds.fc)) {
      // eslint-disable-next-line no-await-in-loop
      const r = await executeStep({
        runId: run.id,
        stepKey: "split_orthomosaic",
        scope,
        experimentId,
        splitOrthomosaic: {
          boundaries: { ...bounds.fc, features: g.features },
          orthomosaicPath: g.o.path,
        },
      })
      if (r.jobId) ids.push(r.jobId)
    }
    return ids
  }

  if (step === "trait_extraction") {
    const orthos = runOrthos(run, files)
    if (!orthos.length) throw new Error("no orthomosaic")
    const inputs = []
    for (const g of await plotsByOrtho(orthos, bounds.fc)) {
      const tag = (g.o.jobId ?? "ortho").slice(0, 8)
      const bPath = `${dir}traits/boundaries-v${bounds.version}-${tag}.geojson`
      // eslint-disable-next-line no-await-in-loop
      await upload(bPath, { ...bounds.fc, features: g.features })
      inputs.push({
        orthomosaicPath: g.o.path,
        boundaryGeojsonPath: bPath,
        outputTraitsGeojsonPath: `${dir}traits/traits-v${bounds.version}-${tag}.geojson`,
        exgThreshold: 0.1,
        ...(g.o.dsmPath ? { demPath: g.o.dsmPath } : {}),
      })
    }
    const r = await executeStep({
      runId: run.id,
      stepKey: "trait_extraction",
      scope,
      experimentId,
      ...(inputs.length > 1
        ? { traitExtractions: inputs }
        : { traitExtraction: inputs[0] }),
    })
    return r.jobId ? [r.jobId] : []
  }

  // inference
  if (!o.model) throw new Error("no model for this crop")
  const ff = folderFacts(files, framesRunKey(run.uploadScope?.batchLabel))
  const src = availableSource({ images: ff.images } as DateFacts, o.sources)
  if (!src) throw new Error("no plot images")
  const prefix =
    src === "ortho"
      ? plotImagesPrefix(scope)
      : `${plotFramesPrefix(scope, run.uploadScope?.batchLabel)}${src}/`
  const r = await executeStep({
    runId: run.id,
    stepKey: "inference",
    scope,
    experimentId,
    inference: {
      imagesPrefix: prefix,
      boundaries: bounds.fc,
      countLabel: modelDisplayName(o.model),
      model: modelJobParams(o.model, {
        localServerUrl: o.localServerUrl,
        prompt: o.model.hf_prompt,
      }),
      outputPredictionsPath: `${plotImagesPrefix(scope)}inference/all-plots-batch-${Date.now()}.json`,
    },
  })
  return r.jobId ? [r.jobId] : []
}
