import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { analyzeApi, versionLabel } from "./api"

describe("versionLabel", () => {
  it("returns an em-dash when version is null", () => {
    expect(versionLabel(null, null)).toBe("—")
    expect(versionLabel(null, "anything")).toBe("—")
  })

  it("formats an unnamed version as 'v<n>'", () => {
    expect(versionLabel(1, null)).toBe("v1")
    expect(versionLabel(7, undefined)).toBe("v7")
    expect(versionLabel(42, "")).toBe("v42") // empty name is falsy
  })

  it("formats a named version as 'v<n> — <name>'", () => {
    expect(versionLabel(3, "High-res")).toBe("v3 — High-res")
  })
})

describe("analyzeApi", () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
    ;(window as unknown as { __GEMI_BACKEND_URL__?: string }).__GEMI_BACKEND_URL__ = ""
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function ok(body: unknown) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(body),
    } as Response)
  }

  it("hits the runs endpoint with an Authorization header from localStorage", async () => {
    localStorage.setItem("access_token", "tok-abc")
    fetchMock.mockReturnValueOnce(ok([{ run_id: "r1" }]))

    const out = await analyzeApi.listRuns()
    expect(out).toEqual([{ run_id: "r1" }])

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/v1/analyze/runs")
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer tok-abc",
    })
  })

  it("sends an empty Bearer token when no access_token is stored", async () => {
    fetchMock.mockReturnValueOnce(ok([]))
    await analyzeApi.listRuns()
    const [, init] = fetchMock.mock.calls[0]
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer " })
  })

  it("prefixes the path with __GEMI_BACKEND_URL__ when set", async () => {
    ;(window as unknown as { __GEMI_BACKEND_URL__?: string }).__GEMI_BACKEND_URL__ =
      "http://backend.test"
    fetchMock.mockReturnValueOnce(ok([]))

    await analyzeApi.listRuns()
    expect(fetchMock.mock.calls[0][0]).toBe("http://backend.test/api/v1/analyze/runs")
  })

  it("builds the right URLs for each endpoint", async () => {
    fetchMock.mockReturnValue(ok({}))

    await analyzeApi.getTraits("r1")
    await analyzeApi.getOrthoInfo("r1")
    await analyzeApi.listTraitRecords()
    await analyzeApi.listTraitRecordsByRun("r1")
    await analyzeApi.getTraitRecordGeojson("tr1")
    await analyzeApi.getTraitRecordOrthoInfo("tr1")
    await analyzeApi.getTraitRecordImagePlotIds("tr1")

    const urls = fetchMock.mock.calls.map((c) => c[0])
    expect(urls).toEqual([
      "/api/v1/analyze/runs/r1/traits",
      "/api/v1/analyze/runs/r1/ortho-info",
      "/api/v1/analyze/trait-records",
      "/api/v1/analyze/trait-records?run_id=r1",
      "/api/v1/analyze/trait-records/tr1/geojson",
      "/api/v1/analyze/trait-records/tr1/ortho-info",
      "/api/v1/analyze/trait-records/tr1/image-plot-ids",
    ])
  })

  it("throws with the server-provided detail when the response is not ok", async () => {
    fetchMock.mockReturnValueOnce(
      Promise.resolve({
        ok: false,
        status: 500,
        statusText: "Server Error",
        json: () => Promise.resolve({ detail: "trait extraction failed" }),
      } as unknown as Response),
    )

    await expect(analyzeApi.listRuns()).rejects.toThrow("trait extraction failed")
  })

  it("falls back to 'HTTP <status>' when the error body has no detail field", async () => {
    fetchMock.mockReturnValueOnce(
      Promise.resolve({
        ok: false,
        status: 418,
        statusText: "I'm a teapot",
        json: () => Promise.resolve({}),
      } as unknown as Response),
    )

    await expect(analyzeApi.listRuns()).rejects.toThrow("HTTP 418")
  })

  it("falls back to statusText when the error body isn't parseable JSON", async () => {
    fetchMock.mockReturnValueOnce(
      Promise.resolve({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        json: () => Promise.reject(new SyntaxError("not json")),
      } as unknown as Response),
    )

    await expect(analyzeApi.listRuns()).rejects.toThrow("Service Unavailable")
  })
})
