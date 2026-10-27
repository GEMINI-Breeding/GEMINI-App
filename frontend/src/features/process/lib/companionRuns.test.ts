import { describe, expect, it } from "vitest"

import { companionRunsOf, isPrimarySensor, primaryRunOf } from "./companionRuns"
import type { Run } from "./runStore"

const run = (
  id: string,
  sensor: string,
  extra: Partial<NonNullable<Run["uploadScope"]>> = {},
): Run =>
  ({
    id,
    pipelineId: "p",
    workspaceId: "w",
    createdAt: "2026-07-23T10:00:00",
    steps: {},
    uploadScope: {
      experiment: "GEMINI-26",
      location: "Davis",
      population: "Sorghum",
      date: "2026-07-23",
      platform: "Drone",
      sensor,
      ...extra,
    },
  }) as unknown as Run

describe("one flight, several cameras", () => {
  const pooled = run("rgb", "RGB", {
    datasetShortIds: ["ww000001", "dr000002"],
  })
  const labels = { ww000001: "well-watered", dr000002: "drought" }
  const thWW = run("thWW", "Thermal", { batchLabel: "well-watered" })
  const thD = run("thD", "Thermal", { batchLabel: "drought" })
  const rgbNoon = run("rgb2", "RGB", { batchLabel: "run 12:54 · well-watered" })
  const thNoon = run("th2", "Thermal", {
    batchLabel: "run 12:54 · well-watered",
  })
  const thAlone = run("th3", "Thermal", { batchLabel: "run 18:37 · drought" })
  const otherDay = run("th4", "Thermal", { date: "2026-07-27" })
  const all = [pooled, thWW, thD, rgbNoon, thNoon, thAlone, otherDay]

  it("RGB is the flight's processing run", () => {
    expect(isPrimarySensor("RGB")).toBe(true)
    expect(isPrimarySensor("Thermal")).toBe(false)
    expect(isPrimarySensor("RGB-SonyA7R")).toBe(true)
  })
  it("a thermal upload folds into the RGB run of its flight: same run of the day and treatment", () => {
    expect(primaryRunOf(thWW, all, labels)?.id).toBe("rgb")
    expect(primaryRunOf(thD, all, labels)?.id).toBe("rgb")
    expect(primaryRunOf(thNoon, all, labels)?.id).toBe("rgb2")
    expect(companionRunsOf(pooled, all, labels).map((r) => r.id)).toEqual([
      "thWW",
      "thD",
    ])
    expect(companionRunsOf(rgbNoon, all, labels).map((r) => r.id)).toEqual([
      "th2",
    ])
  })
  it("with no RGB run of its flight it stays a run of its own", () => {
    expect(primaryRunOf(thAlone, all, labels)).toBeNull()
    expect(primaryRunOf(otherDay, all, labels)).toBeNull()
  })
  it("a treatment the RGB run does not hold is another flight", () => {
    const rgbWWOnly = run("rgbW", "RGB", {
      batchLabel: "run 13:05 · well-watered",
    })
    const thDrought = run("thx", "Thermal", {
      batchLabel: "run 13:05 · drought",
    })
    expect(primaryRunOf(thDrought, [rgbWWOnly, thDrought])).toBeNull()
  })
})
