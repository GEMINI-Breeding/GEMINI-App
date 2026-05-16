/**
 * runStore — client-side persistence for the wizard-style Process UI's
 * Workspace → Pipeline → Run → Step hierarchy.
 *
 * GEMINIbase has no Workspace/Pipeline/Run tables; jobs are submitted
 * standalone via /api/jobs/submit. This store reconstructs the wizard's
 * mental model in localStorage so the user can name a workspace, attach
 * an experiment+scope to it, define pipeline templates, and walk runs
 * through their step state.
 *
 * Each Run.steps[k].jobIds holds the GEMINIbase Job UUIDs that step
 * spawned. ProcessContext subscribes those jobIds via wsManager and the
 * wizard reads job status back from useJob() — runStore itself does not
 * call the backend.
 *
 * Implementation: module-level store + useSyncExternalStore (matches
 * processScope.ts). Storage layout:
 *   gemini.process.runStore.v1 → { workspaces, pipelines, runs }
 * Single key keeps reads atomic; the data is small (a few KB per
 * workspace) so no need to split into per-run keys until proven slow.
 */
import { useSyncExternalStore } from "react"

import type { AerialScopeFields } from "@/features/process/components/AerialScopePicker"
import type { ProcessScope } from "@/features/process/lib/processScope"

export type Id = string
export type IsoDate = string

export type PipelineType = "aerial" | "ground"

export type RunStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"

export interface RunStepState {
  status: RunStepStatus
  /** GEMINIbase Job UUIDs spawned by this step (one for ortho, fan-out for inference). */
  jobIds: string[]
  /** Step-specific outputs that downstream steps consume. */
  outputs?: Record<string, unknown>
  /** UI-side state (GCP marks, plot-marker frames) saved client-side. */
  manualMarks?: unknown
  startedAt?: IsoDate
  completedAt?: IsoDate
  error?: string
}

export interface Workspace {
  id: Id
  name: string
  description?: string
  /**
   * Legacy field from an earlier draft of this UI where the workspace owned
   * an experiment. The current flow (mirrors `main`'s) puts experiment +
   * scope on the *Run* — picked from an uploaded dataset at run-creation
   * time — so a workspace is just a folder of pipelines now. Kept optional
   * to read existing localStorage records without crashing.
   */
  experimentId?: Id
  /** Same legacy reasoning as `experimentId`. */
  defaultScope?: ProcessScope
  createdAt: IsoDate
}

export interface Pipeline {
  id: Id
  workspaceId: Id
  name: string
  type: PipelineType
  /**
   * Per-pipeline knobs (ODM presets, Roboflow models, AgRowStitch params).
   * Shape stays loose because PipelineParams differs per type and the
   * restored ProcessingPipeline form drives the schema.
   */
  params: Record<string, unknown>
  createdAt: IsoDate
}

/**
 * Scope captured at run-creation time from a single uploaded dataset row.
 * The MinIO path is `Raw/{year}/{experiment}/{location}/{population}/
 * {date}/{platform}/{sensor}/Images/...` — every field here is a verbatim
 * path component. The experiment / site / population *names* are what's
 * stored on disk; `experimentId` is the GEMINIbase Experiment.id resolved
 * once at pick time so step submissions don't have to re-resolve it.
 */
export interface RunUploadScope {
  year: string
  experiment: string
  location: string
  population: string
  date: string
  platform: string
  sensor: string
  /** GEMINIbase Experiment.id; required by the job-submit endpoint. */
  experimentId?: Id
  /**
   * Per-dataset short-ids (8-hex segments) the user has chosen to feed
   * into the run's compute steps. Empty / undefined means "all
   * datasets at this scope" — the wizard's default after the user
   * picks the row in NewRunDialog. Set to a single id when running
   * single-dataset tools (GCP picker, image review, thermal preflight).
   */
  datasetShortIds?: string[]
}

