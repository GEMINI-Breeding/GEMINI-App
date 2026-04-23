import { describe, expect, it } from "vitest"
import { cn } from "./utils"

describe("cn", () => {
  it("joins truthy class names with a space", () => {
    expect(cn("a", "b", "c")).toBe("a b c")
  })

  it("drops falsy values (false, null, undefined, empty string)", () => {
    expect(cn("a", false, null, undefined, "", "b")).toBe("a b")
  })

  it("accepts conditional object syntax from clsx", () => {
    expect(cn("a", { b: true, c: false, d: true })).toBe("a b d")
  })

  it("merges conflicting tailwind classes, keeping the last one", () => {
    expect(cn("p-2", "p-4")).toBe("p-4")
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500")
  })

  it("preserves non-conflicting tailwind classes alongside merged ones", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4")
  })

  it("handles nested arrays from clsx", () => {
    expect(cn(["a", ["b", "c"]], "d")).toBe("a b c d")
  })
})
