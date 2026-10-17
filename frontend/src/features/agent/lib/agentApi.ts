/**
 * Client for the agent service (`agent/gemi_agent/service.py`): the model
 * settings, the skills, and agent runs with their event logs.
 *
 * The service is separate from the REST API. In dev the Vite proxy forwards
 * `/agent/*` to it; elsewhere set `VITE_AGENT_URL` to its origin.
 */
import { getToken } from "@/lib/auth"

/**
 * Where the service is: the desktop app starts its own and sets
 * `window.__GEMI_AGENT_URL__` before any page code runs; otherwise
 * `VITE_AGENT_URL`, else the same origin (the dev proxy).
 */
function base(): string {
  const injected = (window as { __GEMI_AGENT_URL__?: string })
    .__GEMI_AGENT_URL__
  return (
    injected ??
    (import.meta.env.VITE_AGENT_URL as string | undefined) ??
    ""
  ).replace(/\/$/, "")
}

export function agentUrl(path: string): string {
  return `${base()}/agent${path}`
}

export interface AgentConfig {
  base_url: string
  model: string
  /** "***" when a key is stored; never the key itself. */
  api_key: string
  tool_mode: "text" | "native"
  vision: boolean
  max_steps: number
}

export interface AgentSkill {
  name: string
  description: string
}

export interface AgentEvent {
  n: number
  t: number
  kind:
    | "user"
    | "assistant"
    | "tool"
    | "skill"
    | "status"
    | "error"
    | "approval_request"
    | "approval"
  text?: string
  tool?: string
  args?: Record<string, unknown>
  result?: string
  error?: string
  images?: string[]
  seconds?: number
  name?: string
  approved?: boolean
}

export type AgentRunStatus =
  | "idle"
  | "running"
  | "awaiting_approval"
  | "waiting"
  | "failed"
  | "cancelled"
  | "interrupted"

export interface AgentRunBrief {
  id: string
  title: string
  status: AgentRunStatus
  steps: number
  created: number
  model: string
  event_count: number
}

export interface AgentRun extends AgentRunBrief {
  pending: {
    tool: string
    args: Record<string, unknown>
    /** Why the agent has to ask before this call, in plain words. */
    reason?: string
  } | null
  events: AgentEvent[]
}

export interface AgentStackStatus {
  api: string
  user: string
  experiments: string[]
  jobs_recent: Record<string, number>
  jobs_active: { id: string; job_type: string; status: string }[]
  workers_busy: string[]
  pending_job_types: string[]
  note: string | null
  uploads: { task_id: string; status: string; percent: number }[]
}

export interface AgentNextStep {
  run: string
  run_id: string
  done: string[]
  step?: string
  state: "to do" | "running" | "failed" | "all steps done"
  error?: string
  /** Questions only the person can answer before the step can run. */
  ask_person_first?: string[]
}

const ASK_KEY = "gemini.agent.ask"

/** Hand the home page a request to start as soon as it opens. */
export function queueAgentRequest(text: string): void {
  try {
    sessionStorage.setItem(ASK_KEY, text)
  } catch {
    // Without storage the home page just opens; the person can type it.
  }
}

export function takeAgentRequest(): string | null {
  try {
    const text = sessionStorage.getItem(ASK_KEY)
    if (text) sessionStorage.removeItem(ASK_KEY)
    return text
  } catch {
    return null
  }
}

/** An open model the agent can use, with where it can run. */
export interface OpenModel {
  key: string
  label: string
  by: string
  tested: boolean
  /** How it did on GEMI's own checks of the pipeline steps; null when not run yet. */
  checks: {
    passed: number
    of: number
    weak: string[]
    seconds_per_check: number
    when: string
  } | null
  note: string
  /** Ollama tag (this computer). */
  ollama: string
  /** Hugging Face id (cluster); null when it cannot be set up there. */
  hf: string | null
  gpu_gb: number | null
  disk_gb: number
}

