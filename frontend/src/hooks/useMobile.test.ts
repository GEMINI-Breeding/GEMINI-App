import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("useIsMobile", () => {
  let listeners: Array<(ev: MediaQueryListEvent) => void>

  beforeEach(() => {
    listeners = []
    const mql: Partial<MediaQueryList> = {
      matches: false,
      media: "",
      addEventListener: (_: string, cb: (ev: MediaQueryListEvent) => void) => {
        listeners.push(cb)
      },
      removeEventListener: (_: string, cb: (ev: MediaQueryListEvent) => void) => {
        listeners = listeners.filter((l) => l !== cb)
      },
    }
    window.matchMedia = vi.fn(() => mql as MediaQueryList)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns false when innerWidth is >= 768 (desktop)", async () => {
    Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true })
    const { useIsMobile } = await import("./useMobile")
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)
  })

  it("returns true when innerWidth is < 768 (mobile)", async () => {
    Object.defineProperty(window, "innerWidth", { value: 320, configurable: true })
    const { useIsMobile } = await import("./useMobile")
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(true)
  })

  it("re-reads innerWidth when the media query 'change' event fires", async () => {
    Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true })
    const { useIsMobile } = await import("./useMobile")
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)

    act(() => {
      Object.defineProperty(window, "innerWidth", { value: 400, configurable: true })
      for (const l of listeners) l({} as MediaQueryListEvent)
    })
    expect(result.current).toBe(true)
  })
})
