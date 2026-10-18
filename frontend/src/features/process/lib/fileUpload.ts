/**
 * An upload becomes a run on the Process tab, without a person creating a
 * workspace, a pipeline and a run first.
 *
 * Called when a batch of field data (rover logs, drone or hand-held images)
 * has finished uploading. The batch's storage path names its scope
 * (`Raw/{year}/{experiment}/{site}/{population}/{date}/{platform}/{sensor}/
 * {batch}/…`), so:
 *   - a run of the same scope and pipeline type already holding this batch
 *     is returned as is;
 *   - a labelled batch (a run of the day, a treatment) joins only a run with
 *     the same label; unlabelled batches pool into one run per scope;
 *   - otherwise a new run is filed in the experiment's workspace, in a
 *     pipeline of its type (one with the same platform and sensor when there
 *     is one), with the wizard's default settings when a pipeline is made.
 *
 * The agent files its own uploads the same way (agent/gemi_agent/
 * process_runs.py `ensure_run`).
 */
import { pipelineForKind, workspaceForExperiment } from "./regroup"
import {
  createRun,
  getState,
  type PipelineType,
  type Run,
  updateRun,
} from "./runStore"

// Rovers and cameras carried or set up at ground level go through the ground
// pipeline; drones (built-in cameras or mounted sensors) through the aerial
// one. Mirrors GROUND_PLATFORMS in the agent.
const GROUND_WORDS = [
  "amiga",
  "rover",
  "monopod",
  "ground",
  "handheld",
  "hand-held",
  "phone",
  "camera",
  "tripod",
  "pole",
  "cart",
  "walk",
  "manual",
  "plot photos",
]

export function pipelineTypeFor(platform: string): PipelineType {
  const p = platform.trim().toLowerCase()
  return GROUND_WORDS.includes(p) ||
    ["handheld", "hand-held", "phone", "rover"].some((w) => p.includes(w))
    ? "ground"
    : "aerial"
}

/** The settings a pipeline made from an upload starts with (the wizard's defaults). */
export function defaultPipelineParams(
  type: PipelineType,
  platform: string,
): Record<string, unknown> {
  const common = { roboflow_models: [], inference_mode: "cloud" }
  if (type === "aerial")
    return {
      reconstruction_quality: "Standard",
      custom_odm_options: "",
      ...common,
    }
  const amiga = platform.toLowerCase().includes("amiga")
  return {
    device: "cpu",
    num_cpu: 0,
    platform: amiga ? "amiga" : "custom",
    agrowstitch_params: {
      forward_limit: amiga ? 4 : 8,
      max_reprojection_error: amiga ? 1.0 : 3.0,
      crop_rules: [],
      batch_size: 10,
      min_inliers: 20,
    },
    custom_agrowstitch_options: "",
    ...common,
  }
}

const KEYS = [
  "year",
  "experiment",
  "location",
  "population",
  "date",
  "platform",
  "sensor",
] as const

export interface UploadScope {
  year: string
  experiment: string
  location: string
  population: string
  date: string
  platform: string
  sensor: string
  /** The batch's 8-character id, when it has its own folder. */
  shortId?: string
}

/** The scope a `Raw/…` upload path names; null for other uploads. */
export function scopeFromUploadPath(path: string): UploadScope | null {
  const parts = path.replace(/^\/+|\/+$/g, "").split("/")
  if (parts[0] !== "Raw" || parts.length < 8) return null
  const scope = Object.fromEntries(
    KEYS.map((k, i) => [k, parts[i + 1] ?? ""]),
  ) as unknown as UploadScope
  if (KEYS.some((k) => !scope[k])) return null
  const next = parts[8]
  if (next && /^[0-9a-f]{8}$/i.test(next)) scope.shortId = next
  return scope
}

const sameScope = (r: Run, s: UploadScope) =>
  KEYS.every((k) => (r.uploadScope?.[k] ?? "") === s[k])

/**
 * The run this uploaded batch belongs to, made when there is none.
 * `created` says whether it is new (the upload's message offers to open it).
 */
export function fileUploadAsRun(opts: {
  path: string
  experimentId?: string
  batchLabel?: string
}): { run: Run; created: boolean } | null {
  const scope = scopeFromUploadPath(opts.path)
  if (!scope) return null
  const type = pipelineTypeFor(scope.platform)
  const label = opts.batchLabel ?? ""
  const st = getState()
  const typeOf = new Map(st.pipelines.map((p) => [p.id, p.type]))
  const matches = st.runs.filter(
    (r) => typeOf.get(r.pipelineId) === type && sameScope(r, scope),
  )
  const latest = (rs: Run[]) =>
    rs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]

  const owning = scope.shortId
    ? matches.filter((r) =>
        (r.uploadScope?.datasetShortIds ?? []).includes(
          scope.shortId as string,
        ),
      )
    : []
  if (owning.length) return { run: latest(owning), created: false }

  const sameLabel = matches.filter(
    (r) => (r.uploadScope?.batchLabel ?? "") === label,
  )
  if (sameLabel.length) {
    const run = latest(sameLabel)
    const ids = run.uploadScope?.datasetShortIds ?? []
    if (scope.shortId && run.uploadScope && ids.length > 0) {
      // Another batch at this scope: the run now covers it too. (An empty
      // list already means "every batch at this scope".)
      updateRun(run.id, {
        uploadScope: {
          ...run.uploadScope,
          datasetShortIds: [...ids, scope.shortId].sort(),
        },
      })
    }
    return { run, created: false }
  }

  const ws = workspaceForExperiment(scope.experiment)
  const pipe = pipelineForKind(ws, {
    type,
    platform: scope.platform,
    sensor: scope.sensor,
    params: defaultPipelineParams(type, scope.platform),
  })
  const run = createRun({
    pipelineId: pipe.id,
    name:
      `${scope.date} · ${scope.platform}/${scope.sensor}` +
      (label ? ` · ${label}` : ""),
    scope: {
      experimentId: opts.experimentId ?? null,
      seasonId: null,
      siteId: null,
      populationId: null,
    },
    uploadScope: {
      year: scope.year,
      experiment: scope.experiment,
      location: scope.location,
      population: scope.population,
      date: scope.date,
      platform: scope.platform,
      sensor: scope.sensor,
      ...(opts.experimentId ? { experimentId: opts.experimentId } : {}),
      ...(scope.shortId ? { datasetShortIds: [scope.shortId] } : {}),
      ...(label ? { batchLabel: label } : {}),
    },
  })
  return { run, created: true }
}
