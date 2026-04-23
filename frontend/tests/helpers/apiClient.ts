import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  FilesService,
  OpenAPI,
  PipelinesService,
  WorkspacesService,
  type FileUploadPublic,
  type PipelinePublic,
  type PipelineRunPublic,
  type WorkspacePublic,
} from "../../src/client"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AUTH_FILE = path.resolve(
  __dirname,
  "../../playwright/.auth/e2e-user.json",
)

export const API_BASE = process.env.VITE_API_URL ?? "http://127.0.0.1:8000"
OpenAPI.BASE = API_BASE

let cachedToken: string | null = null

function readToken(): string {
  if (cachedToken !== null) return cachedToken
  const state = JSON.parse(readFileSync(AUTH_FILE, "utf-8")) as {
    origins?: { localStorage?: { name: string; value: string }[] }[]
  }
  const origins = state.origins ?? []
  for (const o of origins) {
    const entry = o.localStorage?.find((e) => e.name === "access_token")
    if (entry) {
      cachedToken = entry.value
      return cachedToken
    }
  }
  throw new Error(
    `No access_token found in ${AUTH_FILE}. Did e2e.setup.ts run first?`,
  )
}

OpenAPI.TOKEN = async () => readToken()

/** Authorization header for raw fetches that bypass the SDK. */
export function authHeader(): string {
  return `Bearer ${readToken()}`
}

// ── Creation helpers (prerequisite state — NEVER the operation under test) ──

export async function createWorkspace(name: string): Promise<WorkspacePublic> {
  return (await WorkspacesService.create({
    requestBody: { name, description: "E2E workspace" },
  })) as WorkspacePublic
}

export async function createAerialPipeline(
  workspaceId: string,
  name: string,
): Promise<PipelinePublic> {
  return (await PipelinesService.create({
    workspaceId,
    requestBody: { name, type: "aerial", workspace_id: workspaceId } as never,
  })) as PipelinePublic
}

export async function createRun(
  pipelineId: string,
  run: {
    date: string
    experiment: string
    location: string
    population: string
    platform: string
    sensor: string
    fileUploadId: string
  },
): Promise<PipelineRunPublic> {
  return (await PipelinesService.createRun({
    pipelineId,
    requestBody: {
      date: run.date,
      experiment: run.experiment,
      location: run.location,
      population: run.population,
      platform: run.platform,
      sensor: run.sensor,
      pipeline_id: pipelineId,
      file_upload_id: run.fileUploadId,
    } as never,
  })) as PipelineRunPublic
}

/**
 * Skip GCP selection (writes an empty gcp_list.txt so ODM falls back to the
 * images' GPS EXIF). Called via raw fetch because the generated SDK does not
 * expose this endpoint.
 */
export async function skipGcp(runId: string): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/v1/pipeline-runs/${runId}/gcp-selection/skip`,
    {
      method: "POST",
      headers: { Authorization: authHeader() },
    },
  )
  if (!res.ok) {
    throw new Error(`skipGcp(${runId}) failed: ${res.status} ${await res.text()}`)
  }
}

/**
 * Run a step synchronously by POSTing to execute-step and then polling the
 * run record until that step is no longer active. Used for prereq steps that
 * aren't the focus of a test (e.g. data_sync before the orthomosaic spec's
 * ODM run). Never use this for the operation under test.
 */
export async function runStepAndWait(
  runId: string,
  step: string,
  timeoutMs = 60_000,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/v1/pipeline-runs/${runId}/execute-step`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader(),
      },
      body: JSON.stringify({ step }),
    },
  )
  if (!res.ok) {
    throw new Error(
      `executeStep(${runId}, ${step}) failed: ${res.status} ${await res.text()}`,
    )
  }
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const run = await readRun(runId)
    if (run.status !== "running" && run.steps_completed?.[step]) return
    if (run.status === "failed") {
      throw new Error(`step ${step} failed: ${run.error ?? "unknown"}`)
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`step ${step} did not complete within ${timeoutMs}ms`)
}

export async function readRun(runId: string): Promise<PipelineRunPublic> {
  return (await PipelinesService.readRun({ id: runId })) as PipelineRunPublic
}

// ── Lookup helpers ────────────────────────────────────────────────────────

export async function findUploadByExperiment(
  experiment: string,
): Promise<FileUploadPublic | null> {
  const { data } = (await FilesService.readFiles({ skip: 0, limit: 1000 })) as {
    data: FileUploadPublic[]
  }
  return data.find((u) => u.experiment === experiment) ?? null
}

// ── Cleanup helpers (best-effort; never throw into test teardown) ─────────

export async function deleteUploadsByPrefix(prefix: string): Promise<number> {
  const { data } = (await FilesService.readFiles({ skip: 0, limit: 1000 })) as {
    data: FileUploadPublic[]
  }
  const victims = data.filter((u) => (u.experiment ?? "").startsWith(prefix))
  for (const v of victims) {
    try {
      await FilesService.deleteFile({ id: v.id })
    } catch (err) {
      console.warn(`deleteFile ${v.id} failed:`, err)
    }
  }
  return victims.length
}

export async function deleteWorkspacesByPrefix(prefix: string): Promise<number> {
  const { data } = (await WorkspacesService.readAll({ skip: 0, limit: 1000 })) as {
    data: WorkspacePublic[]
  }
  const victims = data.filter((w) => w.name.startsWith(prefix))
  for (const w of victims) {
    try {
      await WorkspacesService.delete({ id: w.id })
    } catch (err) {
      console.warn(`deleteWorkspace ${w.id} failed:`, err)
    }
  }
  return victims.length
}

export async function deleteRunsByPrefix(prefix: string): Promise<number> {
  void prefix
  return 0 // Kept for API compatibility with v1 fixtures; cascade from workspace
}
