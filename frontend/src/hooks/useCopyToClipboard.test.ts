import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useCopyToClipboard } from "./useCopyToClipboard"

describe("useCopyToClipboard", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("starts with null copiedText", () => {
    const { result } = renderHook(() => useCopyToClipboard())
    expect(result.current[0]).toBeNull()
  })

  it("writes to the clipboard, exposes the copied value, then clears after 2s", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { clipboard: { writeText } })

    const { result } = renderHook(() => useCopyToClipboard())

    await act(async () => {
      const ok = await result.current[1]("hello")
      expect(ok).toBe(true)
    })
    expect(writeText).toHaveBeenCalledWith("hello")
    expect(result.current[0]).toBe("hello")

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(result.current[0]).toBeNull()
  })

  it("returns false and logs a warning when navigator.clipboard is missing", async () => {
    vi.stubGlobal("navigator", {})
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    const { result } = renderHook(() => useCopyToClipboard())
    const ok = await act(async () => await result.current[1]("x"))

    expect(ok).toBe(false)
    expect(warn).toHaveBeenCalledWith("Clipboard not supported")
    expect(result.current[0]).toBeNull()
  })

  it("returns false and leaves copiedText null when writeText rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"))
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    const { result } = renderHook(() => useCopyToClipboard())
    const ok = await act(async () => await result.current[1]("x"))

    expect(ok).toBe(false)
    expect(result.current[0]).toBeNull()
    expect(warn).toHaveBeenCalledWith("Copy failed", expect.any(Error))
  })
})
