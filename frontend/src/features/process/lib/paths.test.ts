import { describe, expect, it } from "vitest"

import {
  isAerialScopeComplete,
  orthomosaicPath,
  plotBoundariesPath,
  plotImagesPrefix,
  processedPrefix,
  rawImagesPrefix,
  rawScopePrefix,
  yearFromDate,
} from "./paths"

describe("yearFromDate", () => {
  it("extracts the year from a YYYY-MM-DD string", () => {
    expect(yearFromDate("2026-04-26")).toBe("2026")
  })
  it("returns empty for empty/null input", () => {
    expect(yearFromDate(null)).toBe("")
    expect(yearFromDate(undefined)).toBe("")
    expect(yearFromDate("")).toBe("")
  })
})

const SCOPE = {
  year: "2026",
  experiment: "ExpA",
  location: "FieldX",
  population: "P1",
  date: "2026-04-26",
  platform: "Drone",
  sensor: "RGB",
}

describe("processedPrefix", () => {
  it("matches the worker's _build_output_prefix shape", () => {
    expect(processedPrefix(SCOPE)).toBe(
      "Processed/2026/ExpA/FieldX/P1/2026-04-26/Drone/RGB/",
    )
  })
})

describe("rawScopePrefix", () => {
  it("returns Raw/.../{sensor}/ — sibling of every dataset subdir", () => {
    expect(rawScopePrefix(SCOPE)).toBe(
      "Raw/2026/ExpA/FieldX/P1/2026-04-26/Drone/RGB/",
    )
  })
})

describe("rawImagesPrefix", () => {
  it("inserts the dataset short-id between sensor and Images", () => {
    expect(rawImagesPrefix(SCOPE, "a2f31b04")).toBe(
      "Raw/2026/ExpA/FieldX/P1/2026-04-26/Drone/RGB/a2f31b04/Images/",
    )
  })

  it("throws when datasetShortId is empty (scope alone is ambiguous)", () => {
    expect(() => rawImagesPrefix(SCOPE, "")).toThrow(
      /datasetShortId is required/,
    )
  })
})

describe("plotImagesPrefix", () => {
  it("appends PlotImages/ to the processed prefix", () => {
    expect(plotImagesPrefix(SCOPE)).toBe(
      "Processed/2026/ExpA/FieldX/P1/2026-04-26/Drone/RGB/PlotImages/",
    )
  })
})

describe("orthomosaicPath", () => {
  it("appends odm_orthophoto.tif to the processed prefix", () => {
    expect(orthomosaicPath(SCOPE)).toBe(
      "Processed/2026/ExpA/FieldX/P1/2026-04-26/Drone/RGB/odm_orthophoto.tif",
    )
  })
})

describe("plotBoundariesPath", () => {
  it("groups versioned boundary GeoJSONs under the processed prefix", () => {
    expect(plotBoundariesPath(SCOPE, 1)).toBe(
      "Processed/2026/ExpA/FieldX/P1/2026-04-26/Drone/RGB/plot-boundaries/v1.geojson",
    )
    expect(plotBoundariesPath(SCOPE, 7)).toBe(
      "Processed/2026/ExpA/FieldX/P1/2026-04-26/Drone/RGB/plot-boundaries/v7.geojson",
    )
  })
})

describe("isAerialScopeComplete", () => {
  it("requires every component", () => {
    expect(isAerialScopeComplete(SCOPE)).toBe(true)
    expect(isAerialScopeComplete({ ...SCOPE, date: "" })).toBe(false)
    expect(isAerialScopeComplete({ ...SCOPE, platform: "" })).toBe(false)
    expect(isAerialScopeComplete({})).toBe(false)
  })
})
