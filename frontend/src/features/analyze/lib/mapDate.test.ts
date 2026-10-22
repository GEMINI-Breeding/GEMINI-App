import { describe, expect, it } from "vitest"

import type { FileMetadata } from "@/client"
import type { TraitRecord } from "@/features/analyze/api"
import { encodeRecordId } from "@/features/dashboard/lib/traitCatalog"
import {
  boundaryPlots,
  comparable,
  dateOrthos,
  mapDates,
  traitsOnDate,
} from "./mapDate"

const rec = (date: string, traits: string[], site = "Davis"): TraitRecord =>
  ({
    id: encodeRecordId({
      experiment: "E",
      season: "2026",
      site,
      population: "Sorghum",
      date,
    }),
    date,
    experiment: "E",
    location: site,
    population: "Sorghum",
    trait_columns: traits,
  }) as unknown as TraitRecord

const scope = {
  experiment: "E",
  season: "2026",
  site: "Davis",
  population: "Sorghum",
}

describe("map dates and traits", () => {
  const records = [
    rec("2026-07-23", ["Height"]),
    rec("2026-08-21", ["Height", "Vegetation_Fraction"]),
    rec("2026-08-21", ["Other"], "Kearney"),
  ]
  it("lists dates with traits or an orthomosaic, newest first", () => {
    expect(mapDates(records, ["2026-07-27", "2026-08-21"], scope)).toEqual([
      { date: "2026-08-21", traits: true, ortho: true },
      { date: "2026-07-27", traits: false, ortho: true },
      { date: "2026-07-23", traits: true, ortho: false },
    ])
  })
  it("offers only the traits measured on that date, in this scope", () => {
    expect([...traitsOnDate(records, scope, "2026-07-23")]).toEqual(["Height"])
    expect([...traitsOnDate(records, scope, "2026-08-21")].sort()).toEqual([
      "Height",
      "Vegetation_Fraction",
    ])
    expect(traitsOnDate(records, scope, "2026-07-27").size).toBe(0)
  })
})

describe("dateOrthos", () => {
  const f = (n: string) => ({ object_name: n }) as FileMetadata
  const dir = "Processed/2026/E/Davis/Sorghum/2026-08-21/Drone/RGB/"
  const a = "11111111-1111-1111-1111-111111111111"
  const b = "22222222-2222-2222-2222-222222222222"
  const old = "33333333-3333-3333-3333-333333333333"
  const files = [
    f(`${dir}odm_orthophoto-${a}.tif`),
    f(`${dir}odm_orthophoto-${b}.tif`),
    f(`${dir}odm_orthophoto-${old}.tif`),
    f(`${dir}PlotImages/plot_1.png`),
    f("Processed/2026/E/Davis/Sorghum/2026-07-23/Drone/RGB/odm_orthophoto.tif"),
  ]
  it("takes every flight of the date, each one's latest", () => {
    expect(
      dateOrthos(files, "2026-08-21", new Set([a, b])).map((o) => o.jobId),
    ).toEqual([a, b])
  })
  it("keeps them all when the runs say nothing", () => {
    expect(dateOrthos(files, "2026-08-21", new Set())).toHaveLength(3)
    expect(dateOrthos(files, "2026-07-23", new Set())).toHaveLength(1)
  })
})

describe("boundaryPlots", () => {
  it("gives saved plots the keys the trait join reads, without outlines", () => {
    const sq = { type: "Polygon", coordinates: [[[0, 0]]] }
    const out = boundaryPlots({
      boundaries: {
        features: [
          {
            type: "Feature",
            geometry: sq,
            properties: { plot: 501, row: 2, col: 2 },
          },
          { type: "Feature", geometry: sq, properties: { role: "outer" } },
        ],
      },
    })
    expect(out).toHaveLength(1)
    expect(out[0].properties).toMatchObject({
      plot_number: 501,
      plot_row_number: 2,
      plot_column_number: 2,
    })
  })
})

describe("comparable (multivariate)", () => {
  const records = [
    rec("2026-07-23", ["Height"]),
    rec("2026-08-21", ["Height", "Vegetation_Fraction"]),
    rec("2026-08-21", ["Other"], "Kearney"),
  ]
  const none = new Set<string>()
  it("offers the traits with records in the filters", () => {
    const out = comparable(
      records,
      {
        experiments: new Set(["E"]),
        seasons: none,
        sites: new Set(["Davis"]),
        populations: none,
      },
      null,
    )
    expect([...out.traits].sort()).toEqual(["Height", "Vegetation_Fraction"])
    expect(out.dates).toEqual(["2026-08-21", "2026-07-23"])
  })
  it("on one date, only that date's traits", () => {
    const out = comparable(
      records,
      {
        experiments: none,
        seasons: new Set(["2026"]),
        sites: new Set(["Davis"]),
        populations: none,
      },
      "2026-07-23",
    )
    expect([...out.traits]).toEqual(["Height"])
  })
})
