import { describe, expect, it } from "vitest"

import type { DatasetOutput } from "@/client"
import {
  bySeason,
  classify,
  dayOf,
  parseResultName,
  uploadFolder,
} from "./experimentContents"

const ds = (over: Partial<DatasetOutput>): DatasetOutput =>
  ({ id: "x", dataset_name: "n", ...over }) as DatasetOutput

describe("parseResultName", () => {
  it("reads scope and label, dropping the job id", () => {
    expect(
      parseResultName(
        "LOCATE_PLANTS · GEMINI · 2026/Riverside/Cowpea · 2026-09-16 Amiga/RGB · roboflow-pod · eb4fe549",
      ),
    ).toEqual({
      where: {
        season: "2026",
        site: "Riverside",
        population: "Cowpea",
        date: "2026-09-16",
        platform: "Amiga",
        sensor: "RGB",
      },
      what: "roboflow-pod",
    })
  })
  it("keeps a label with no job id", () => {
    expect(
      parseResultName(
        "AGENT · GEMINI · 2023/Davis/Mixed · 2023-07-07 Drone/RGB · canopy cover",
      )?.what,
    ).toBe("canopy cover")
  })
  it("returns null for other names", () => {
    expect(parseResultName("GEMINI-ImageData-20261007-234746-3349")).toBeNull()
  })
})

describe("classify", () => {
  it("an upload with recorded facts", () => {
    const e = classify(
      ds({
        collection_date: "2026-10-19",
        dataset_info: {
          season: "2023",
          site: "Davis",
          population: "Mixed",
          platform: "Drone",
          sensor: "RGB",
          collection_date: "2023-06-13",
          data_type_label: "Image Data",
          source_folder: "/x/y",
        },
      }),
    )
    expect(e.kind).toBe("upload")
    expect(e.where?.date).toBe("2023-06-13")
    expect(e.kind === "upload" && e.uploaded).toBe("2026-10-19")
  })
  it("an older upload without facts", () => {
    const e = classify(
      ds({ dataset_info: { data_type_label: "Farm-ng Binary File" } }),
    )
    expect(e.kind).toBe("upload")
    expect(e.where).toBeNull()
  })
  it("agent and model results", () => {
    const a = classify(
      ds({
        dataset_name:
          "AGENT · GEMINI · 2026/Davis/Sorghum · 2026-08-21 Drone/RGB · canopy cover",
        dataset_info: { source: "agent" },
      }),
    )
    const m = classify(
      ds({
        dataset_name:
          "LOCATE_PLANTS · GEMINI · 2026/Davis/Sorghum · 2026-08-21 Drone/RGB · owlvit panicle · 8e95580c",
        dataset_info: { source: "LOCATE_PLANTS", job_id: "8e95580c-…" },
      }),
    )
    expect(a.kind === "result" && a.madeBy).toBe("agent")
    expect(m.kind === "result" && m.madeBy).toBe("model")
    expect(m.kind === "result" && m.what).toBe("owlvit panicle")
  })
})

describe("bySeason", () => {
  it("newest season first, unknown last, by date within", () => {
    const mk = (season: string, date: string) =>
      classify(
        ds({
          dataset_info: { season, collection_date: date, site: "S" },
        }),
      )
    const g = bySeason([
      mk("2023", "2023-07-07"),
      classify(ds({})),
      mk("2026", "2026-06-22"),
      mk("2023", "2023-06-13"),
    ])
    expect(g.map((x) => x.season)).toEqual(["2026", "2023", null])
    expect(g[1].entries.map((e) => e.where?.date)).toEqual([
      "2023-06-13",
      "2023-07-07",
    ])
  })
})

it("uploadFolder and dayOf", () => {
  expect(
    uploadFolder("GEMINI", {
      season: "2023",
      site: "Davis",
      population: "Mixed",
      date: "2023-06-13",
      platform: "Drone",
      sensor: "RGB",
    }),
  ).toBe("Raw/2023/GEMINI/Davis/Mixed/2023-06-13/Drone/RGB/")
  expect(dayOf("2026-08-21T00:00:00")).toBe("2026-08-21")
})
