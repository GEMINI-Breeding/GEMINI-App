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
 * wizard reads job status back from useJob().
 *
 * Persistence (3F): the server is the source of truth
 * (`/api/process_state`, one JSON document per workspace / pipeline /
 * run), so runs survive clearing site data and are shared by every user
 * and machine. The API here stays synchronous: an in-memory copy serves
 * reads, and every mutation writes the entities it changed through an
 * *outbox* kept in localStorage — so a write made just before a page
 * reload or navigation is replayed on the next load rather than lost —
 * and sent with `keepalive`. `hydrateRunStore()` (called once signed in)
 * loads the server's state, lays any unsent outbox writes on top, and
 * then polls so other users' changes appear. Browsers that used the old
 * localStorage-only store upload it once; nothing local is deleted.
 * The old `gemini.process.runStore.v1` key is still written as a cache.
 */
import { useSyncExternalStore } from "react"

import { OpenAPI } from "@/client"
import type { AerialScopeFields } from "@/features/process/components/AerialScopePicker"
import type { ProcessScope } from "@/features/process/lib/processScope"
import { getToken } from "@/lib/auth"

export type Id = string
export type IsoDate = string

export type PipelineType = "aerial" | "ground"

export type RunStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  /**
   * The step exists in the pipeline but this backend cannot perform it yet.
   *
   * Distinct from "skipped" (the user chose to pass on it) and from
   * "completed" (work actually happened). Two steps used to mark themselves
   * `completed` while doing nothing at all — `associate_boundaries` even
   * recorded `synthetic: true` in its outputs — so a green tick meant
   * either "done" or "silently did nothing" and the user couldn't tell.
   * A step must never claim success for work that didn't run.
   */
  | "unavailable"

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
 * {date}/{platform}/{sensor}/{datasetShortId}/Images/...` — every field
 * here is a verbatim path component. The experiment / site / population
 * *names* are what's stored on disk; `experimentId` is the GEMINIbase
 * Experiment.id resolved once at pick time so step submissions don't
 * have to re-resolve it. `datasetShortId` is per-row and lives on
 * `RunUploadScope.datasetShortIds` (one or many — see field below).
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
  const prev = current
  current = next
  writeStored(current)
  enqueueChanges(prev, next)
  emit()
}

// ── Server sync ───────────────────────────────────────────────────────────

type Kind = "workspace" | "pipeline" | "run"
type Entity = Workspace | Pipeline | Run
/** Pending write for one entity: its latest doc, or null for a delete. */
type Op = { kind: Kind; id: Id; doc: Entity | null; seq: number }

const OUTBOX_KEY = "gemini.process.outbox.v1"
const MIGRATED_KEY = "gemini.process.migratedToServer.v1"
const POLL_MS = 15_000

const COLLECTIONS: Array<[Kind, keyof StoreState]> = [
  ["workspace", "workspaces"],
  ["pipeline", "pipelines"],
  ["run", "runs"],
]
const KIND_ORDER: Record<Kind, number> = { workspace: 0, pipeline: 1, run: 2 }

let seq = 0
let outbox: Map<Id, Op> = readOutbox()
let syncEnabled = false
let flushing = false
let retryTimer: ReturnType<typeof setTimeout> | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let ready = false
const readyListeners = new Set<() => void>()

function readOutbox(): Map<Id, Op> {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY)
    const ops = raw ? (JSON.parse(raw) as Op[]) : []
    return new Map(ops.map((o) => [o.id, o]))
  } catch {
    return new Map()
  }
}

function writeOutbox() {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify([...outbox.values()]))
  } catch {
    // Best-effort, like the cache.
  }
}

function enqueue(kind: Kind, id: Id, doc: Entity | null) {
  seq += 1
  outbox.set(id, { kind, id, doc, seq })
}

/** Queue every entity that changed between two states (by identity). */
function enqueueChanges(prev: StoreState, next: StoreState) {
  let any = false
  for (const [kind, key] of COLLECTIONS) {
    const before = new Map((prev[key] as Entity[]).map((e) => [e.id, e]))
    const after = new Map((next[key] as Entity[]).map((e) => [e.id, e]))
    for (const [id, e] of after)
      if (before.get(id) !== e) {
        enqueue(kind, id, e)
        any = true
      }
    for (const id of before.keys())
      if (!after.has(id)) {
        enqueue(kind, id, null)
        any = true
      }
  }
  if (any) {
    writeOutbox()
    void flush()
  }
}

function apiUrl(path: string) {
  return `${(OpenAPI.BASE ?? "").replace(/\/$/, "")}${path}`
}

/** Parents before children for writes; children before parents for deletes. */
function flushOrder(a: Op, b: Op) {
  const ad = a.doc === null
  const bd = b.doc === null
  if (ad !== bd) return ad ? 1 : -1
  const k = KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
  return ad ? -k : k || a.seq - b.seq
}

async function flush(): Promise<void> {
  if (!syncEnabled || flushing || outbox.size === 0) return
  flushing = true
  try {
    for (const op of [...outbox.values()].sort(flushOrder)) {
      const path = `/api/process_state/${op.kind}/${op.id}`
      const body = op.doc ? JSON.stringify({ doc: op.doc }) : undefined
      let res: Response
      try {
        res = await fetch(apiUrl(path), {
          method: op.doc ? "PUT" : "DELETE",
          headers: {
            Authorization: `Bearer ${getToken()}`,
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          body,
          // Survives a navigation / reload that starts mid-request
          // (browsers cap keepalive bodies at 64 KB).
          keepalive: (body?.length ?? 0) < 60_000,
        })
      } catch {
        scheduleRetry()
        return
      }
      // 409: the parent is gone (deleted elsewhere) — this write is moot.
      if (res.ok || res.status === 409 || res.status === 400) {
        // Only clear it if nothing newer was queued meanwhile.
        if (outbox.get(op.id)?.seq === op.seq) outbox.delete(op.id)
        writeOutbox()
      } else {
        scheduleRetry()
        return
      }
    }
  } finally {
    flushing = false
  }
  if (outbox.size > 0) void flush()
}

function scheduleRetry() {
  if (retryTimer) return
  retryTimer = setTimeout(() => {
    retryTimer = null
    void flush()
  }, 5_000)
}

/** Server state with the unsent local writes laid on top. */
function overlayOutbox(server: StoreState): StoreState {
  const out: StoreState = {
    workspaces: [...server.workspaces],
    pipelines: [...server.pipelines],
    runs: [...server.runs],
  }
  for (const op of outbox.values()) {
    const key = COLLECTIONS.find(([k]) => k === op.kind)?.[1]
    if (!key) continue
    const list = (out[key] as Entity[]).filter((e) => e.id !== op.id)
    ;(out as unknown as Record<string, Entity[]>)[key] = op.doc
      ? [...list, op.doc]
      : list
  }
  return out
}

async function pull(): Promise<void> {
  try {
    const res = await fetch(apiUrl("/api/process_state"), {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
    if (!res.ok) return
    const server = (await res.json()) as StoreState
    current = overlayOutbox({
      workspaces: server.workspaces ?? [],
      pipelines: server.pipelines ?? [],
      runs: server.runs ?? [],
    })
    writeStored(current)
    emit()
  } catch {
    // Offline: keep showing the cache; the next poll retries.
  } finally {
    if (!ready) {
      ready = true
      for (const l of readyListeners) l()
    }
  }
}

const onFocus = () => void pull()

/**
 * Start server sync (idempotent). Call once the user is signed in. On a
 * browser that used the old localStorage-only store, its contents are
 * uploaded once (orphans whose parent is gone are skipped).
 */
export async function hydrateRunStore(): Promise<void> {
  if (syncEnabled) return
  syncEnabled = true
  let migrated = false
  try {
    migrated = localStorage.getItem(MIGRATED_KEY) === "1"
  } catch {}
  if (!migrated) {
    const local = readStored()
    const ws = new Set(local.workspaces.map((w) => w.id))
    const pl = new Set(
      local.pipelines.filter((p) => ws.has(p.workspaceId)).map((p) => p.id),
    )
    for (const w of local.workspaces) enqueue("workspace", w.id, w)
    for (const p of local.pipelines)
      if (ws.has(p.workspaceId)) enqueue("pipeline", p.id, p)
    for (const r of local.runs)
      if (pl.has(r.pipelineId)) enqueue("run", r.id, r)
    writeOutbox()
    try {
      localStorage.setItem(MIGRATED_KEY, "1")
    } catch {}
  }
  await flush()
  await pull()
  if (!pollTimer && typeof window !== "undefined") {
    pollTimer = setInterval(() => {
      if (document.visibilityState === "visible") void pull()
    }, POLL_MS)
    window.addEventListener("focus", onFocus)
  }
}

/** True once the first server load finished (or failed). */
export function useRunStoreReady(): boolean {
  return useSyncExternalStore(
    (l) => {
      readyListeners.add(l)
      return () => readyListeners.delete(l)
    },
    () => ready,
    () => ready,
  )
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
  outbox = new Map()
  seq = 0
  syncEnabled = false
  flushing = false
  ready = false
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
  if (typeof window !== "undefined")
    window.removeEventListener("focus", onFocus)
  emit()
}
