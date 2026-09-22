import { describe, expect, it } from "vitest"
import type { FileMetadata } from "@/client"
import type { OrthoVersion } from "./orthoVersions"
import { demForOrtho, demOptions, thermalOptions } from "./traitInputs"

const f = (object_name: string) => ({ object_name }) as FileMetadata
const P = "Processed/2024/E/Davis/Cowpea/2024-06-01/DJI/RGB/"
const R = "Raw/2024/E/Davis/Cowpea/2024-06-01"

const odm = (id: string): OrthoVersion => ({
  version: 1,
  filename: `odm_orthophoto-${id}.tif`,
  path: `gemini/${P}odm_orthophoto-${id}.tif`,
  label: null,
  source: "RUN_ODM",
  createdAt: null,
  hasCog: false,
})

describe("demForOrtho", () => {
  const files = [
    f(`${P}odm_orthophoto-a.tif`),
    f(`${P}odm_dsm-a.tif`),
    f(`${P}odm_orthophoto-b.tif`),
  ]
  it("pairs an ODM ortho with the DSM from the same job", () => {
    expect(demForOrtho(odm("a"), files)).toBe(`${P}odm_dsm-a.tif`)
  })
  it("returns null when that job left no DSM", () => {
    expect(demForOrtho(odm("b"), files)).toBeNull()
  })
  it("uses the DEM picked at import for imported orthos", () => {
    const imported = { ...odm("x"), source: "imported" as const }
    expect(
      demForOrtho(imported, files, `${R}/DJI/RGB/Orthomosaic-DEM/d.tif`),
    ).toBe(`${R}/DJI/RGB/Orthomosaic-DEM/d.tif`)
    expect(demForOrtho(imported, files)).toBeNull()
  })
})

describe("demOptions", () => {
  it("lists DSMs and uploaded DEMs, not orthos or pyramids", () => {
    const out = demOptions([
      f(`${P}odm_dsm-a.tif`),
      f(`${P}odm_dsm-a-Pyramid.tif`),
      f(`${P}odm_orthophoto-a.tif`),
      f(`${R}/DJI/RGB/Orthomosaic-DEM/field.tif`),
    ]).map((o) => o.path)
    expect(out).toEqual([
      `${P}odm_dsm-a.tif`,
      `${R}/DJI/RGB/Orthomosaic-DEM/field.tif`,
    ])
  })
})

describe("thermalOptions", () => {
  it("offers other sensors' orthos for the date, labelled by sensor", () => {
    const out = thermalOptions(
      [
        f(`${R}/DJI/RGB/Orthomosaic/rgb.tif`),
        f(`${R}/DJI/Thermal/Orthomosaic/thermal.tif`),
        f(`${R}/DJI/Thermal/Orthomosaic-DEM/dem.tif`),
        f(`${R}/DJI/Thermal/Images/IMG_1.tif`),
      ],
      `gemini/${R}/DJI/RGB/Orthomosaic/rgb.tif`,
    )
    expect(out).toEqual([
      {
        path: `${R}/DJI/Thermal/Orthomosaic/thermal.tif`,
        label: "DJI/Thermal · thermal.tif",
      },
    ])
  })
})
