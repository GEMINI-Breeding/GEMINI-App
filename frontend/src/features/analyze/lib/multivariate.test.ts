import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { OpenAPI } from "@/client"

import {
  fetchAnova,
  fetchCorrelation,
  fetchGGE,
  fetchHeritability,
  fetchManova,
  fetchMatrix,
  fetchPCA,
  fetchSpatial,
} from "./multivariate"

const fetchMock = vi.fn()
const originalBase = OpenAPI.BASE

beforeEach(() => {
  localStorage.clear()
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  OpenAPI.BASE = ""
})

afterEach(() => {
  vi.unstubAllGlobals()
  OpenAPI.BASE = originalBase
})

function okJson(body: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response)
}

function errJson(status: number, body: unknown) {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response)
}

describe("multivariate API client", () => {
  it("POSTs JSON body and Bearer token to /correlation", async () => {
    localStorage.setItem("gemini.auth.token", "tok-abc")
    fetchMock.mockReturnValueOnce(
      okJson({
        status: "ok",
        n_rows: 10,
        pearson: null,
        spearman: null,
      }),
    )

    const result = await fetchCorrelation({
      trait_names: ["a", "b"],
      aggregation: "mean",
    })

    expect(result.status).toBe("ok")
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/multivariate_analysis/correlation")
    expect(init.method).toBe("POST")
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer tok-abc",
    })
    expect(JSON.parse(init.body)).toEqual({
      trait_names: ["a", "b"],
      aggregation: "mean",
    })
  })

  it("respects OpenAPI.BASE and strips its trailing slash", async () => {
    OpenAPI.BASE = "http://api.test/"
    fetchMock.mockReturnValueOnce(okJson({ status: "ok" }))
    await fetchMatrix({ trait_names: ["x"], aggregation: "mean" })
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://api.test/api/multivariate_analysis/matrix",
    )
  })

  it("each fetch wrapper hits its endpoint", async () => {
    const cases: Array<[() => Promise<unknown>, string]> = [
      [
        () => fetchMatrix({ trait_names: ["a"], aggregation: "mean" }),
        "/api/multivariate_analysis/matrix",
      ],
      [
        () =>
          fetchSpatial({ trait_names: ["a"], aggregation: "mean" }),
        "/api/multivariate_analysis/spatial",
      ],
      [
        () => fetchAnova({ trait_names: ["a"], aggregation: "mean" }),
        "/api/multivariate_analysis/anova",
      ],
      [
        () =>
          fetchHeritability({
            trait_names: ["a"],
            aggregation: "mean",
          }),
        "/api/multivariate_analysis/heritability",
      ],
      [
        () =>
          fetchPCA({
            trait_names: ["a", "b", "c"],
            aggregation: "mean",
          }),
        "/api/multivariate_analysis/pca",
      ],
      [
        () => fetchGGE({ trait_names: ["a"], aggregation: "mean" }),
        "/api/multivariate_analysis/gge",
      ],
      [
        () =>
          fetchManova({
            trait_names: ["a", "b"],
            aggregation: "mean",
          }),
        "/api/multivariate_analysis/manova",
      ],
    ]
    for (const [call, expectedPath] of cases) {
      fetchMock.mockReturnValueOnce(okJson({ status: "ok" }))
      await call()
      expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(expectedPath)
    }
  })

  it("throws with status and structured error description when response is not ok", async () => {
    fetchMock.mockReturnValueOnce(
      errJson(400, {
        error: "invalid_request",
        error_description: "PCA needs at least 3 trait_names.",
      }),
    )
    await expect(
      fetchPCA({ trait_names: ["only-one"], aggregation: "mean" }),
    ).rejects.toThrow(/400.*PCA needs at least 3 trait_names\./)
  })

  it("falls back to text body when error response has no JSON", async () => {
    fetchMock.mockReturnValueOnce(
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error("not json")),
        text: () => Promise.resolve("plain text 500"),
      } as unknown as Response),
    )
    await expect(
      fetchCorrelation({ trait_names: ["a", "b"], aggregation: "mean" }),
    ).rejects.toThrow(/plain text 500/)
  })

  it("forwards optional fields verbatim (filters + collapse_replicates)", async () => {
    fetchMock.mockReturnValueOnce(okJson({ status: "ok" }))
    await fetchAnova({
      trait_names: ["height"],
      experiment_names: ["E1"],
      season_names: ["2024"],
      site_names: ["Davis"],
      populations: ["pop1"],
      aggregation: "date",
      aggregation_date: "2024-05-01",
      collapse_replicates: false,
    })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({
      trait_names: ["height"],
      experiment_names: ["E1"],
      season_names: ["2024"],
      site_names: ["Davis"],
      populations: ["pop1"],
      aggregation: "date",
      aggregation_date: "2024-05-01",
      collapse_replicates: false,
    })
  })
})