export interface Run {
  id: Id
  pipelineId: Id
  workspaceId: Id
  name?: string
  /** Resolved scope at run-creation time (may differ from workspace default). */
  scope: ProcessScope
  /**
   * Snapshot of the upload the run was created from. Source of truth for
   * the MinIO paths the workers read/write — no re-derivation from
   * useProcessScope. Optional to allow legacy localStorage records (created
   * before the upload-driven flow) to load without a crash; UIs treat its
   * absence as "this run was never wired to an upload, prompt the user".
   */
  uploadScope?: RunUploadScope
  /**
   * Aerial path-component fields (date, platform, sensor + name overrides).
   * @deprecated Superseded by `uploadScope` once a run is created via the
   * NewRunDialog. Read existing records for back-compat only; new code
   * should use `uploadScope`.
   */
  aerialFields?: AerialScopeFields
  status: "draft" | "running" | "completed" | "failed"
  steps: Record<string, RunStepState>
  createdAt: IsoDate
  updatedAt: IsoDate
}

interface StoreState {
  workspaces: Workspace[]
  pipelines: Pipeline[]
  runs: Run[]
}

const STORAGE_KEY = "gemini.process.runStore.v1"

const empty: StoreState = { workspaces: [], pipelines: [], runs: [] }

function readStored(): StoreState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return empty
    const parsed = JSON.parse(raw) as Partial<StoreState>
    return {
      workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces : [],
      pipelines: Array.isArray(parsed.pipelines) ? parsed.pipelines : [],
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
    }
  } catch {
    return empty
  }
}

function writeStored(state: StoreState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Best-effort; private-mode Safari throws from localStorage.
  }
}

