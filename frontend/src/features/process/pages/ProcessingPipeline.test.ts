import { describe, expect, it } from "vitest"

import { migrateCropRules } from "./ProcessingPipeline"

describe("migrateCropRules", () => {
  it("keeps saved crop rules", () => {
    const rules = [
      {
        id: "r1",
        filterMode: "heading" as const,
        directions: [],
        headings: ["north" as const],
        mask_left: 5,
        mask_right: 0,
        mask_top: 0,
        mask_bottom: 0,
      },
    ]
    expect(migrateCropRules({ crop_rules: rules })).toBe(rules)
  })

  it("turns a pre-crop-rules flat mask into one catch-all rule", () => {
    const [rule, ...rest] = migrateCropRules({ mask_left: 12, mask_bottom: 3 })
    expect(rest).toEqual([])
    expect(rule).toMatchObject({
      directions: [],
      headings: [],
      mask_left: 12,
      mask_right: 0,
      mask_top: 0,
      mask_bottom: 3,
    })
  })

  it("starts from one empty catch-all rule", () => {
    expect(migrateCropRules({})).toEqual([
      expect.objectContaining({ headings: [], mask_left: 0, mask_top: 0 }),
    ])
  })
})
