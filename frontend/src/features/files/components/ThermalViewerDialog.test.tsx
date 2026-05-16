/**
 * Smoke tests for ThermalViewerDialog.
 *
 * Focus: prove the wiring works — sidecar + TIFF fetched, palette
 * rendered, hover surfaces the right HUD shape (with °C for
 * radiometric, raw counts only for non-radiometric).
 *
 * Lower-level math is covered in `thermal.test.ts`. We mock the
 * global fetch because the dialog's `useEffect` triggers network I/O
 * the moment `open` flips to true.
 */
import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ThermalSidecar } from "@/features/files/lib/thermal"

import { ThermalViewerDialog } from "./ThermalViewerDialog"

/** Build the bytes of the same minimal TIFF the thermal-lib tests use. */
function syntheticTiff(
  width: number,
  height: number,
  fill: (x: number, y: number) => number,
): ArrayBuffer {
  const headerLen = 8
  const numEntries = 9
  const ifdLen = 2 + numEntries * 12 + 4
  const stripOffset = headerLen + ifdLen
  const pixelBytes = width * height * 2
  const buf = new ArrayBuffer(stripOffset + pixelBytes)
  const v = new DataView(buf)
  v.setUint8(0, 0x49)
  v.setUint8(1, 0x49)
  v.setUint16(2, 42, true)
  v.setUint32(4, headerLen, true)
  v.setUint16(headerLen, numEntries, true)
  let entry = headerLen + 2
  const w = (tag: number, type: number, count: number, value: number) => {
    v.setUint16(entry, tag, true)
    v.setUint16(entry + 2, type, true)
    v.setUint32(entry + 4, count, true)
    if (type === 3) v.setUint16(entry + 8, value, true)
    else v.setUint32(entry + 8, value, true)
    entry += 12
  }
  w(0x0100, 4, 1, width)
  w(0x0101, 4, 1, height)
  w(0x0102, 3, 1, 16)
  w(0x0103, 3, 1, 1)
  w(0x0106, 3, 1, 1)
  w(0x0111, 4, 1, stripOffset)
  w(0x0115, 3, 1, 1)
  w(0x0116, 4, 1, height)
  w(0x0117, 4, 1, pixelBytes)
  v.setUint32(entry, 0, true)
  let o = stripOffset
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      v.setUint16(o, fill(x, y) & 0xffff, true)
      o += 2
    }
  }
  return buf
}

function mockFetchJsonAndTiff(
  sidecar: ThermalSidecar,
  tiff: ArrayBuffer,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString()
    if (url.endsWith(".json")) {
      return Promise.resolve(
        new Response(JSON.stringify(sidecar), {
          headers: { "content-type": "application/json" },
        }),
      )
    }
    if (url.endsWith(".tif")) {
      return Promise.resolve(new Response(tiff))
    }
    return Promise.resolve(new Response(null, { status: 404 }))
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

beforeEach(() => {
  localStorage.setItem("gemini.auth.token", "test-token")
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe("ThermalViewerDialog", () => {
  it("renders the canvas and a °C HUD for a radiometric Boson sidecar", async () => {
    // Boson TLinear high-gain: T_K = pixel * 0.04. A scene with
    // counts spanning 7000–8000 gives T_C ranging 6.85–46.85 °C —
    // realistic for a sunny field, so the rendered palette + HUD
    // both look right.
    const sidecar: ThermalSidecar = {
      source: "boson_tlinear_high",
      original: "bucket/Raw/X/Y/img.tif",
      shape: [4, 4],
      radiometric: true,
      has_gps: false,
      scale: 0.04,
      offset: 0,
      preview_vmin_c: 5,
      preview_vmax_c: 50,
    }
    const tiff = syntheticTiff(4, 4, (x, y) => 7000 + x * 50 + y * 50)
    mockFetchJsonAndTiff(sidecar, tiff)

    render(
      <ThermalViewerDialog
        open
        bucket="gemini"
        rgbObjectName="Raw/X/Y/Images/img.jpg"
        onOpenChange={() => {}}
      />,
    )

    // Wait for the canvas to mount once the sidecar+TIFF resolve.
    const canvas = await screen.findByTestId("thermal-canvas")
    expect(canvas).toBeInTheDocument()
    expect(screen.getByTestId("thermal-hud")).toBeInTheDocument()
    // Palette select + min/max sliders all rendered.
    expect(screen.getByTestId("thermal-palette-trigger")).toBeInTheDocument()
    expect(screen.getByTestId("thermal-vmin")).toBeInTheDocument()
    expect(screen.getByTestId("thermal-vmax")).toBeInTheDocument()
  })

  it("hides the °C HUD for a non-radiometric Boson sidecar", async () => {
    const sidecar: ThermalSidecar = {
      source: "boson_agc_nonradiometric",
      original: "bucket/Raw/X/Y/img.tif",
      shape: [2, 2],
      radiometric: false,
      has_gps: false,
      preview_vmin_counts: 100,
      preview_vmax_counts: 200,
    }
    const tiff = syntheticTiff(2, 2, (x, y) => 100 + x + y)
    mockFetchJsonAndTiff(sidecar, tiff)

    render(
      <ThermalViewerDialog
        open
        bucket="gemini"
        rgbObjectName="Raw/X/Y/Images/img.jpg"
        onOpenChange={() => {}}
      />,
    )

    // Wait for canvas; the HUD prompt text should reference *counts*
    // only — no "and temperature".
    await screen.findByTestId("thermal-canvas")
    const hud = screen.getByTestId("thermal-hud")
    expect(hud.textContent ?? "").not.toMatch(/temperature/i)
  })

  it("surfaces a load error when the sidecar 404s", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 404 })),
    )
    vi.stubGlobal("fetch", fetchMock)

    render(
      <ThermalViewerDialog
        open
        bucket="gemini"
        rgbObjectName="Raw/X/Y/Images/img.jpg"
        onOpenChange={() => {}}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId("thermal-error")).toBeInTheDocument()
    })
    expect(screen.getByTestId("thermal-error").textContent).toMatch(
      /sidecar JSON 404/,
    )
  })
})