let current: StoreState = readStored()
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function setState(next: StoreState) {
  current = next
  writeStored(current)
  emit()
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

function getSnapshot(): StoreState {
  return current
}

function nowIso(): IsoDate {
  return new Date().toISOString()
}

function newId(): Id {
  return crypto.randomUUID()
}

// ── Mutators ──────────────────────────────────────────────────────────────
// Mutators are exported as plain functions (not hook methods) so non-React
// callers (e.g. runApi adapter) can update without holding a hook.

export function createWorkspace(input: {
  name: string
  description?: string
  experimentId?: Id
  defaultScope?: ProcessScope
}): Workspace {
  const ws: Workspace = {
    id: newId(),
    name: input.name,
    description: input.description,
    experimentId: input.experimentId,
    defaultScope: input.defaultScope,
    createdAt: nowIso(),
  }
  setState({ ...current, workspaces: [...current.workspaces, ws] })
  return ws
}

export function updateWorkspace(
  id: Id,
  patch: Partial<Omit<Workspace, "id" | "createdAt">>,
): void {
  setState({
    ...current,
    workspaces: current.workspaces.map((w) =>
      w.id === id ? { ...w, ...patch } : w,
    ),
  })
}

export function deleteWorkspace(id: Id): void {
  // Cascade: drop pipelines/runs belonging to this workspace.
  const pipelineIds = new Set(
    current.pipelines.filter((p) => p.workspaceId === id).map((p) => p.id),
  )
  setState({
    workspaces: current.workspaces.filter((w) => w.id !== id),
    pipelines: current.pipelines.filter((p) => p.workspaceId !== id),
    runs: current.runs.filter((r) => !pipelineIds.has(r.pipelineId)),
  })
}

export function createPipeline(input: {
  workspaceId: Id
  name: string
  type: PipelineType
  params: Record<string, unknown>
}): Pipeline {
  const p: Pipeline = {
    id: newId(),
    workspaceId: input.workspaceId,
    name: input.name,
    type: input.type,
    params: input.params,
    createdAt: nowIso(),
  }
  setState({ ...current, pipelines: [...current.pipelines, p] })
  return p
}

export function updatePipeline(
  id: Id,
  patch: Partial<Omit<Pipeline, "id" | "createdAt" | "workspaceId">>,
): void {
  setState({
    ...current,
    pipelines: current.pipelines.map((p) =>
      p.id === id ? { ...p, ...patch } : p,
    ),
  })
}

export function deletePipeline(id: Id): void {
  setState({
    ...current,
    pipelines: current.pipelines.filter((p) => p.id !== id),
    runs: current.runs.filter((r) => r.pipelineId !== id),
  })
}

export function createRun(input: {
  pipelineId: Id
  name?: string
  scope: ProcessScope
  uploadScope?: RunUploadScope
}): Run {
  const pipeline = current.pipelines.find((p) => p.id === input.pipelineId)
  if (!pipeline) {
    throw new Error(`createRun: pipeline ${input.pipelineId} not found`)
  }
  const run: Run = {
    id: newId(),
    pipelineId: input.pipelineId,
    workspaceId: pipeline.workspaceId,
    name: input.name,
    scope: input.scope,
    uploadScope: input.uploadScope,
    status: "draft",
    steps: {},
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  setState({ ...current, runs: [...current.runs, run] })
  return run
}

export function updateRun(
  id: Id,
  patch: Partial<Omit<Run, "id" | "createdAt" | "pipelineId" | "workspaceId">>,
): void {
  setState({
    ...current,
    runs: current.runs.map((r) =>
      r.id === id ? { ...r, ...patch, updatedAt: nowIso() } : r,
    ),
  })
}

export function setStepState(
  runId: Id,
  stepKey: string,
  patch: Partial<RunStepState>,
): void {
  setState({
    ...current,
    runs: current.runs.map((r) => {
      if (r.id !== runId) return r
      const prev: RunStepState = r.steps[stepKey] ?? {
        status: "pending",
        jobIds: [],
      }
      return {
        ...r,
        steps: { ...r.steps, [stepKey]: { ...prev, ...patch } },
        updatedAt: nowIso(),
      }
    }),
  })
}

export function appendStepJobId(
  runId: Id,
  stepKey: string,
  jobId: string,
): void {
  const run = current.runs.find((r) => r.id === runId)
  if (!run) return
  const prev: RunStepState = run.steps[stepKey] ?? {
    status: "pending",
    jobIds: [],
  }
  if (prev.jobIds.includes(jobId)) return
  // A new job arriving on a step that already finished (failed, completed,
  // skipped) means the user is retrying. Reset to "running" and clear the
  // prior outcome — without this the WS subscription loop in RunDetail never
  // re-attaches (it only subscribes to running steps), and the step row stays
  // pinned to the previous failure's red icon and log.
  const isTerminal = prev.status !== "pending" && prev.status !== "running"
  setStepState(runId, stepKey, {
    jobIds: [...prev.jobIds, jobId],
    status: "running",
    startedAt: isTerminal ? nowIso() : (prev.startedAt ?? nowIso()),
    completedAt: undefined,
    error: undefined,
  })
}

export function deleteRun(id: Id): void {
  setState({ ...current, runs: current.runs.filter((r) => r.id !== id) })
}

// ── Lookups ───────────────────────────────────────────────────────────────
// Plain getters for non-React callers (runApi). Hooks below for components.

export function getWorkspace(id: Id): Workspace | undefined {
  return current.workspaces.find((w) => w.id === id)
}

export function getPipeline(id: Id): Pipeline | undefined {
  return current.pipelines.find((p) => p.id === id)
}

export function getRun(id: Id): Run | undefined {
  return current.runs.find((r) => r.id === id)
}

/**
 * Reverse-lookup a Run by one of its job UUIDs. ProcessContext rehydration
 * uses this to build the panel "View" link after a page refresh: the job
 * is the only handle the backend gives us, but we want the user dropped
 * back into the run page.
 */
export function findRunByJobId(jobId: string): Run | undefined {
  for (const run of current.runs) {
    for (const step of Object.values(run.steps)) {
      if (step.jobIds.includes(jobId)) return run
    }
  }
  return undefined
}

// ── Hooks ─────────────────────────────────────────────────────────────────

export function useWorkspaces(): Workspace[] {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return state.workspaces
}

export function useWorkspace(id: Id | undefined): Workspace | undefined {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  if (!id) return undefined
  return state.workspaces.find((w) => w.id === id)
}

export function usePipelines(workspaceId: Id | undefined): Pipeline[] {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  if (!workspaceId) return []
  return state.pipelines.filter((p) => p.workspaceId === workspaceId)
}

export function usePipeline(id: Id | undefined): Pipeline | undefined {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  if (!id) return undefined
  return state.pipelines.find((p) => p.id === id)
}

export function useRuns(pipelineId: Id | undefined): Run[] {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  if (!pipelineId) return []
  return state.runs.filter((r) => r.pipelineId === pipelineId)
}

export function useWorkspaceRuns(workspaceId: Id | undefined): Run[] {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  if (!workspaceId) return []
  return state.runs.filter((r) => r.workspaceId === workspaceId)
}

export function useRun(id: Id | undefined): Run | undefined {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  if (!id) return undefined
  return state.runs.find((r) => r.id === id)
}

/** Test-only — wipe everything so specs don't bleed into each other. */
export function __resetRunStoreForTests(): void {
  current = { workspaces: [], pipelines: [], runs: [] }
  emit()
}
