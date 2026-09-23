/**
 * The local GEMINIbase stack, as the desktop app runs it (src-tauri/src/stack.rs).
 *
 * Release builds set `window.__GEMI_MANAGED_STACK__`; the app then checks
 * Docker, asks for a data folder on first run, starts the stack and signs
 * in with the install's own account (StackGate). In the browser and in
 * development builds none of this applies: requests go through Vite's
 * proxy to the stack from `npm run dev:backend`.
 */
import { OpenAPI } from "@/client/core/OpenAPI"

export type DockerStatus =
  | { state: "missing" }
  | { state: "not_running"; detail: string }
  | { state: "no_compose" }
  | { state: "ready"; version: string }

export interface StackConfig {
  data_dir: string
  api_port: number
  titiler_port: number
}

export interface StackStatus {
  managed: boolean
  version: string
  docker: DockerStatus
  config: StackConfig | null
  api_url: string | null
  titiler_url: string | null
  healthy: boolean
  default_data_dir: string | null
  legacy_install: string | null
}

export interface StackProgress {
  phase: "pull" | "start" | "ready" | "error"
  message: string
}

type StackWindow = Window & {
  __GEMI_MANAGED_STACK__?: boolean
  __GEMI_BACKEND_URL__?: string
  __GEMI_TITILER_URL__?: string
}

const w = () => window as StackWindow

export function isManagedStack(): boolean {
  return typeof window !== "undefined" && w().__GEMI_MANAGED_STACK__ === true
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>) {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(cmd, args)
}

export const stackStatus = () => invoke<StackStatus>("stack_status")
export const configureStack = (dataDir: string) =>
  invoke<StackConfig>("stack_configure", { dataDir })
export const startStack = () => invoke<void>("stack_start")
export const stopStack = () => invoke<void>("stack_stop")
export const stackLogs = (tail?: number) =>
  invoke<string>("stack_logs", { tail })
export const stackCredentials = () =>
  invoke<{ email: string; password: string }>("stack_credentials")

export async function onStackProgress(
  handler: (p: StackProgress) => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event")
  return listen<StackProgress>("stack:progress", (e) => handler(e.payload))
}

/** Point every API and tile request at the running stack. */
export function applyStackUrls(status: StackStatus): void {
  if (status.api_url) {
    w().__GEMI_BACKEND_URL__ = status.api_url
    OpenAPI.BASE = status.api_url
  }
  if (status.titiler_url) w().__GEMI_TITILER_URL__ = status.titiler_url
}

/**
 * Base URL for TiTiler: the stack's own port in the desktop app, the Vite
 * dev proxy (`/titiler`) otherwise.
 */
export function titilerBase(): string {
  return w().__GEMI_TITILER_URL__ ?? "/titiler"
}