/** An open model with whether it fits this computer. */
export interface FittedModel extends OpenModel {
  fit: "yes" | "slow" | "no"
  why: string
}

/** What the first-open walkthrough needs: this computer, and what is already answered. */
/** A model found on this computer, ready to be chosen without installing anything. */
export interface FoundModel {
  server: string
  base_url: string
  model: string
  /** In memory now (answers at once), not only on disk. */
  loaded: boolean
  label: string
  key: string | null
  checks: OpenModel["checks"]
  vision: boolean | null
}

export interface Onboarding {
  system: { os: string; summary: string; ram_gb: number | null }
  docker: "running" | "not_running" | "missing"
  ollama: "running" | "installed" | "missing"
  models: FittedModel[]
  recommended: string | null
  advice: string
  /** Models already there to use: installed in Ollama, or served on this computer (vLLM, LM Studio…). */
  found: FoundModel[]
  processing: {
    answered: boolean
    stack_reachable: boolean
    cluster: string | null
  }
  model: {
    answered: boolean
    configured: boolean
    reachable: boolean
    model: string | null
    where: string | null
  }
}

export interface ModelSetupStep {
  name: string
  estimate_s: number
  status: "waiting" | "running" | "done" | "failed"
  detail: string
  seconds?: number
  running_s?: number
  remaining_s?: number
  percent?: number
}

export interface ModelSetupJob {
  where: "local" | "cluster"
  model: string
  label: string
  state: "running" | "done" | "failed"
  steps: ModelSetupStep[]
  error: string | null
  elapsed_s: number
  estimate_s: number
}

export interface ModelSetup {
  models: OpenModel[]
  local: { ollama: "running" | "installed" | "missing"; installed: string[] }
  cluster: string | null
  current: { base_url: string; model: string }
  job: ModelSetupJob | null
}

/** Where a model would run on a cluster, from a read-only survey. */
export interface ClusterModelPlan {
  cluster: string
  configured: boolean
  host: string
  data_root: string
  llm_try: string[]
  gpu_wait_min: number | null
  server_installed: boolean
  existing_install?: boolean
}

export type ComputeState =
  | "running"
  | "starting"
  | "queued"
  | "stopping"
  | "stopped"
  | "unknown"

/** One part of the processing stack on the cluster: the core, a worker, or the agent's model. */
export interface ComputePart {
  name: string
  label: string
  does: string
  job_types: string[]
  state: ComputeState
  /** "auto" or the partition:account this part is started on. */
  where: string
  /** Placements the cluster's configuration allows. */
  options: string[]
  resources: string
  jobs_waiting: number
  jobs_running: number
  /** Minutes with nothing to do; null when the job list could not be read. */
  idle_minutes?: number | null
  busy: { action: string; since: number } | null
  last: { action: string; ok: boolean; at: number; message: string } | null
  partition?: string
  node?: string | null
  elapsed?: string
  time_limit?: string
  reason?: string | null
}

