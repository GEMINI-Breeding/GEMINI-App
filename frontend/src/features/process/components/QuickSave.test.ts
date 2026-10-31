import { describe, expect, it } from "vitest"

import { uniqueName } from "@/features/process/components/QuickSave"

describe("uniqueName", () => {
  it("keeps a free name", () => {
    expect(uniqueName("48 plots", new Set(["other"]))).toBe("48 plots")
  })
  it("numbers a taken one, past the numbers in use", () => {
    expect(uniqueName("48 plots", new Set(["48 plots", "48 plots (2)"]))).toBe(
      "48 plots (3)",
    )
    expect(uniqueName("A (2)", new Set(["A (2)"]))).toBe("A (3)")
  })
})
