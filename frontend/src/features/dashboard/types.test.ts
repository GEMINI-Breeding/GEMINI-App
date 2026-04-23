import { describe, expect, it } from "vitest"
import { SPAN_CLASSES, sourceKey } from "./types"

describe("sourceKey", () => {
  it("formats 'src_<id-prefix>_<sanitized-metric>'", () => {
    expect(
      sourceKey({
        id: "abcd1234-ffff-0000-1111-222222222222",
        type: "pipeline-run",
        recordId: "r1",
        metric: "plant_height",
        aggregation: "avg",
      }),
    ).toBe("src_abcd1234_plant_height")
  })

  it("replaces non-alphanumeric chars in the metric with underscores", () => {
    expect(
      sourceKey({
        id: "12345678-aaaa-bbbb-cccc-dddddddddddd",
        type: "pipeline-avg",
        pipelineId: "p1",
        metric: "height (cm)",
        aggregation: "avg",
      }),
    ).toBe("src_12345678_height__cm_")
  })

  it("uses only the first 8 characters of the id", () => {
    expect(
      sourceKey({
        id: "deadbeefcafebabe",
        type: "reference",
        datasetId: "d1",
        metric: "x",
        aggregation: "sum",
      }),
    ).toBe("src_deadbeef_x")
  })
})

describe("SPAN_CLASSES", () => {
  it("defines a Tailwind class list for every WidgetSpan value", () => {
    expect(Object.keys(SPAN_CLASSES).sort()).toEqual(["full", "lg", "md", "sm"])
    for (const val of Object.values(SPAN_CLASSES)) {
      expect(val).toMatch(/col-span-12/)
    }
  })
})
