/**
 * File runs where a person would look for them: under their experiment.
 *
 * Earlier versions of the agent put every run it started in one "Agent runs"
 * workspace. `regroupAgentRuns` moves each into the workspace that already
 * holds most runs of its experiment (else one named after the experiment,
 * made if needed), joining a pipeline of the same type there, preferring the
 * one used for the same platform and sensor; when there is none, the run's
 * old pipeline settings come along. The emptied "Agent runs" workspace is
 * removed. Only these records change: jobs and data are untouched.
 *
 * Mirrors `ProcessRuns._workspace_for` / `_pipeline_for` in the agent, which
 * files new agent runs the same way.
 */
import {
  createPipeline,
  createWorkspace,
  deleteWorkspace,
  getState,
  moveRun,
  type Pipeline,
  type Run,
  type Workspace,
} from "./runStore"

export const LEGACY_WORKSPACE = "Agent runs"

const norm = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[_-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")

/** The workspace an experiment's runs belong in (made when there is none). */
export function workspaceForExperiment(experiment: string): Workspace {
  const st = getState()
  const spaces = st.workspaces.filter((w) => w.name !== LEGACY_WORKSPACE)
  const held = new Map<string, number>()
  for (const r of st.runs)
    if (norm(r.uploadScope?.experiment) === norm(experiment))
      held.set(r.workspaceId, (held.get(r.workspaceId) ?? 0) + 1)
  const most = spaces
    .filter((w) => held.get(w.id))
    .sort((a, b) => (held.get(b.id) ?? 0) - (held.get(a.id) ?? 0))[0]
  return (
    most ??
    spaces.find((w) => norm(w.name) === norm(experiment)) ??
    createWorkspace({
      name: experiment || "Unnamed experiment",
      description: `Experiment ${experiment}`,
    })
  )
}

/**
 * A pipeline of this type in the workspace, preferring the one whose runs
 * share this platform and sensor (same settings); else a new one.
 */
export function pipelineForKind(
  ws: Workspace,
  kit: {
    type: Pipeline["type"]
    platform?: string
    sensor?: string
    params: Record<string, unknown>
  },
): Pipeline {
  const st = getState()
  const sameKit = (p: Pipeline) =>
    st.runs.filter(
      (r) =>
        r.pipelineId === p.id &&
        norm(r.uploadScope?.platform) === norm(kit.platform) &&
        norm(r.uploadScope?.sensor) === norm(kit.sensor),
    ).length
  const pipes = st.pipelines
    .filter((p) => p.workspaceId === ws.id && p.type === kit.type)
    .sort((a, b) => sameKit(b) - sameKit(a))
  return (
    pipes[0] ??
    createPipeline({
      workspaceId: ws.id,
      name: `${kit.type === "ground" ? "Ground" : "Aerial"} · ${kit.platform ?? ""}/${kit.sensor ?? ""}`,
      type: kit.type,
      params: kit.params,
    })
  )
}

function pipelineFor(ws: Workspace, run: Run, old?: Pipeline): Pipeline {
  return pipelineForKind(ws, {
    type: old?.type ?? "ground",
    platform: run.uploadScope?.platform,
    sensor: run.uploadScope?.sensor,
    params: old?.params ?? {},
  })
}

export function legacyRunCount(): number {
  const st = getState()
  const ids = new Set(
    st.workspaces.filter((w) => w.name === LEGACY_WORKSPACE).map((w) => w.id),
  )
  return st.runs.filter((r) => ids.has(r.workspaceId)).length
}

export function regroupAgentRuns(): number {
  const st = getState()
  const legacy = st.workspaces.filter((w) => w.name === LEGACY_WORKSPACE)
  const ids = new Set(legacy.map((w) => w.id))
  const oldPipes = new Map(
    st.pipelines.filter((p) => ids.has(p.workspaceId)).map((p) => [p.id, p]),
  )
  let moved = 0
  for (const run of st.runs.filter((r) => ids.has(r.workspaceId))) {
    const ws = workspaceForExperiment(run.uploadScope?.experiment ?? "")
    const pipe = pipelineFor(ws, run, oldPipes.get(run.pipelineId))
    moveRun(run.id, pipe.id)
    moved++
  }
  const after = getState()
  for (const w of legacy)
    if (!after.runs.some((r) => r.workspaceId === w.id)) deleteWorkspace(w.id)
  return moved
}
