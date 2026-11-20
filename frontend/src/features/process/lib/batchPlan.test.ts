import { describe, expect, it } from "vitest"
import {
  type BatchOptions,
  type DateFacts,
  folderFacts,
  modelsToRun,
  planDate,
} from "./batchPlan"

const facts = (over: Partial<DateFacts> = {}): DateFacts => ({
  runId: "r",
  date: "2026-08-10",
  population: "Sorghum",
  boundaries: true,
  orthos: 2,
  cameras: false,
  images: { ortho: false, straightened: false, crops: false },
  traits: false,
  inferred: [],
  ...over,
})
const opts = (over: Partial<BatchOptions> = {}): BatchOptions => ({
  steps: new Set(["plot_images", "trait_extraction", "inference"]),
  plotSource: "ortho",
  modelsFor: (p) => (p === "Sorghum" ? ["Panicles"] : []),
  sources: ["ortho", "straightened", "crops"],
  rerun: false,
  ...over,
})

describe("planning a step across dates", () => {
  it("runs inference after the plot images the batch makes", () => {
    const p = planDate(facts(), opts())
    expect(p.plot_images).toEqual({ kind: "ready" })
    expect(p.trait_extraction).toEqual({ kind: "ready" })
    expect(p.inference).toEqual({ kind: "after", step: "plot_images" })
  })

  it("skips what is done unless asked to re-run", () => {
    const f = facts({
      images: { ortho: true, straightened: false, crops: false },
      traits: true,
      inferred: ["Panicles"],
    })
    const p = planDate(f, opts())
    expect([
      p.plot_images.kind,
      p.trait_extraction.kind,
      p.inference.kind,
    ]).toEqual(["done", "done", "done"])
    const again = planDate(f, opts({ rerun: true }))
    expect(again.inference).toEqual({ kind: "ready" })
  })

  it("says what a date needs first", () => {
    const p = planDate(facts({ boundaries: false }), opts())
    expect(p.plot_images).toEqual({ kind: "needs", reason: "plot boundaries" })
    expect(p.trait_extraction).toEqual({
      kind: "needs",
      reason: "plot boundaries",
    })
    const cowpea = planDate(facts({ population: "Cowpea" }), opts())
    expect(cowpea.inference).toEqual({
      kind: "needs",
      reason: "a model for Cowpea",
    })
  })

  it("uses raw frames when preferred and present", () => {
    const f = facts({
      images: { ortho: false, straightened: true, crops: true },
    })
    const p = planDate(f, opts({ steps: new Set(["inference"]) }))
    expect(p.inference).toEqual({ kind: "ready" })
  })

  it("makes raw-frame plot images after a quick orthomosaic", () => {
    const p = planDate(
      facts(),
      opts({
        steps: new Set(["quick_ortho", "plot_images"]),
        plotSource: "frames",
      }),
    )
    expect(p.quick_ortho).toEqual({ kind: "ready" })
    expect(p.plot_images).toEqual({ kind: "after", step: "quick_ortho" })
  })

  it("reads a date's folder", () => {
    const d = "Processed/2026/E/Davis/Sorghum/2026-08-10/Drone/RGB"
    const f = folderFacts(
      [
        { object_name: `${d}/odm_cameras-abc.json` },
        {
          object_name: `${d}/PlotFrames/drought/straightened/plot_1_accession_A.png`,
        },
      ] as never[],
      "drought",
    )
    expect(f.cameras).toBe(true)
    expect(f.images).toEqual({ ortho: false, straightened: true, crops: false })
  })
})

describe("several models per crop", () => {
  it("runs the ones not yet run on a date, and is done when all have", () => {
    const o = opts({ modelsFor: () => ["Panicles", "Leaves"] })
    const f = facts({
      images: { ortho: true, straightened: false, crops: false },
      inferred: ["Panicles"],
    })
    expect(modelsToRun(f, o)).toEqual(["Leaves"])
    expect(planDate(f, o).inference).toEqual({ kind: "ready" })
    const all = facts({ ...f, inferred: ["Panicles", "Leaves"] })
    expect(planDate(all, o).inference).toEqual({ kind: "done" })
    expect(modelsToRun(all, { ...o, rerun: true })).toEqual([
      "Panicles",
      "Leaves",
    ])
  })
})
