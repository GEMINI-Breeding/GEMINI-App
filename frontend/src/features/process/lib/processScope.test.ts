/**
 * Unit tests for processScope — module-level store + cascade + persistence.
 */
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { __resetProcessScopeForTests, useProcessScope } from "./processScope"

describe("processScope", () => {
  beforeEach(() => {
    localStorage.clear()
    act(() => {
      __resetProcessScopeForTests()
    })
  })
  afterEach(() => {
    localStorage.clear()
    act(() => {
      __resetProcessScopeForTests()
    })
  })

  it("starts with all ids null", () => {
    const { result } = renderHook(() => useProcessScope())
    expect(result.current.experimentId).toBeNull()
    expect(result.current.seasonId).toBeNull()
    expect(result.current.siteId).toBeNull()
    expect(result.current.populationId).toBeNull()
  })

  it("persists a selection to localStorage", () => {
    const { result } = renderHook(() => useProcessScope())
    act(() => {
      result.current.setExperimentId("exp-1")
      result.current.setSeasonId("season-1")
    })
    expect(result.current.experimentId).toBe("exp-1")
    const raw = localStorage.getItem("gemini.process.scope")
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(parsed.experimentId).toBe("exp-1")
    expect(parsed.seasonId).toBe("season-1")
  })

  it("clearing the experiment also clears the dependent selections", () => {
    const { result } = renderHook(() => useProcessScope())
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

  it("does NOT cascade-clear when re-selecting the same experiment", () => {
    const { result } = renderHook(() => useProcessScope())
    act(() => {
      result.current.setExperimentId("exp-1")
      result.current.setSeasonId("season-1")
    })
    act(() => {
      result.current.setExperimentId("exp-1")
    })
    expect(result.current.seasonId).toBe("season-1")
  })

  it("reset clears everything", () => {
    const { result } = renderHook(() => useProcessScope())
    act(() => {
      result.current.setExperimentId("exp-1")
      result.current.setSeasonId("s1")
      result.current.reset()
    })
    expect(result.current.experimentId).toBeNull()
    expect(result.current.seasonId).toBeNull()
  })

  it("two consumers see the same store state", () => {
    const a = renderHook(() => useProcessScope())
    const b = renderHook(() => useProcessScope())
    act(() => {
      a.result.current.setExperimentId("exp-shared")
    })
    expect(b.result.current.experimentId).toBe("exp-shared")
  })
})
