import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OpenAPI } from "@/client"
import { fetchTraitRecords, parseNdjson } from "./traitRecords"

describe("parseNdjson", () => {
  it("returns [] for empty input", () => {
    expect(parseNdjson("")).toEqual([])
  })

  it("parses three records separated by newlines", () => {
    const raw = [
      '{"trait_id":1,"trait_name":"height","trait_value":1.2,"timestamp":"2026-01-01"}',
      '{"trait_id":1,"trait_name":"height","trait_value":1.5,"timestamp":"2026-01-02"}',
      '{"trait_id":1,"trait_name":"height","trait_value":1.7,"timestamp":"2026-01-03"}',
    ].join("\n")
    const result = parseNdjson(raw)
    expect(result).toHaveLength(3)
    expect(result[0].trait_value).toBe(1.2)
    expect(result[2].trait_value).toBe(1.7)
  })

  it("skips empty lines and trailing newline", () => {
    const raw =
      '{"trait_id":1,"trait_name":"a","trait_value":1,"timestamp":"t"}\n\n' +
      '{"trait_id":1,"trait_name":"a","trait_value":2,"timestamp":"t"}\n'
    const result = parseNdjson(raw)
    expect(result).toHaveLength(2)
  })

  it("propagates JSON.parse errors on malformed input", () => {
    expect(() => parseNdjson("{not json}")).toThrow()
  })
})

describe("fetchTraitRecords", () => {
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

  function okText(body: string) {
    return Promise.resolve({
      ok: true,
      text: () => Promise.resolve(body),
    } as unknown as Response)
  }

  it("hits the records endpoint with the bearer token and parses NDJSON", async () => {
    localStorage.setItem("gemini.auth.token", "tok-xyz")
    fetchMock.mockReturnValueOnce(
      okText(
        '{"trait_id":1,"trait_name":"height","trait_value":1.0,"timestamp":"t"}\n' +
          '{"trait_id":1,"trait_name":"height","trait_value":2.0,"timestamp":"t"}',
      ),
    )

    const out = await fetchTraitRecords("trait-7")
    expect(out).toHaveLength(2)
    expect(out[0].trait_value).toBe(1)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/traits/id/trait-7/records")
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer tok-xyz",
    })
  })

  it("appends filter params when provided and percent-encodes the trait id", async () => {
    fetchMock.mockReturnValueOnce(okText(""))

    await fetchTraitRecords("trait id/slash", {
      experimentName: "Exp 1",
      seasonName: "2024 Fall",
      siteName: "Davis",
      collectionDate: "2024-10-01",
    })

    const url = fetchMock.mock.calls[0][0] as string
    expect(url.startsWith("/api/traits/id/trait%20id%2Fslash/records?")).toBe(
      true,
    )
    expect(url).toContain("experiment_name=Exp+1")
    expect(url).toContain("season_name=2024+Fall")
    expect(url).toContain("site_name=Davis")
    expect(url).toContain("collection_date=2024-10-01")
  })

  it("omits the query string when no filter options are set", async () => {
    fetchMock.mockReturnValueOnce(okText(""))
    await fetchTraitRecords("trait-1", {})
    expect(fetchMock.mock.calls[0][0]).toBe("/api/traits/id/trait-1/records")
  })

  it("ignores empty / null filter values", async () => {
    fetchMock.mockReturnValueOnce(okText(""))
    await fetchTraitRecords("t1", {
      experimentName: "",
      seasonName: null,
      siteName: undefined,
      collectionDate: "",
    })
    expect(fetchMock.mock.calls[0][0]).toBe("/api/traits/id/t1/records")
  })

  it("prefixes the URL with OpenAPI.BASE (and strips a trailing slash)", async () => {
    OpenAPI.BASE = "http://api.test/"
    fetchMock.mockReturnValueOnce(okText(""))
    await fetchTraitRecords("t1")
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://api.test/api/traits/id/t1/records",
    )
  })

  it("throws with the status code when the response is not ok", async () => {
    fetchMock.mockReturnValueOnce(
      Promise.resolve({
        ok: false,
        status: 503,
        text: () => Promise.resolve(""),
      } as unknown as Response),
    )
    await expect(fetchTraitRecords("t1")).rejects.toThrow(
      "Failed to fetch trait records (503)",
    )
  })
})
