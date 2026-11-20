/**
 * processScope — local experiment / season / site / population scope
 * shared across the Process tool pages (Pipeline overview, OrthomosaicTool,
 * PlotBoundaries, SplitOrthomosaicTool, ExtractTraitsTool, JobDetail,
 * InferencePage).
 *
 * This replaces the global sidebar ExperimentContext for the Process surface
 * specifically. Files / Analyze are intentionally cross-scope and don't read
 * this. Persisted to localStorage so navigating between Process tools and
 * reloading both keep the same scope.
 *
 * Implementation: a module-level store + useSyncExternalStore — no Provider
 * needed, all subscribers see the same value.
 */
import { useSyncExternalStore } from "react"

type Id = string

export type ProcessScope = {
  experimentId: Id | null
  seasonId: Id | null
  siteId: Id | null
  populationId: Id | null
}

const STORAGE_KEY = "gemini.process.scope"

const empty: ProcessScope = {
  experimentId: null,
  seasonId: null,
  siteId: null,
  populationId: null,
}

function readStored(): ProcessScope {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return empty
    const parsed = JSON.parse(raw) as Partial<ProcessScope>
    return {
      experimentId: parsed.experimentId ?? null,
      seasonId: parsed.seasonId ?? null,
      siteId: parsed.siteId ?? null,
      populationId: parsed.populationId ?? null,
    }
  } catch {
    return empty
  }
}

function writeStored(scope: ProcessScope) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scope))
  } catch {
    // Best-effort; private-mode Safari throws from localStorage.
  }
}

let current: ProcessScope = readStored()
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function setScope(next: ProcessScope) {
  if (
    next.experimentId === current.experimentId &&
    next.seasonId === current.seasonId &&
    next.siteId === current.siteId &&
    next.populationId === current.populationId
  ) {
    return
  }
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

function getSnapshot(): ProcessScope {
  return current
}

export type ProcessScopeValue = ProcessScope & {
  setExperimentId: (id: Id | null) => void
  setSeasonId: (id: Id | null) => void
  setSiteId: (id: Id | null) => void
  setPopulationId: (id: Id | null) => void
  reset: () => void
}

const setExperimentId = (id: Id | null) => {
  // Cascade-clear children so the picker doesn't render a stale season /
  // site / population that no longer belongs to the chosen experiment.
  if (current.experimentId === id) return
  setScope({
    experimentId: id,
    seasonId: null,
    siteId: null,
    populationId: null,
  })
}
const setSeasonId = (id: Id | null) => setScope({ ...current, seasonId: id })
const setSiteId = (id: Id | null) => setScope({ ...current, siteId: id })
const setPopulationId = (id: Id | null) =>
  setScope({ ...current, populationId: id })
const reset = () => setScope(empty)

export function useProcessScope(): ProcessScopeValue {
  const scope = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return {
    ...scope,
    setExperimentId,
    setSeasonId,
    setSiteId,
    setPopulationId,
    reset,
  }
}

/** Test-only hook for resetting the module state between specs. */
export function __resetProcessScopeForTests() {
  current = empty
  emit()
}
