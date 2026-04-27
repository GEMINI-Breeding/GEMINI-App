/**
 * ExperimentContext — the data-scope shared across every feature page.
 *
 * The pre-migration frontend keyed everything off a "workspace" picker.
 * GEMINIbase's equivalent is an experiment, and each experiment can have
 * many seasons, sites, and populations. Feature pages usually pick one
 * of each from this context rather than surfacing their own selectors.
 *
 * Persistence: the last-selected (experimentId, seasonId, siteId,
 * populationId) tuple is written to localStorage so a reload lands the
 * user back where they were.
 *
 * When the user is not a superuser we filter the experiments list to
 * those returned by /api/users/me/experiments — keeping power users
 * off experiments they haven't joined.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"

type Id = string

export type ExperimentScope = {
  experimentId: Id | null
  seasonId: Id | null
  siteId: Id | null
  populationId: Id | null
}

type ExperimentContextValue = ExperimentScope & {
  setExperimentId: (id: Id | null) => void
  setSeasonId: (id: Id | null) => void
  setSiteId: (id: Id | null) => void
  setPopulationId: (id: Id | null) => void
  reset: () => void
}

const STORAGE_KEY = "gemini.experiment.scope"

const empty: ExperimentScope = {
  experimentId: null,
  seasonId: null,
  siteId: null,
  populationId: null,
}

export const ExperimentContext = createContext<ExperimentContextValue | null>(null)

function readStored(): ExperimentScope {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return empty
    const parsed = JSON.parse(raw) as Partial<ExperimentScope>
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

function writeStored(scope: ExperimentScope) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scope))
  } catch {
    // Best-effort; private-mode Safari throws from localStorage.
  }
}

export function ExperimentProvider({ children }: { children: ReactNode }) {
  const [scope, setScope] = useState<ExperimentScope>(readStored)

  useEffect(() => {
    writeStored(scope)
  }, [scope])

  // Clearing the experiment must also clear the dependent selections —
  // otherwise the UI would re-render with a stale seasonId / siteId that
  // no longer belongs to the active experiment.
  const setExperimentId = useCallback((id: Id | null) => {
    setScope((prev) =>
      prev.experimentId === id
        ? prev
        : { experimentId: id, seasonId: null, siteId: null, populationId: null },
    )
  }, [])
  const setSeasonId = useCallback((id: Id | null) => {
    setScope((prev) => ({ ...prev, seasonId: id }))
  }, [])
  const setSiteId = useCallback((id: Id | null) => {
    setScope((prev) => ({ ...prev, siteId: id }))
  }, [])
  const setPopulationId = useCallback((id: Id | null) => {
    setScope((prev) => ({ ...prev, populationId: id }))
  }, [])
  const reset = useCallback(() => setScope(empty), [])

  const value = useMemo<ExperimentContextValue>(
    () => ({
      ...scope,
      setExperimentId,
      setSeasonId,
      setSiteId,
      setPopulationId,
      reset,
    }),
    [scope, setExperimentId, setSeasonId, setSiteId, setPopulationId, reset],
  )

  return (
    <ExperimentContext.Provider value={value}>
      {children}
    </ExperimentContext.Provider>
  )
}

export function useExperimentScope(): ExperimentContextValue {
  const ctx = useContext(ExperimentContext)
  if (!ctx) {
    throw new Error("useExperimentScope must be used inside <ExperimentProvider>")
  }
  return ctx
}
