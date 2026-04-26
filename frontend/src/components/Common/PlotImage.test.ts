import { afterEach, describe, expect, it } from "vitest"

import { authHeaders, objectImageUrl, plotImageUrl } from "./PlotImage"

afterEach(() => {
  localStorage.removeItem("gemini.auth.token")
  localStorage.removeItem("access_token")
  // window-level overrides are wiped per-test where used
  delete (window as unknown as { __GEMI_BACKEND_URL__?: string }).__GEMI_BACKEND_URL__
})

describe("objectImageUrl", () => {
  it("encodes path segments without escaping the slashes", () => {
    expect(objectImageUrl("gemini/Processed/A B/plot 1.png")).toBe(
      "/api/files/download/gemini/Processed/A%20B/plot%201.png",
    )
  })
  it("prefixes window.__GEMI_BACKEND_URL__ when set (for Tauri builds)", () => {
    ;(window as unknown as { __GEMI_BACKEND_URL__: string }).__GEMI_BACKEND_URL__ =
      "http://example:7777"
    expect(objectImageUrl("gemini/x/y.png")).toBe(
      "http://example:7777/api/files/download/gemini/x/y.png",
    )
  })
})

describe("plotImageUrl (legacy)", () => {
  it("returns empty string until Phase 10 rewrites callsites onto objectPath", () => {
    // Stub for the Analyze code path; intentionally non-functional so the
    // request fails predictably (rather than 404'ing against a missing route).
    expect(plotImageUrl("rid", "pid")).toBe("")
  })
})

describe("authHeaders", () => {
  it("returns {} when no token is stored", () => {
    expect(authHeaders()).toEqual({})
  })
  it("prefers gemini.auth.token over the legacy access_token key", () => {
    localStorage.setItem("access_token", "old")
    localStorage.setItem("gemini.auth.token", "new")
    expect(authHeaders()).toEqual({ Authorization: "Bearer new" })
  })
  it("falls back to access_token when gemini.auth.token is unset", () => {
    localStorage.setItem("access_token", "old")
    expect(authHeaders()).toEqual({ Authorization: "Bearer old" })
  })
})
