import { describe, expect, it } from "vitest"

import { groupRuns, splitBatchLabel } from "./runGroups"
import type { Run } from "./runStore"

const run = (
  id: string,
  sensor: string,
  extra: Partial<NonNullable<Run["uploadScope"]>> = {},
  date = "2026-07-23",
): Run =>
  ({
    id,
    pipelineId: "p",
    workspaceId: "w",
    createdAt: `${date}T10:00:00`,
    steps: {},
    uploadScope: {
      experiment: "GEMINI-26",
      location: "Davis",
      population: "Sorghum",
      date,
      platform: "Drone",
      sensor,
      ...extra,
    },
  }) as unknown as Run

describe("run groups", () => {
  it("splits a batch label into run of the day and treatment", () => {
    expect(splitBatchLabel("run 12:54 · drought")).toEqual({
      run: "12:54",
      treatment: "drought",
    })
    expect(splitBatchLabel("well-watered")).toEqual({
      treatment: "well-watered",
    })
    expect(splitBatchLabel(undefined)).toEqual({})
  })

  it("puts a flight day's sensors and diurnal runs in one group", () => {
    const runs = [
      // The day's first flights, both treatments processed in one RGB run.
      run("rgb1", "RGB", { datasetShortIds: ["aaaa1111", "bbbb2222"] }),
      run("th1", "Thermal", { batchLabel: "well-watered" }),
      run("th2", "Thermal", { batchLabel: "drought" }),
      run("rgb3", "RGB", { batchLabel: "run 13:05 · drought" }),
      run("th3", "Thermal", { batchLabel: "run 13:05 · drought" }),
      run("rgb2", "RGB", { batchLabel: "run 12:54 · well-watered" }),
      // Another crop the same day is its own group.
      run("cow", "RGB", { population: "Cowpea" }),
    ]
    const groups = groupRuns(runs, {
      aaaa1111: "well-watered",
      bbbb2222: "drought",
    })
    expect(groups.map((g) => g.title)).toEqual([
      "Davis · Cowpea · Drone",
      "Davis · Sorghum · Drone",
    ])
    const g = groups[1]
    expect(g.sensors).toEqual(["RGB", "Thermal"])
    expect(g.treatments).toEqual(["drought", "well-watered"])
    expect(g.lines.map((l) => l.title)).toEqual([
      "First flights · drought + well-watered",
      "12:54 · well-watered",
      "13:05 · drought",
    ])
    // The thermal runs of a flight fold into its RGB run (their frames go into
    // its plot images); the line lists the RGB run only.
    expect(g.lines[0].runs.map((r) => r.run.id)).toEqual(["rgb1"])
    expect(g.lines[0].runs[0].with.map((r) => r.run.id)).toEqual(["th2", "th1"])
    expect(g.lines[2].runs.map((r) => r.sensor)).toEqual(["RGB"])
    expect(g.lines[2].runs[0].with.map((r) => r.sensor)).toEqual(["Thermal"])
  })

  it("a thermal upload with no RGB run of its flight stays a run of its own", () => {
    const [g] = groupRuns([
      run("rgb", "RGB", { batchLabel: "run 12:54 · drought" }),
      run("th", "Thermal", { batchLabel: "run 18:37 · drought" }),
    ])
    expect(g.lines.map((l) => l.runs.map((r) => r.run.id))).toEqual([
      ["rgb"],
      ["th"],
    ])
  })

  it("a day with one run has one plain line", () => {
    const [g] = groupRuns([run("only", "RGB")])
    expect(g.lines).toHaveLength(1)
    expect(g.lines[0].title).toBe("")
  })

  it("newest date first", () => {
    const groups = groupRuns([
      run("a", "RGB", {}, "2026-07-23"),
      run("b", "RGB", {}, "2026-08-21"),
    ])
    expect(groups.map((g) => g.date)).toEqual(["2026-08-21", "2026-07-23"])
  })
})
