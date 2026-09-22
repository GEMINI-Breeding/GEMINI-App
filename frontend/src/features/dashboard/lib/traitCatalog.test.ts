import { describe, expect, it } from "vitest"
import type { FileMetadata } from "@/client"
import {
  type CatalogEntry,
  catalogToRecords,
  decodeRecordId,
  encodeRecordId,
  plotImagesForDate,
  rowsToFeatureCollection,
} from "./traitCatalog"

const entry = (over: Partial<CatalogEntry> = {}): CatalogEntry => ({
  experiment_name: "Exp",
  season_name: "2024",
  site_name: "Davis",
  population: "Cowpea",
  collection_date: "2024-06-01",
  trait_names: ["height", "LAI"],
  plot_count: 3,
  record_count: 6,
  ...over,
})

describe("record ids", () => {
  it("round-trip names containing separators and quotes", () => {
    const k = {
      experiment: 'Exp | "A"',
      season: "2024",
      site: "Davis, CA",
      population: "",
      date: "2024-06-01",
    }
    expect(decodeRecordId(encodeRecordId(k))).toEqual(k)
  })
  it("rejects ids from the old backend", () => {
    expect(decodeRecordId("6f1c2e4a-0000-4000-8000-000000000000")).toBeNull()
    expect(decodeRecordId("tr:not json")).toBeNull()
  })
})

describe("catalogToRecords", () => {
  it("groups dates of one field under one pipeline", () => {
    const [a, b, c] = catalogToRecords([
      entry({ collection_date: "2024-06-01" }),
      entry({ collection_date: "2024-07-01" }),
      entry({ site_name: "Kearney" }),
    ])
    expect(a.id).not.toBe(b.id)
    expect(a.pipeline_id).toBe(b.pipeline_id)
    expect(c.pipeline_id).not.toBe(a.pipeline_id)
    expect(a.pipeline_name).toBe("Exp — Davis · Cowpea (2024)")
    expect(a.trait_columns).toEqual(["height", "LAI"])
    expect(a.date).toBe("2024-06-01")
    expect(a.run_id).toBe("") // no per-run inference route to call
  })
})

describe("plotImagesForDate", () => {
  const f = (object_name: string) => ({ object_name }) as FileMetadata
  const base = "Processed/2024/Exp/Davis/Cowpea"
  it("prefers the flight date's images, falls back to any", () => {
    const m = plotImagesForDate(
      [
        f(`${base}/2024-05-01/D/RGB/PlotImages/plot_1_accession_A.png`),
        f(`${base}/2024-06-01/D/RGB/PlotImages/plot_1_accession_A.png`),
        f(`${base}/2024-05-01/D/RGB/PlotImages/plot_2_accession_B.png`),
        f(`${base}/2024-06-01/D/RGB/odm_orthophoto.tif`),
      ],
      "2024-06-01",
    )
    expect(m.get(1)).toContain("/2024-06-01/")
    expect(m.get(2)).toContain("/2024-05-01/")
    expect(m.size).toBe(2)
  })
})

describe("rowsToFeatureCollection", () => {
  it("puts identity, traits and the image path on each feature", () => {
    const fc = rowsToFeatureCollection(
      [
        {
          plot_number: 1,
          plot_row_number: 2,
          plot_column_number: 3,
          accession_name: "CB27",
          population: "Cowpea",
          values: { height: 10, LAI: null },
        },
      ],
      ["height", "LAI"],
      new Map([[1, "Processed/x/PlotImages/plot_1.png"]]),
    )
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].geometry).toBeNull()
    expect(fc.features[0].properties).toEqual({
      plot_id: "1",
      plot: 1,
      row: 2,
      col: 3,
      accession: "CB27",
      population: "Cowpea",
      height: 10,
      LAI: null,
      _image: "Processed/x/PlotImages/plot_1.png",
    })
  })
})
