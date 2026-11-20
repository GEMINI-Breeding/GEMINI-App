import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useDraftPersistence } from "./useDraftPersistence"

const KEY = "test.draft.v1"

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-05-16T12:00:00Z"))
})

afterEach(() => {
  vi.useRealTimers()
})

describe("useDraftPersistence", () => {
  it("returns null initial draft when nothing is stored", () => {
    const { result } = renderHook(() =>
      useDraftPersistence({
        storageKey: KEY,
        state: { count: 0 },
        runId: "r1",
        directory: "/d",
        isDirty: () => false,
      }),
    )
    expect(result.current.initialDraft).toBeNull()
  })

  it("reads an existing draft on mount", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        schemaVersion: 1,
        runId: "r1",
        directory: "/d",
        lastModifiedAt: "2026-05-15T00:00:00Z",
        state: { count: 7 },
      }),
    )
    const { result } = renderHook(() =>
      useDraftPersistence({
        storageKey: KEY,
        state: { count: 0 },
        runId: "r1",
        directory: "/d",
        isDirty: () => false,
      }),
    )
    expect(result.current.initialDraft?.state).toEqual({ count: 7 })
  })

  it("ignores drafts with an unknown schemaVersion", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        schemaVersion: 99,
        state: { count: 7 },
      }),
    )
    const { result } = renderHook(() =>
      useDraftPersistence({
        storageKey: KEY,
        state: { count: 0 },
        runId: "r1",
        directory: "/d",
        isDirty: () => false,
      }),
    )
    expect(result.current.initialDraft).toBeNull()
  })

  it("writes a debounced draft on state change when dirty", () => {
    const { rerender } = renderHook(
      ({ state }) =>
        useDraftPersistence({
          storageKey: KEY,
          state,
          runId: "r1",
          directory: "/d",
          isDirty: (s) => s.count > 0,
          debounceMs: 300,
        }),
      { initialProps: { state: { count: 0 } } },
    )

    rerender({ state: { count: 5 } })
    expect(localStorage.getItem(KEY)).toBeNull()
    act(() => {
      vi.advanceTimersByTime(299)
    })
    expect(localStorage.getItem(KEY)).toBeNull()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "null")
    expect(stored?.state).toEqual({ count: 5 })
    expect(stored?.runId).toBe("r1")
  })

  it("removes the draft when state becomes clean", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        schemaVersion: 1,
        runId: "r1",
        directory: "/d",
        lastModifiedAt: "2026-05-15T00:00:00Z",
        state: { count: 7 },
      }),
    )
    const { rerender } = renderHook(
      ({ state }) =>
        useDraftPersistence({
          storageKey: KEY,
          state,
          runId: "r1",
          directory: "/d",
          isDirty: (s) => s.count > 0,
          debounceMs: 100,
        }),
      { initialProps: { state: { count: 1 } } },
    )
    rerender({ state: { count: 0 } })
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it("discardDraft removes the key", () => {
    localStorage.setItem(KEY, "{}")
    const { result } = renderHook(() =>
      useDraftPersistence({
        storageKey: KEY,
        state: {},
        runId: "r1",
        directory: "/d",
        isDirty: () => true,
        disableBeforeUnload: true,
      }),
    )
    act(() => result.current.discardDraft())
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it("flushes synchronously on unmount", () => {
    const { rerender, unmount } = renderHook(
      ({ state }) =>
        useDraftPersistence({
          storageKey: KEY,
          state,
          runId: "r1",
          directory: "/d",
          isDirty: () => true,
          debounceMs: 1000,
          disableBeforeUnload: true,
        }),
      { initialProps: { state: { count: 0 } } },
    )
    rerender({ state: { count: 42 } })
    // Before the debounce fires, unmount — flush should run anyway.
    unmount()
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "null")
    expect(stored?.state).toEqual({ count: 42 })
  })
})
