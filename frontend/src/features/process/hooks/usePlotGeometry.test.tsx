import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { PlotGeometryService } from "@/client"

import {
  useActivatePlotGeometryVersion,
  useGpsShiftStatus,
  useLoadPlotGeometryVersion,
  usePlotGeometryVersions,
  useSavePlotGeometryVersion,
  useShiftGps,
  useUndoGpsShift,
} from "./usePlotGeometry"

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  localStorage.setItem("gemini.auth.token", "fake-token")
})
afterEach(() => {
  localStorage.removeItem("gemini.auth.token")
  vi.restoreAllMocks()
})

describe("usePlotGeometryVersions", () => {
  it("returns [] when directory is empty", async () => {
    const spy = vi.spyOn(PlotGeometryService, "apiPlotGeometryVersionsListListVersions")
    const { result } = renderHook(() => usePlotGeometryVersions(""), { wrapper })
    await waitFor(() => expect(result.current.isFetched).toBe(true), {
      timeout: 1500,
    }).catch(() => {
      // The hook is disabled when directory is empty; isFetched stays false.
    })
    expect(spy).not.toHaveBeenCalled()
    expect(result.current.data ?? []).toEqual([])
  })
  it("forwards the directory to the SDK", async () => {
    const spy = vi
      .spyOn(PlotGeometryService, "apiPlotGeometryVersionsListListVersions")
      .mockResolvedValue([{ version: 1, name: "v1", is_active: true, created_at: "2026-04-26T00:00:00Z" }] as never)
    const { result } = renderHook(() => usePlotGeometryVersions("Processed/abc/"), {
      wrapper,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(spy).toHaveBeenCalledWith({ requestBody: { directory: "Processed/abc/" } })
    expect(result.current.data?.[0].version).toBe(1)
  })
})

describe("useLoadPlotGeometryVersion", () => {
  it("calls the load SDK with directory + version", async () => {
    const spy = vi
      .spyOn(PlotGeometryService, "apiPlotGeometryVersionsLoadLoadVersion")
      .mockResolvedValue({
        version: 2,
        is_active: true,
        state_snapshot: { boundaries: { type: "FeatureCollection", features: [] } },
      } as never)
    const { result } = renderHook(() => useLoadPlotGeometryVersion("dir/", 2), {
      wrapper,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(spy).toHaveBeenCalledWith({ requestBody: { directory: "dir/", version: 2 } })
  })
})

describe("useSavePlotGeometryVersion", () => {
  it("forwards the snapshot to the SDK", async () => {
    const spy = vi
      .spyOn(PlotGeometryService, "apiPlotGeometryVersionsSaveSaveVersion")
      .mockResolvedValue({ version: 3, name: "v3", is_active: false } as never)
    const { result } = renderHook(() => useSavePlotGeometryVersion(), { wrapper })
    await result.current.mutateAsync({
      directory: "Processed/x/",
      stateSnapshot: { boundaries: { type: "FeatureCollection", features: [] } },
      name: "v3",
    })
    expect(spy).toHaveBeenCalledWith({
      requestBody: {
        directory: "Processed/x/",
        state_snapshot: { boundaries: { type: "FeatureCollection", features: [] } },
        name: "v3",
      },
    })
  })
})

describe("useActivatePlotGeometryVersion", () => {
  it("targets directory + version", async () => {
    const spy = vi
      .spyOn(PlotGeometryService, "apiPlotGeometryVersionsActivateActivateVersion")
      .mockResolvedValue({} as never)
    const { result } = renderHook(() => useActivatePlotGeometryVersion(), { wrapper })
    await result.current.mutateAsync({ directory: "d/", version: 4 })
    expect(spy).toHaveBeenCalledWith({ requestBody: { directory: "d/", version: 4 } })
  })
})

describe("GPS shift hooks", () => {
  it("useGpsShiftStatus reads status by directory", async () => {
    const spy = vi
      .spyOn(PlotGeometryService, "apiPlotGeometryGpsShiftStatusCheckGpsShiftStatus")
      .mockResolvedValue({ shifted: true, current_lat: 1, current_lon: 2 } as never)
    const { result } = renderHook(() => useGpsShiftStatus("d/"), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(spy).toHaveBeenCalledWith({ requestBody: { directory: "d/" } })
    expect(result.current.data?.shifted).toBe(true)
  })
  it("useShiftGps forwards lat/lon as snake_case", async () => {
    const spy = vi
      .spyOn(PlotGeometryService, "apiPlotGeometryShiftGpsShiftGps")
      .mockResolvedValue({} as never)
    const { result } = renderHook(() => useShiftGps(), { wrapper })
    await result.current.mutateAsync({ directory: "d/", currentLat: 38.5, currentLon: -121.7 })
    expect(spy).toHaveBeenCalledWith({
      requestBody: { directory: "d/", current_lat: 38.5, current_lon: -121.7 },
    })
  })
  it("useUndoGpsShift posts the directory", async () => {
    const spy = vi
      .spyOn(PlotGeometryService, "apiPlotGeometryUndoGpsShiftUndoGpsShift")
      .mockResolvedValue({} as never)
    const { result } = renderHook(() => useUndoGpsShift(), { wrapper })
    await result.current.mutateAsync({ directory: "d/" })
    expect(spy).toHaveBeenCalledWith({ requestBody: { directory: "d/" } })
  })
})
