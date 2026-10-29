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
  /** The tool working now (a long one: waiting for jobs, stitching), with the
   *  jobs it started or waits on. */
  current?: { tool: string; since: number; jobs: string[] } | null
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

/** A cluster's login checked and surveyed (read-only), for the welcome page. */
export interface ClusterCheck {
  /** The SSH command with the key file in it, as it will be saved. */
  ssh: string
  name: string
  login: string
  ssh_key: string
  user: string
  slurm: string
  containers: string
  containers_ok: boolean
  /** partition:account for the core; null when nothing can start it. */
  core: string | null
  core_wait_minutes: number | string | null
  workers_try: string[]
  llm_try: string[]
  /** The suggested GEMI folder: an install already there, else roomy shared storage. */
  data_root: string
  data_root_candidates: string[]
  already_installed: {
    root: string
    images: string[]
    data_folders: string[]
  } | null
  internet: Record<string, string>
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
  /** Cluster jobs running this worker (several copies share the waiting jobs). */
  copies?: number
  /** How many copies the cluster's settings allow at once. */
  max_copies?: number
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
  /** The SSH login and identity file this computer uses for the cluster. */
  login?: string
  ssh_key?: string
  parts: ComputePart[]
  auto_start: boolean
  idle_stop_minutes?: number
  error?: string | null
  note?: string
  connection?: { api: boolean; model: boolean }
  /** A session shared with the GEMI folder's group (see share on/off). */
  share?: ComputeShare | null
  /** This person may start and stop jobs (on this computer, or an administrator). */
  you_can_manage?: boolean
}

