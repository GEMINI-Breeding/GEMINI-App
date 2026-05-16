/**
 * Unit tests for the thermal GPS preflight.
 *
 * Pins the discriminated-union contract so callers can branch on
 * `kind` without inspecting HTTP error details — and locks the URL
 * the helper builds so a refactor to `rawImagesPrefix` doesn't
 * silently break the sibling-of-Images assumption.
 */
import { describe, expect, it, vi } from "vitest"

import type { AerialScope } from "@/features/process/lib/paths"

import {
  checkThermalGpsPreflight,
  isThermalGpsRequiredError,
  ThermalGpsRequiredError,
} from "./thermalGpsPreflight"

vi.mock("@/client", () => ({
  OpenAPI: { BASE: "" },
}))

const SCOPE: AerialScope = {
  year: "2026",
  experiment: "GEMINI",
  location: "Davis",
  population: "Cowpea",
  date: "2026-04-29",
  platform: "Amiga",
  sensor: "FLIR-Boson",
}
const SHORT_ID = "a2f31b04"

describe("checkThermalGpsPreflight", () => {
  it("returns ok when the sidecar is missing (non-thermal dataset)", async () => {
    const fetchMock: typeof fetch = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 404 })),
    )
    const result = await checkThermalGpsPreflight(SCOPE, SHORT_ID, fetchMock)
    expect(result.kind).toBe("ok")
    expect(result).toEqual({ kind: "ok", thermal: false, hasGps: false })
    // URL must hit the sibling-of-Images RawThermal path inside the
    // per-dataset subdir; locked so future tweaks to rawImagesPrefix
    // don't drift the contract.
    const calledUrl = (fetchMock as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0][0]
    expect(String(calledUrl)).toContain(
      "Raw/2026/GEMINI/Davis/Cowpea/2026-04-29/Amiga/FLIR-Boson/a2f31b04/RawThermal/thermal_dataset.json",
    )
  })

  it("returns missing_gps when sidecar says has_gps=false", async () => {
    const summary = {
      mode: "boson_tlinear_high",
      has_gps: false,
      total_files: 12,
      radiometric: true,
    }
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(summary), {
          headers: { "content-type": "application/json" },
        }),
      ),
    )
    const result = await checkThermalGpsPreflight(SCOPE, SHORT_ID, fetchMock)
    expect(result).toEqual({
      kind: "missing_gps",
      mode: "boson_tlinear_high",
      totalFiles: 12,
    })
  })

  it("returns ok when sidecar says has_gps=true", async () => {
    const summary = {
      mode: "flir_one_pro",
      has_gps: true,
      total_files: 22,
      radiometric: true,
    }
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(summary), {
          headers: { "content-type": "application/json" },
        }),
      ),
    )
    const result = await checkThermalGpsPreflight(SCOPE, SHORT_ID, fetchMock)
    expect(result).toEqual({ kind: "ok", thermal: true, hasGps: true })
  })

  it("returns sidecar_unreadable on HTTP 500 (don't block ODM for transport blips)", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 500 })),
    )
    const result = await checkThermalGpsPreflight(SCOPE, SHORT_ID, fetchMock)
    expect(result.kind).toBe("sidecar_unreadable")
  })

  it("returns sidecar_unreadable when fetch rejects", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error("offline")))
    const result = await checkThermalGpsPreflight(SCOPE, SHORT_ID, fetchMock)
    expect(result.kind).toBe("sidecar_unreadable")
  })

  it("returns sidecar_unreadable on malformed JSON", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response("not json")),
    )
    const result = await checkThermalGpsPreflight(SCOPE, SHORT_ID, fetchMock)
    expect(result.kind).toBe("sidecar_unreadable")
  })
})

describe("ThermalGpsRequiredError", () => {
  it("is recognized by isThermalGpsRequiredError", () => {
    const err = new ThermalGpsRequiredError("boson_tlinear_high", 12)
    expect(isThermalGpsRequiredError(err)).toBe(true)
  })

  it("rejects plain errors", () => {
    expect(isThermalGpsRequiredError(new Error("ordinary"))).toBe(false)
    expect(isThermalGpsRequiredError({ kind: "something_else" })).toBe(false)
    expect(isThermalGpsRequiredError(null)).toBe(false)
  })

  it("carries mode + totalFiles for the modal dialog", () => {
    const err = new ThermalGpsRequiredError("user_defined", 7)
    expect(err.mode).toBe("user_defined")
    expect(err.totalFiles).toBe(7)
    expect(err.message).toMatch(/no per-image GPS/i)
  })
})
