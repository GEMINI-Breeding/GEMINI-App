/**
 * Pins the `gpsLoading` / `gpsError` invariant. Existed because a 500
 * from `/image-gps` (e.g. when `experiment_files.metadata_json` is
 * missing) used to leave `gpsLoading=true` indefinitely — the consumer
 * UIs had no `isError` branch and rendered a permanent spinner instead
 * of an error.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { FilesService } from "@/client"
import type { AerialScope } from "@/features/process/lib/paths"

import { useImageGps } from "./useImageGps"

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const SCOPE: AerialScope = {
  year: "2026",
  experiment: "Cowpea MAGIC",
  location: "Davis",
  population: "Cowpea",
  date: "2026-05-05",
  platform: "Drone",
  sensor: "RGB",
}

beforeEach(() => {
  localStorage.setItem("gemini.auth.token", "fake-token")
})
afterEach(() => {
  localStorage.removeItem("gemini.auth.token")
  vi.restoreAllMocks()
})

describe("useImageGps", () => {
  it("clears gpsLoading and surfaces gpsError when the bulk-GPS query fails", async () => {
    vi.spyOn(FilesService, "apiFilesListFilePathListFiles").mockResolvedValue([
      {
        bucket_name: "gemini",
        object_name: `Raw/2026/Cowpea MAGIC/Davis/Cowpea/2026-05-05/Drone/RGB/Images/a.JPG`,
        size: 1,
        last_modified: "2026-05-05T00:00:00Z",
        content_type: "image/jpeg",
        etag: "x",
      },
    ] as never)
    vi.spyOn(
      FilesService,
      "apiFilesImageGpsFilePathListImageGps",
    ).mockRejectedValue(new Error("500: column metadata_json does not exist"))

    const { result } = renderHook(() => useImageGps(SCOPE), { wrapper })

    await waitFor(() => expect(result.current.gpsError).not.toBeNull(), {
      timeout: 1500,
    })
    expect(result.current.gpsLoading).toBe(false)
    expect(result.current.gpsError?.message).toContain("metadata_json")
  })

  it("transitions gpsLoading true → false on a successful bulk fetch", async () => {
    vi.spyOn(FilesService, "apiFilesListFilePathListFiles").mockResolvedValue([
      {
        bucket_name: "gemini",
        object_name: `Raw/2026/Cowpea MAGIC/Davis/Cowpea/2026-05-05/Drone/RGB/Images/a.JPG`,
        size: 1,
        last_modified: "2026-05-05T00:00:00Z",
        content_type: "image/jpeg",
        etag: "x",
      },
    ] as never)
    vi.spyOn(
      FilesService,
      "apiFilesImageGpsFilePathListImageGps",
    ).mockResolvedValue({
      images: [{ name: "a.JPG", lat: 38.5, lon: -121.7, alt: 18 }],
    } as never)

    const { result } = renderHook(() => useImageGps(SCOPE), { wrapper })

    await waitFor(() => expect(result.current.gpsLoading).toBe(false), {
      timeout: 1500,
    })
    expect(result.current.gpsError).toBeNull()
    expect(result.current.gpsMap["a.JPG"]).toEqual({
      lat: 38.5,
      lon: -121.7,
      alt: 18,
    })
    expect(result.current.imageBbox).not.toBeNull()
    expect(result.current.gpsReadyCount).toBe(1)
  })
})
