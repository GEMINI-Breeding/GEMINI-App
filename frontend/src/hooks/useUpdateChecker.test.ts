import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  CURRENT_VERSION,
  checkForUpdates,
  useUpdateChecker,
} from "./useUpdateChecker"

const RELEASES_PAGE = "https://github.com/GEMINI-Breeding/GEMINI-App/releases"

function mockFetchResponse(body: unknown, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response)
}

describe("checkForUpdates", () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns 'update_available' with RELEASES_PAGE when the remote tag is newer", async () => {
    fetchMock.mockReturnValueOnce(
      mockFetchResponse({ tag_name: "v99.0.0", html_url: "ignored" }),
    )
    const res = await checkForUpdates()
    expect(res).toEqual({
      status: "update_available",
      version: "v99.0.0",
      downloadUrl: RELEASES_PAGE,
    })
  })

  it("returns 'up_to_date' when the remote tag equals CURRENT_VERSION", async () => {
    fetchMock.mockReturnValueOnce(
      mockFetchResponse({ tag_name: CURRENT_VERSION }),
    )
    const res = await checkForUpdates()
    expect(res).toEqual({ status: "up_to_date", version: CURRENT_VERSION })
  })

  it("returns 'up_to_date' when the remote tag is older", async () => {
    fetchMock.mockReturnValueOnce(mockFetchResponse({ tag_name: "v0.0.0" }))
    const res = await checkForUpdates()
    expect(res.status).toBe("up_to_date")
  })

  it("handles the 'vX.Y.Z' vs 'X.Y.Z' prefix equivalently", async () => {
    fetchMock.mockReturnValueOnce(mockFetchResponse({ tag_name: "99.0.0" }))
    const res = await checkForUpdates()
    expect(res.status).toBe("update_available")
  })

  it("uses major > minor > patch precedence", async () => {
    fetchMock.mockReturnValueOnce(mockFetchResponse({ tag_name: "v0.1.0" }))
    // CURRENT_VERSION is 0.0.4 → 0.1.0 is newer (minor bump beats patch)
    const res = await checkForUpdates()
    expect(res.status).toBe("update_available")
  })

  it("returns 'error' when the response is not ok", async () => {
    fetchMock.mockReturnValueOnce(mockFetchResponse({}, false, 500))
    const res = await checkForUpdates()
    expect(res).toEqual({ status: "error", message: "GitHub API returned 500" })
  })

  it("returns 'error' when the response body has no tag_name", async () => {
    fetchMock.mockReturnValueOnce(mockFetchResponse({}))
    const res = await checkForUpdates()
    expect(res).toEqual({ status: "error", message: "No release tag found" })
  })

  it("returns 'error' with the thrown message on a network failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"))
    const res = await checkForUpdates()
    expect(res).toEqual({ status: "error", message: "offline" })
  })

  it("returns 'Network error' when the thrown value is not an Error", async () => {
    fetchMock.mockRejectedValueOnce("raw string rejection")
    const res = await checkForUpdates()
    expect(res).toEqual({ status: "error", message: "Network error" })
  })
})

describe("useUpdateChecker", () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("calls onUpdateAvailable when a newer version is returned and no prior check exists", async () => {
    fetchMock.mockReturnValue(
      mockFetchResponse({ tag_name: "v99.0.0", html_url: "ignored" }),
    )
    const cb = vi.fn()
    renderHook(() => useUpdateChecker({ onUpdateAvailable: cb }))

    await waitFor(() =>
      expect(cb).toHaveBeenCalledWith("v99.0.0", RELEASES_PAGE),
    )
    expect(localStorage.getItem("gemi_last_update_check")).not.toBeNull()
  })

  it("skips the network fetch when the last check was < 24h ago", async () => {
    localStorage.setItem("gemi_last_update_check", String(Date.now()))
    const cb = vi.fn()
    renderHook(() => useUpdateChecker({ onUpdateAvailable: cb }))

    // Yield to let the useEffect run
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(cb).not.toHaveBeenCalled()
  })

  it("does not notify when the user already dismissed the current remote version", async () => {
    fetchMock.mockReturnValue(mockFetchResponse({ tag_name: "v99.0.0" }))
    localStorage.setItem("gemi_dismissed_version", "v99.0.0")

    const cb = vi.fn()
    renderHook(() => useUpdateChecker({ onUpdateAvailable: cb }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    // Give the microtask a chance to run
    await new Promise((r) => setTimeout(r, 0))
    expect(cb).not.toHaveBeenCalled()
  })

  it("does not notify when the remote version is up to date", async () => {
    fetchMock.mockReturnValue(mockFetchResponse({ tag_name: CURRENT_VERSION }))
    const cb = vi.fn()
    renderHook(() => useUpdateChecker({ onUpdateAvailable: cb }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
    expect(cb).not.toHaveBeenCalled()
  })
})
