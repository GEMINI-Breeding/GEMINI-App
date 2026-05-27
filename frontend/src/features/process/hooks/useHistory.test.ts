import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useHistory } from "./useHistory"

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
})

afterEach(() => {
  vi.useRealTimers()
})

describe("useHistory", () => {
  it("starts with initial state and no undo/redo available", () => {
    const { result } = renderHook(() => useHistory({ n: 0 }))
    expect(result.current.state).toEqual({ n: 0 })
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
  })

  it("set pushes onto history and enables undo", () => {
    const { result } = renderHook(() => useHistory({ n: 0 }))
    act(() => result.current.set({ n: 1 }))
    act(() => vi.advanceTimersByTime(2000))
    act(() => result.current.set({ n: 2 }))
    expect(result.current.state).toEqual({ n: 2 })
    expect(result.current.canUndo).toBe(true)
    act(() => result.current.undo())
    expect(result.current.state).toEqual({ n: 1 })
    act(() => result.current.undo())
    expect(result.current.state).toEqual({ n: 0 })
    expect(result.current.canUndo).toBe(false)
  })

  it("redo restores future entries", () => {
    const { result } = renderHook(() => useHistory({ n: 0 }))
    act(() => result.current.set({ n: 1 }))
    act(() => vi.advanceTimersByTime(2000))
    act(() => result.current.set({ n: 2 }))
    act(() => result.current.undo())
    expect(result.current.canRedo).toBe(true)
    act(() => result.current.redo())
    expect(result.current.state).toEqual({ n: 2 })
  })

  it("set after undo clears the future", () => {
    const { result } = renderHook(() => useHistory({ n: 0 }))
    act(() => result.current.set({ n: 1 }))
    act(() => vi.advanceTimersByTime(2000))
    act(() => result.current.set({ n: 2 }))
    act(() => result.current.undo())
    expect(result.current.canRedo).toBe(true)
    act(() => vi.advanceTimersByTime(2000))
    act(() => result.current.set({ n: 99 }))
    expect(result.current.canRedo).toBe(false)
  })

  it("limit trims oldest past entries", () => {
    const { result } = renderHook(() => useHistory({ n: 0 }, { limit: 2 }))
    for (let i = 1; i <= 5; i += 1) {
      act(() => result.current.set({ n: i }))
      act(() => vi.advanceTimersByTime(2000))
    }
    expect(result.current.state).toEqual({ n: 5 })
    // Past holds {n:3}, {n:4} (size 2). Undo twice -> n:3, then undo no-ops.
    act(() => result.current.undo())
    expect(result.current.state).toEqual({ n: 4 })
    act(() => result.current.undo())
    expect(result.current.state).toEqual({ n: 3 })
    act(() => result.current.undo())
    expect(result.current.state).toEqual({ n: 3 })
  })

  it("coalesce collapses consecutive same-tag sets within window", () => {
    const { result } = renderHook(() => useHistory({ n: 0 }))
    act(() => result.current.set({ n: 1 }, { tag: "x", coalesce: true }))
    act(() => vi.advanceTimersByTime(500))
    act(() => result.current.set({ n: 2 }, { tag: "x", coalesce: true }))
    expect(result.current.state).toEqual({ n: 2 })
    // Only one undoable entry exists — the {n:2} above replaced {n:1}.
    act(() => result.current.undo())
    expect(result.current.state).toEqual({ n: 0 })
  })

  it("coalesce does not collapse beyond the time window", () => {
    const { result } = renderHook(() => useHistory({ n: 0 }))
    act(() => result.current.set({ n: 1 }, { tag: "x", coalesce: true }))
    act(() => vi.advanceTimersByTime(2000))
    act(() => result.current.set({ n: 2 }, { tag: "x", coalesce: true }))
    act(() => result.current.undo())
    expect(result.current.state).toEqual({ n: 1 })
  })

  it("coalesce respects tag mismatch", () => {
    const { result } = renderHook(() => useHistory({ n: 0 }))
    act(() => result.current.set({ n: 1 }, { tag: "a", coalesce: true }))
    act(() => result.current.set({ n: 2 }, { tag: "b", coalesce: true }))
    act(() => result.current.undo())
    expect(result.current.state).toEqual({ n: 1 })
  })

  it("replace mutates present without pushing history", () => {
    const { result } = renderHook(() => useHistory({ n: 0 }))
    act(() => result.current.set({ n: 1 }))
    act(() => result.current.replace({ n: 42 }))
    expect(result.current.state).toEqual({ n: 42 })
    act(() => result.current.undo())
    expect(result.current.state).toEqual({ n: 0 })
  })

  it("clearHistory resets past/future and optionally replaces present", () => {
    const { result } = renderHook(() => useHistory({ n: 0 }))
    act(() => result.current.set({ n: 1 }))
    act(() => vi.advanceTimersByTime(2000))
    act(() => result.current.set({ n: 2 }))
    act(() => result.current.clearHistory({ n: 100 }))
    expect(result.current.state).toEqual({ n: 100 })
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
  })
})