export interface ComputeOverview {
  cluster: string | null
  host?: string
  parts: ComputePart[]
  auto_start: boolean
  idle_stop_minutes?: number
  error?: string | null
  note?: string
  connection?: { api: boolean; model: boolean }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  const resp = await fetch(agentUrl(path), {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  const text = await resp.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    // Not JSON: the dev server's HTML fallback when the service is down.
    throw new Error("The agent service is not reachable.")
  }
  if (!resp.ok) {
    const message = (body as { error?: string } | null)?.error
    throw new Error(message || `Agent service error ${resp.status}`)
  }
  return body as T
}

const post = (body?: unknown): RequestInit => ({
  method: "POST",
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

export interface AgentMode {
  /** "setup": no processing stack reachable yet; "ready": it answers. */
  mode: "setup" | "ready"
  stack_reachable: boolean
  cluster: string | null
  /** The person asked for a login screen (Settings → Sign-in). */
  require_sign_in?: boolean
}

export const agentApi = {
  mode: () => call<AgentMode>("/mode"),
  /** A session for the stack's own account; only answered on this computer. */
  autoLogin: () => call<{ enabled: boolean; token?: string }>("/auto_login"),
  setRequireSignIn: (require_sign_in: boolean) =>
    call<{ require_sign_in: boolean }>("/auto_login", {
      method: "PUT",
      body: JSON.stringify({ require_sign_in }),
    }),
  config: () => call<AgentConfig>("/config"),
  saveConfig: (patch: Partial<AgentConfig>) =>
    call<AgentConfig>("/config", {
      method: "PUT",
      body: JSON.stringify(patch),
    }),
  testConfig: () =>
    call<{ ok: boolean; reply?: string; seconds?: number; error?: string }>(
      "/config/test",
      post(),
    ),
  skills: () => call<AgentSkill[]>("/skills"),
  status: () => call<AgentStackStatus>("/status"),
  runs: () => call<AgentRunBrief[]>("/runs"),
  run: (id: string) => call<AgentRun>(`/runs/${id}`),
  start: (input: { text: string; skill?: string; track?: string }) =>
    call<AgentRun>("/runs", post(input)),
  message: (id: string, text: string) =>
    call<{ ok: boolean }>(`/runs/${id}/message`, post({ text })),
  approve: (id: string, approved: boolean) =>
    call<{ ok: boolean }>(`/runs/${id}/approve`, post({ approved })),
  cancel: (id: string) => call<{ ok: boolean }>(`/runs/${id}/cancel`, post()),
  compute: (fresh = false) =>
    call<ComputeOverview>(`/compute${fresh ? "?fresh=1" : ""}`),
  computeStart: (name: string, where?: string) =>
    call<{ started: boolean }>("/compute/start", post({ name, where })),
  computeStop: (name: string) =>
    call<{ started: boolean }>("/compute/stop", post({ name })),
  computeReconnect: () => call<unknown>("/compute/reconnect", post({})),
  computePrefs: (patch: { auto_start?: boolean; idle_stop_minutes?: number }) =>
    call<unknown>("/compute/prefs", {
      method: "PUT",
      body: JSON.stringify(patch),
    }),
  onboarding: () => call<Onboarding>("/onboarding"),
  modelSetup: () => call<ModelSetup>("/model_setup"),
  modelSetupLocal: (model: string) =>
    call<ModelSetup>("/model_setup/local", post({ model })),
  modelSetupClusterPlan: (ssh?: string) =>
    call<ClusterModelPlan>("/model_setup/cluster/plan", post({ ssh })),
  modelSetupCluster: (model: string, plan: ClusterModelPlan) =>
    call<ModelSetup>("/model_setup/cluster", post({ model, plan })),
  /** What is due for a Process-tab run (the agent's `next_step` tool). */
  nextStep: (runId: string) =>
    call<{ runs: AgentNextStep[] }>(
      `/next_step?run=${encodeURIComponent(runId)}`,
    ),
  /** Mark a run's rover track automatically; saved unless a pass needs a look. */
  automark: (runId: string) =>
    call<{
      plots: number
      passes_marked: number
      passes_to_check?: number[] | null
      tell_the_person?: string
      saved_version?: number | null
    }>("/automark", post({ run: runId })),
  /** What the person has said about a run (field design, orientation, …). */
  facts: (runId: string) =>
    call<{ facts: Record<string, unknown> }>(`/facts/${runId}`),
  saveFacts: (runId: string, patch: Record<string, unknown>) =>
    call<{ facts: Record<string, unknown> }>(`/facts/${runId}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    }),
  /** `<img>` cannot send headers, so the token rides in the query. */
  imageUrl: (path: string) =>
    agentUrl(
      `/image?path=${encodeURIComponent(path)}&token=${encodeURIComponent(getToken())}`,
    ),
}
