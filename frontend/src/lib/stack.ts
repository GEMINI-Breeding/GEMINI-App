/**
 * The local GEMINIbase stack, as the desktop app runs it (src-tauri/src/stack.rs).
 *
 * Release builds set `window.__GEMI_MANAGED_STACK__`; the app then checks
 * Docker, asks for a data folder on first run, starts the stack and signs
 * in with the install's own account (StackGate). In the browser and in
 * development builds none of this applies: requests go through Vite's
 * proxy to the stack from `npm run dev:backend`.
 */
import { invoke as tauriInvoke } from "@tauri-apps/api/core"

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
  /** Free space on the data folder's drive, in bytes. */
  free_bytes: number | null
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

/** The packaged desktop app (as opposed to a browser or a development build). */
export function isDesktopApp(): boolean {
  return typeof window !== "undefined" && w().__GEMI_MANAGED_STACK__ === true
}

/**
 * Where the processing stack runs. "local": Docker on this computer, started
 * and stopped by the app. "cluster": an HPC cluster the agent set up; the app
 * then starts nothing here and reaches the cluster through the agent
 * service's tunnel, exactly like the browser does.
 */
export type StackMode = "local" | "cluster"
const MODE_KEY = "gemini.stack.mode"
/** The tunnel the agent service opens to a cluster's API. */
export const CLUSTER_API_URL = "http://127.0.0.1:7777"
/** TiTiler beside that API: the map tiles (orthomosaics, rover mosaics). */
export const CLUSTER_TITILER_URL = "http://127.0.0.1:8091"

export function stackMode(): StackMode {
  try {
    return localStorage.getItem(MODE_KEY) === "cluster" ? "cluster" : "local"
  } catch {
    return "local"
  }
}

export function setStackMode(mode: StackMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode)
  } catch {
    // Storage unavailable: stays local.
  }
}

/** The desktop app, running its own Docker stack. */
export function isManagedStack(): boolean {
  return isDesktopApp() && stackMode() === "local"
}

/** Desktop app pointed at a cluster: send API calls to the tunnel. */
export function applyClusterUrls(): void {
  if (isDesktopApp() && stackMode() === "cluster") {
    w().__GEMI_BACKEND_URL__ = CLUSTER_API_URL
    // Without this the map asked the app's own origin for tiles ("/titiler"),
    // which only the browser's dev server answers: no underlay, and no zoom
    // to it, in the boundary editor and every other map.
    w().__GEMI_TITILER_URL__ = CLUSTER_TITILER_URL
    OpenAPI.BASE = CLUSTER_API_URL
  }
}

// Safe to import in the browser: it only touches Tauri when called.
const invoke = <T>(cmd: string, args?: Record<string, unknown>) =>
  tauriInvoke<T>(cmd, args)

export const stackStatus = () => invoke<StackStatus>("stack_status")
export const configureStack = (dataDir: string) =>
  invoke<StackConfig>("stack_configure", { dataDir })
export const startStack = () => invoke<void>("stack_start")
export const stopStack = () => invoke<void>("stack_stop")
export const stackLogs = (tail?: number) =>
  invoke<string>("stack_logs", { tail })
export const restartStack = () => invoke<void>("stack_restart")
export const stopStackAndQuit = () => invoke<void>("stack_stop_and_quit")
export const stackDataSize = () => invoke<number>("stack_data_size")
/** Copy the data to `to`, verify, switch and restart; the old folder is kept. */
export const moveStackData = (to: string) =>
  invoke<StackConfig>("stack_move_data", { to })
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
