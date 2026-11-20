import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { type FileMetadata, FilesService } from "@/client"

import {
  type ScopeRoot,
  useAvailableScopeOptions,
} from "./useAvailableScopeOptions"

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const ROOT: ScopeRoot = {
  experiment: "GEMINI",
  location: "Davis",
  population: "Cowpea",
}

function fileObj(name: string): FileMetadata {
  return {
    bucket_name: "gemini",
    object_name: name,
    last_modified: "2026-04-28T00:00:00Z",
    etag: "x",
    size: 0,
  }
}

beforeEach(() => {
  localStorage.setItem("gemini.auth.token", "fake-token")
})
afterEach(() => {
  localStorage.removeItem("gemini.auth.token")
  vi.restoreAllMocks()
})

describe("useAvailableScopeOptions", () => {
  it("returns scopeIncomplete when any root field is missing", async () => {
    const spy = vi.spyOn(FilesService, "apiFilesListFilePathListFiles")
    const { result } = renderHook(
      () =>
        useAvailableScopeOptions(
          { experiment: "GEMINI", location: "", population: "" },
          null,
          null,
        ),
      { wrapper },
    )
    expect(result.current.scopeIncomplete).toBe(true)
    expect(result.current.dates).toEqual([])
    expect(result.current.platforms).toEqual([])
    expect(result.current.sensors).toEqual([])
    expect(spy).not.toHaveBeenCalled()
  })

  it("aggregates unique sorted dates from a Raw/ listing", async () => {
    vi.spyOn(FilesService, "apiFilesListFilePathListFiles").mockResolvedValue([
      fileObj("Raw/2026/GEMINI/Davis/Cowpea/2026-04-28/Drone/RGB/Images/a.jpg"),
      fileObj("Raw/2026/GEMINI/Davis/Cowpea/2026-04-28/Drone/RGB/Images/b.jpg"),
      fileObj("Raw/2026/GEMINI/Davis/Cowpea/2026-03-15/Drone/RGB/Images/c.jpg"),
      // Different population — must not appear.
      fileObj("Raw/2026/GEMINI/Davis/Other/2026-05-01/Drone/RGB/Images/d.jpg"),
      // Too few path components — must not appear.
      fileObj("Raw/foo.jpg"),
      // Different prefix — must not appear.
      fileObj("Processed/2026/GEMINI/Davis/Cowpea/2026-04-28/odm.tif"),
    ] as never)
    const { result } = renderHook(
      () => useAvailableScopeOptions(ROOT, null, null),
      { wrapper },
    )
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.dates).toEqual(["2026-03-15", "2026-04-28"])
    // No date picked → platforms / sensors stay empty.
    expect(result.current.platforms).toEqual([])
    expect(result.current.sensors).toEqual([])
    expect(result.current.empty).toBe(false)
    expect(result.current.scopeIncomplete).toBe(false)
  })

  it("yields platforms + yearForPickedDate when a date is picked", async () => {
    vi.spyOn(FilesService, "apiFilesListFilePathListFiles").mockResolvedValue([
      fileObj("Raw/2026/GEMINI/Davis/Cowpea/2026-04-28/Drone/RGB/Images/a.jpg"),
      fileObj("Raw/2026/GEMINI/Davis/Cowpea/2026-04-28/Amiga/RGB/Images/b.jpg"),
      // Different date — platforms should not include this row's "Phantom".
      fileObj(
        "Raw/2026/GEMINI/Davis/Cowpea/2026-03-15/Phantom/RGB/Images/c.jpg",
      ),
    ] as never)
    const { result } = renderHook(
      () => useAvailableScopeOptions(ROOT, "2026-04-28", null),
      { wrapper },
    )
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.platforms).toEqual(["Amiga", "Drone"])
    expect(result.current.yearForPickedDate).toBe("2026")
    expect(result.current.sensors).toEqual([])
  })

  it("yields sensors when both date and platform are picked", async () => {
    vi.spyOn(FilesService, "apiFilesListFilePathListFiles").mockResolvedValue([
      fileObj("Raw/2026/GEMINI/Davis/Cowpea/2026-04-28/Drone/RGB/Images/a.jpg"),
      fileObj(
        "Raw/2026/GEMINI/Davis/Cowpea/2026-04-28/Drone/Thermal/Images/b.jpg",
      ),
      // Different platform — sensors should not include this row's "FLIR".
      fileObj(
        "Raw/2026/GEMINI/Davis/Cowpea/2026-04-28/Amiga/FLIR/Images/c.jpg",
      ),
    ] as never)
    const { result } = renderHook(
      () => useAvailableScopeOptions(ROOT, "2026-04-28", "Drone"),
      { wrapper },
    )
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.sensors).toEqual(["RGB", "Thermal"])
    expect(result.current.platforms).toContain("Drone")
  })

  it("flags empty when the listing succeeds but no rows match the scope", async () => {
    vi.spyOn(FilesService, "apiFilesListFilePathListFiles").mockResolvedValue([
      fileObj("Raw/2026/OtherExp/SiteX/PopY/2026-04-28/Drone/RGB/Images/a.jpg"),
    ] as never)
    const { result } = renderHook(
      () => useAvailableScopeOptions(ROOT, null, null),
      { wrapper },
    )
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.empty).toBe(true)
    expect(result.current.dates).toEqual([])
  })

  it("returns empty results when the listing fails", async () => {
    vi.spyOn(FilesService, "apiFilesListFilePathListFiles").mockRejectedValue(
      new Error("network down"),
    )
    const { result } = renderHook(
      () => useAvailableScopeOptions(ROOT, null, null),
      { wrapper },
    )
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.dates).toEqual([])
    expect(result.current.empty).toBe(true)
  })
})
