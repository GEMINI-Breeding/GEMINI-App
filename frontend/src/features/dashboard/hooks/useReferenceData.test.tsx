import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  useMultiReferenceAggregates,
  useReferenceAggregate,
  useReferenceDatasets,
  useReferencePlots,
} from "./useReferenceData"

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

function okJson(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response)
}

function errJson(status: number, detail?: string) {
  return Promise.resolve({
    ok: false,
    status,
    statusText: `Status ${status}`,
    json: () =>
      detail != null ? Promise.resolve({ detail }) : Promise.resolve({}),
  } as unknown as Response)
}

describe("useReferenceDatasets", () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
    localStorage.clear()
  })
  afterEach(() => vi.unstubAllGlobals())

  it("fetches the datasets list", async () => {
    fetchMock.mockReturnValueOnce(okJson([{ id: "d1", name: "Test" }]))
    const { result } = renderHook(() => useReferenceDatasets(), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([{ id: "d1", name: "Test" }])
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/reference-data/")
  })

  it("passes the Authorization header from localStorage", async () => {
    localStorage.setItem("access_token", "tok-xyz")
    fetchMock.mockReturnValueOnce(okJson([]))
    const { result } = renderHook(() => useReferenceDatasets(), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      Authorization: "Bearer tok-xyz",
    })
  })

  it("surfaces the server-provided detail on error", async () => {
    // Hook's custom retry() retries non-404s up to 2×; return 404 so we fail fast.
    fetchMock.mockReturnValue(errJson(404, "boom"))
    const { result } = renderHook(() => useReferenceDatasets(), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as Error).message).toBe("boom")
  })

  it("falls back to 'HTTP <status>' when the error body has no detail", async () => {
    fetchMock.mockReturnValue(errJson(404))
    const { result } = renderHook(() => useReferenceDatasets(), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as Error).message).toBe("HTTP 404")
  })
})

describe("useReferencePlots", () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
    localStorage.clear()
  })
  afterEach(() => vi.unstubAllGlobals())

  it("is disabled when datasetId is null (no fetch)", async () => {
    const { result } = renderHook(() => useReferencePlots(null), {
      wrapper: makeWrapper(),
    })
    // Give it a tick
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.fetchStatus).toBe("idle")
  })

  it("unwraps the {data, count} response into the plot array", async () => {
    fetchMock.mockReturnValueOnce(
      okJson({ data: [{ id: "p1", plot_id: "A1" }], count: 1 }),
    )
    const { result } = renderHook(() => useReferencePlots("ds1"), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([{ id: "p1", plot_id: "A1" }])
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/reference-data/ds1/plots-all")
  })
})

describe("useReferenceAggregate", () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
    localStorage.clear()
  })
  afterEach(() => vi.unstubAllGlobals())

  it("is disabled when datasetId or metric is null", async () => {
    const { result: a } = renderHook(() => useReferenceAggregate(null, "h"), {
      wrapper: makeWrapper(),
    })
    const { result: b } = renderHook(() => useReferenceAggregate("ds1", null), {
      wrapper: makeWrapper(),
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(a.current.fetchStatus).toBe("idle")
    expect(b.current.fetchStatus).toBe("idle")
  })

  it("URL-encodes the metric and forwards the aggregation param", async () => {
    fetchMock.mockReturnValueOnce(
      okJson({ dataset_id: "ds1", metric: "plant height", aggregation: "max", value: 2, count: 10 }),
    )
    renderHook(() => useReferenceAggregate("ds1", "plant height", "max"), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/v1/reference-data/ds1/aggregate?metric=plant%20height&aggregation=max",
    )
  })
})

describe("useMultiReferenceAggregates", () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
    localStorage.clear()
  })
  afterEach(() => vi.unstubAllGlobals())

  it("fires one request per request entry, in order", async () => {
    fetchMock.mockReturnValue(okJson({ value: 1, count: 1 }))
    renderHook(
      () =>
        useMultiReferenceAggregates([
          { datasetId: "d1", metric: "y", aggregation: "avg" },
          { datasetId: "d2", metric: "x", aggregation: "min" },
        ]),
      { wrapper: makeWrapper() },
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const urls = fetchMock.mock.calls.map((c) => c[0])
    expect(urls[0]).toContain("d1/aggregate?metric=y&aggregation=avg")
    expect(urls[1]).toContain("d2/aggregate?metric=x&aggregation=min")
  })

  it("returns an empty array when no requests are provided", () => {
    const { result } = renderHook(() => useMultiReferenceAggregates([]), {
      wrapper: makeWrapper(),
    })
    expect(result.current).toEqual([])
  })
})