export interface ComputeShare {
  /** Whose session this is (the cluster login that runs the core). */
  owner: string
  shared: boolean
  /** This computer's cluster login. */
  me: string
  role: "owner" | "member"
  /** A member asked for the core to start (the owner's GEMI starts it). */
  start_requested_by: string | null
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

export interface InstallStep {
  name: string
  status: "waiting" | "running" | "done" | "failed"
  detail: string
  percent?: number
  remaining_s?: number | null
  estimate_s: number
}

export interface InstallJob {
  what: "ollama" | "docker" | "git"
  state: "running" | "done" | "failed"
  steps: InstallStep[]
  error: string | null
  /** What the person does next (approve the system prompt, restart, …). */
  note: string | null
}

/** What is recorded about a field (the agent's run facts). */
export interface FieldFacts {
  design_path?: string
  /** Which end of the field the design's first tier is at. */
  first_tier_at?: "north" | "south" | "east" | "west"
  /** Which side the design's first bed is on. */
  first_bed_at?: "north" | "south" | "east" | "west"
  beds?: number[]
}

export interface FieldLayoutSummary {
  plots: number
  crops: { crop: string; plots: number; beds: string; tiers: string }[]
  environments: Record<string, number> | null
  without_position: number
  position_conflicts: number | null
  bed_tier_swapped: string | null
  /** Every field in the file, before keeping the run's. */
  environments_in_file?: Record<string, number> | null
  /** The filters applied, and those that matched nothing (dropped). */
  kept?: Record<string, string>
  filter_ignored?: string[] | null
}

export interface DiskSpace {
  data_free_gb: number | null
  docker_free_gb: number | null
  /** Where Docker usually keeps its images here. */
  docker_dir: string
  same_drive: boolean
  /** What GEMI's services take on Docker's drive. */
  needs_gb: number
  /** Sentences for each drive that is short of room; empty when fine. */
  problems: string[]
}

/** Ollama and Docker on this computer, and installs in flight. */
export interface InstallOverview {
  ollama: "running" | "installed" | "missing"
  docker: "running" | "not_running" | "missing"
  /** Windows: Git for Windows, whose bash the cluster tools run with. */
  git: "installed" | "missing" | "not_needed"
  /** Linux: Docker is installed from a terminal with these commands. */
  docker_linux_steps: string[] | null
  jobs: Partial<Record<"ollama" | "docker" | "git", InstallJob>>
}

export interface AgentMode {
  /** "setup": no processing stack reachable yet; "ready": it answers. */
  mode: "setup" | "ready"
  stack_reachable: boolean
  cluster: string | null
  /** The person asked for a login screen (Settings → Sign-in). */
  require_sign_in?: boolean
}

/** Online storage the app can copy from (rclone), where copies run. */
export interface CloudProviderField {
  key: string
  label: string
  options?: string[]
  secret?: boolean
  optional?: boolean
}
export interface CloudProvider {
  type: string
  label: string
  /** Signs in in the browser (Box, Google Drive, Dropbox). */
  oauth?: boolean
  fields?: CloudProviderField[]
}
export interface CloudRemote {
  name: string
  type: string
  label: string
}
export interface CloudFetch {
  id: string
  where: "local" | "cluster"
  /** local: copying | uploading | done | failed; cluster: Slurm's state, COMPLETED, FAILED, ENDED. */
  state: string
  /** rclone's progress ("1.2 GiB / 6.3 GiB, 19%, …") or what happens now. */
  line?: string
  source?: string
  dest?: string
  error?: string
  note?: string
  log?: string
}
export interface CloudOverview {
  where: "local" | "cluster"
  cluster: string | null
  rclone: boolean
  remotes: CloudRemote[]
  providers: CloudProvider[]
}
export interface CloudItem {
  name: string
  path: string
  is_dir: boolean
  size: number | null
  modified: string | null
}

/** Another camera's frames beside a folder, taken on the same flight (thermal beside RGB). */
export interface SameFlightFolder {
  folder: string
  /** The sensor name suggested from the folder's name (Thermal, Multispectral, …). */
  sensor: string
  files: number
  /** The ending its frames' names share, e.g. _T.tif. */
  name_ends: string
  seconds_apart_at_start: number
}

/** An upload or copy in flight (the process panel). */
export interface WorkItem {
  kind: "ingest" | "fetch" | "upload" | "pull-rclone"
  id: string
  title: string
  state: "waiting" | "queued" | "running"
  detail?: string
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
  /** What the agent service is doing (uploads, copies, cluster jobs), for the Console. */
  logs: () =>
    call<{ level: string; message: string; ts: number; source: string }[]>(
      "/logs",
    ),
  runs: () => call<AgentRunBrief[]>("/runs"),
  run: (id: string) => call<AgentRun>(`/runs/${id}`),
  start: (input: { text: string; skill?: string; track?: string }) =>
    call<AgentRun>("/runs", post(input)),
  message: (id: string, text: string) =>
    call<{ ok: boolean }>(`/runs/${id}/message`, post({ text })),
  approve: (id: string, approved: boolean) =>
    call<{ ok: boolean }>(`/runs/${id}/approve`, post({ approved })),
  cancel: (id: string) => call<{ ok: boolean }>(`/runs/${id}/cancel`, post()),
  /** Remove a run from the list (stopped first if working). */
  deleteRun: (id: string) =>
    call<{ ok: boolean }>(`/runs/${id}/delete`, post()),
  compute: (fresh = false) =>
    call<ComputeOverview>(`/compute${fresh ? "?fresh=1" : ""}`),
  /** What is in a folder on the cluster the person named (two levels). */
  /** Uploads and copies in flight: on the cluster, waiting for a job slot, and here. */
  work: () => call<WorkItem[]>("/work"),
  clusterFolder: (folder: string) =>
    call<{ result: string; same_flight?: SameFlightFolder[] }>(
      "/compute/folder",
      post({ folder }),
    ),
  /** A cluster job uploads that folder into the session, as one batch. */
  clusterIngest: (settings: Record<string, string>) =>
    call<{ result: string }>("/compute/ingest", post(settings)),
  /** Connections to online storage and the recent copies (where the stack runs). */
  cloud: () => call<CloudOverview>("/cloud"),
  /** Add a connection; Box, Google Drive and Dropbox open a sign-in in the browser. */
  cloudConnect: (input: {
    name: string
    type: string
    fields?: Record<string, string>
  }) => call<CloudRemote>("/cloud/connect", post(input)),
  cloudRemove: (name: string) => call<unknown>("/cloud/remove", post({ name })),
  cloudBrowse: (name: string, path: string) =>
    call<{ name: string; path: string; items: CloudItem[] }>(
      `/cloud/ls?name=${encodeURIComponent(name)}&path=${encodeURIComponent(path)}`,
    ),
  /** Copy a folder (or file) to where the stack runs; with settings, upload it too. */
  cloudFetch: (input: {
    name: string
    path: string
    settings?: Record<string, string>
    keep?: boolean
  }) => call<CloudFetch>("/cloud/fetch", post(input)),
  cloudFetchState: (id: string) =>
    call<CloudFetch>(`/cloud/fetches/${encodeURIComponent(id)}`),
  install: () => call<InstallOverview>("/install"),
  installOllama: () => call<InstallOverview>("/install/ollama", post()),
  installDocker: () => call<InstallOverview>("/install/docker", post()),
  startDocker: () => call<InstallOverview>("/install/docker/start", post()),
  installGit: () => call<InstallOverview>("/install/git", post()),
  computeStart: (name: string, where?: string) =>
    call<{ started: boolean }>("/compute/start", post({ name, where })),
  computeStop: (name: string) =>
    call<{ started: boolean }>("/compute/stop", post({ name })),
  computeReconnect: () => call<unknown>("/compute/reconnect", post({})),
  /** Let the GEMI folder's group join this session (owner only), or stop sharing. */
  computeShare: (on: boolean, passwordless = false) =>
    call<{ result: string }>("/compute/share", post({ on, passwordless })),
  /** Join a session someone in your group shares: your login, their GEMI folder. */
  computeJoin: (login: string, folder: string, key?: string) =>
    call<{ result: string }>("/compute/join", post({ login, folder, key })),
  /** First run: check the SSH login and survey the cluster (read-only). */
  computeClusterCheck: (input: {
    ssh: string
    key?: string
    data_root?: string
  }) => call<ClusterCheck>("/compute/cluster/check", post(input)),
  /** First run: write the cluster's settings and make it the active cluster. */
  computeClusterUse: (input: {
    ssh: string
    key?: string
    name: string
    data_root: string
    core: string
    workers_try: string[]
    llm_try: string[]
  }) => call<{ cluster: string }>("/compute/cluster/use", post(input)),
  /** Another identity file for the cluster's SSH login; checked before it is saved. */
  computeSshKey: (key: string) =>
    call<{ ssh_key: string; login: string }>("/compute/ssh_key", {
      method: "PUT",
      body: JSON.stringify({ key }),
    }),
  computePrefs: (patch: { auto_start?: boolean; idle_stop_minutes?: number }) =>
    call<unknown>("/compute/prefs", {
      method: "PUT",
      body: JSON.stringify(patch),
    }),
  onboarding: () => call<Onboarding>("/onboarding"),
  /** Free space for a data folder and for Docker's images (data-folder screen). */
  diskSpace: (path: string) =>
    call<DiskSpace>(`/onboarding/disk?path=${encodeURIComponent(path)}`),
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
  /**
   * Any field design file (a drawn map, a workbook, odd column names) as one
   * clean CSV (plot, row = tier, col = bed, accession, crop, …), with a summary
   * of the crops and where they are.
   */
  /** Field design files the agent holds, and the one another run of the
   *  same field uses. */
  fieldDesigns: (runId?: string) =>
    call<{
      files: { name: string; path: string; modified: number }[]
      suggested: { path: string; name: string; from: string } | null
      /** This field's facts: its design and which way it lies. */
      facts?: FieldFacts
    }>(`/field_designs${runId ? `?run=${encodeURIComponent(runId)}` : ""}`),
  /** Keep a design file picked in the page with the agent; returns its path. */
  saveFieldDesign: (name: string, contentBase64: string) =>
    call<{ path: string; name: string }>(
      "/field_designs",
      post({ name, content_base64: contentBase64 }),
    ),
  /** `keep`: the run's field, for a master sheet of several years, sites
   *  or trials (a filter that matches nothing is dropped and said). */
  fieldLayout: (
    name: string,
    contentBase64: string,
    keep?: { year?: string; location?: string; experiment?: string },
  ) =>
    call<{ csv: string; summary: FieldLayoutSummary; kept_as?: string | null }>(
      "/field_layout",
      post({ name, content_base64: contentBase64, ...(keep ?? {}) }),
    ),
  /** The same, for a design the agent already holds (no upload). */
  fieldLayoutAt: (
    path: string,
    keep?: { year?: string; location?: string; experiment?: string },
  ) =>
    call<{ csv: string; summary: FieldLayoutSummary }>(
      "/field_layout",
      post({ path, ...(keep ?? {}) }),
    ),
  /**
   * Plot boundaries saved for another date, moved onto this date's
   * orthomosaic (measured from the two maps), some crops only if given.
   * Nothing is saved: the editor loads the result for checking.
   */
  moveBoundaries: (body: {
    from_directory: string
    from_version: number
    to_directory: string
    crops?: string[]
    align?: boolean
  }) =>
    call<{
      plots: number
      crops: string[]
      shift: { dx: number; dy: number; match: number | null; unit: string }
      check: string
      state_snapshot: Record<string, unknown>
    }>("/boundaries/move", post(body)),
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
