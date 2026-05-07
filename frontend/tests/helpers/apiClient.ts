/**
 * Playwright API-client helpers — PHASE 5 STUB.
 *
 * The pre-migration helpers seeded workspaces / pipelines / pipeline-runs
 * via the dead FastAPI SDK. Every test spec that used these is being
 * rewritten across Phases 6–12 to drive the real UI (per CLAUDE.md's
 * strict-E2E rule), so the helper surface is about to be replaced wholesale.
 *
 * Until that rewrite lands, every seeder export throws with a clear message
 * if invoked. The file still compiles so Playwright can discover the specs
 * that reach it via unrelated imports.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const API_BASE = process.env.VITE_API_URL ?? "http://127.0.0.1:7777"

const AUTH_FILE = path.resolve(
  __dirname,
  "../../playwright/.auth/e2e-user.json",
)

const DEPRECATED = (name: string): never => {
  throw new Error(
    `[apiClient] ${name} was removed during the Phase 5 migration. The ` +
      `spec that calls this must be rewritten to drive the real UI against ` +
      `the GEMINIbase backend (see Phase 6–12 task list in task_plan.md).`,
  )
}

let cachedToken: string | null = null

function readToken(): string {
  if (cachedToken !== null) return cachedToken
  const state = JSON.parse(readFileSync(AUTH_FILE, "utf-8")) as {
    origins?: { localStorage?: { name: string; value: string }[] }[]
  }
  const origins = state.origins ?? []
  for (const o of origins) {
    const entry = o.localStorage?.find(
      (e) => e.name === "gemini.auth.token" || e.name === "access_token",
    )
    if (entry) {
      cachedToken = entry.value
      return cachedToken
    }
  }
  throw new Error(
    `No bearer token found in ${AUTH_FILE}. Did e2e.setup.ts run first?`,
  )
}

export function authHeader(): string {
  return `Bearer ${readToken()}`
}

export async function createWorkspace(_name: string): Promise<any> {
  return DEPRECATED("createWorkspace")
}

export async function createAerialPipeline(
  _workspaceId: string,
  ..._rest: unknown[]
): Promise<any> {
  return DEPRECATED("createAerialPipeline")
}

export async function createRun(..._args: unknown[]): Promise<any> {
  return DEPRECATED("createRun")
}

export async function skipGcp(_runId: string): Promise<void> {
  return DEPRECATED("skipGcp")
}

export async function runStepAndWait(..._args: unknown[]): Promise<void> {
  return DEPRECATED("runStepAndWait")
}

export async function readRun(_runId: string): Promise<any> {
  return DEPRECATED("readRun")
}

export async function findUploadByExperiment(
  ..._args: unknown[]
): Promise<any> {
  return DEPRECATED("findUploadByExperiment")
}

export async function deleteUploadsByPrefix(_prefix: string): Promise<number> {
  return DEPRECATED("deleteUploadsByPrefix")
}

export async function deleteWorkspacesByPrefix(
  _prefix: string,
): Promise<number> {
  return DEPRECATED("deleteWorkspacesByPrefix")
}
