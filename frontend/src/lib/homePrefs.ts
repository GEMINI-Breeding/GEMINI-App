/**
 * What the Home page shows: the agent, the dashboard, or both.
 *
 * A person who processes by hand can turn the agent off: no agent panel on
 * Home, no "continue with the agent" cards on runs, no model set-up asked
 * for. One who never looks at the dashboard can hide that instead. At least
 * one of the two stays on.
 *
 * Kept per browser (localStorage), read through useSyncExternalStore so
 * every component sees a change at once.
 */
import { useSyncExternalStore } from "react"

export interface HomePrefs {
  agent: boolean
  dashboard: boolean
  /** The Home tab last opened, when both are on. */
  view: "dashboard" | "agent"
  /** Set once the person has chosen how they want to work (walkthrough). */
  chosen: boolean
}

const KEY = "gemi.homePrefs.v1"
const DEFAULTS: HomePrefs = {
  agent: true,
  dashboard: true,
  view: "dashboard",
  chosen: false,
}

let current: HomePrefs = read()
const listeners = new Set<() => void>()

function read(): HomePrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<HomePrefs>) }
  } catch {
    // unavailable or corrupt: defaults
  }
  return DEFAULTS
}

export function getHomePrefs(): HomePrefs {
  return current
}

export function setHomePrefs(patch: Partial<HomePrefs>): void {
  const next = { ...current, ...patch }
  // never both off
  if (!next.agent && !next.dashboard) {
    if (patch.agent === false) next.dashboard = true
    else next.agent = true
  }
  if (!next.agent) next.view = "dashboard"
  if (!next.dashboard) next.view = "agent"
  current = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // not kept across reloads; still applies now
  }
  for (const l of listeners) l()
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useHomePrefs(): HomePrefs {
  return useSyncExternalStore(subscribe, getHomePrefs, getHomePrefs)
}

/** True unless the person turned the agent off. */
export function useAgentEnabled(): boolean {
  return useHomePrefs().agent
}
