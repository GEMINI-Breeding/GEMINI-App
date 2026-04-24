/**
 * Unit tests for ExperimentContext.
 */
import { act, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  ExperimentProvider,
  useExperimentScope,
} from "./ExperimentContext"

function wrapper({ children }: { children: ReactNode }) {
  return <ExperimentProvider>{children}</ExperimentProvider>
}

describe("ExperimentContext", () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    localStorage.clear()
  })

  it("starts with all ids null", () => {
    const { result } = renderHook(() => useExperimentScope(), { wrapper })
    expect(result.current.experimentId).toBeNull()
    expect(result.current.seasonId).toBeNull()
    expect(result.current.siteId).toBeNull()
    expect(result.current.populationId).toBeNull()
  })

  it("persists a selection to localStorage", () => {
    const { result } = renderHook(() => useExperimentScope(), { wrapper })
    act(() => {
      result.current.setExperimentId("exp-1")
      result.current.setSeasonId("season-1")
    })
    expect(result.current.experimentId).toBe("exp-1")
    const raw = localStorage.getItem("gemini.experiment.scope")
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(parsed.experimentId).toBe("exp-1")
    expect(parsed.seasonId).toBe("season-1")
  })

  it("clearing the experiment also clears the dependent selections", () => {
    const { result } = renderHook(() => useExperimentScope(), { wrapper })
    act(() => {
      result.current.setExperimentId("exp-1")
      result.current.setSeasonId("season-1")
      result.current.setSiteId("site-1")
      result.current.setPopulationId("pop-1")
    })
    act(() => {
      result.current.setExperimentId("exp-2")
    })
    expect(result.current.experimentId).toBe("exp-2")
    expect(result.current.seasonId).toBeNull()
    expect(result.current.siteId).toBeNull()
    expect(result.current.populationId).toBeNull()
  })

  it("hydrates from localStorage on mount", () => {
    localStorage.setItem(
      "gemini.experiment.scope",
      JSON.stringify({
        experimentId: "exp-5",
        seasonId: null,
        siteId: "site-5",
        populationId: null,
      }),
    )
    const { result } = renderHook(() => useExperimentScope(), { wrapper })
    expect(result.current.experimentId).toBe("exp-5")
    expect(result.current.siteId).toBe("site-5")
  })

  it("reset clears everything", () => {
    const { result } = renderHook(() => useExperimentScope(), { wrapper })
    act(() => {
      result.current.setExperimentId("exp-1")
      result.current.setSeasonId("s1")
      result.current.reset()
    })
    expect(result.current.experimentId).toBeNull()
    expect(result.current.seasonId).toBeNull()
  })

  it("throws a clear error when used outside the provider", () => {
    // Silence react's error-boundary output for this expected throw.
    const origError = console.error
    console.error = () => {}
    try {
      expect(() => renderHook(() => useExperimentScope())).toThrowError(
        /ExperimentProvider/,
      )
    } finally {
      console.error = origError
    }
  })
})
