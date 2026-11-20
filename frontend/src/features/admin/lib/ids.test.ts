import { describe, expect, it } from "vitest"

import { idAsNumber, idAsString, parseInfoField } from "./ids"

describe("idAsNumber", () => {
  it("returns numbers as-is", () => {
    expect(idAsNumber(42)).toBe(42)
  })
  it("parses numeric strings", () => {
    expect(idAsNumber("17")).toBe(17)
  })
  it("throws on non-numeric input", () => {
    expect(() => idAsNumber("abc")).toThrow()
    expect(() => idAsNumber(null)).toThrow()
    expect(() => idAsNumber(undefined)).toThrow()
  })
})

describe("idAsString", () => {
  it("returns strings as-is", () => {
    expect(idAsString("a-b-c")).toBe("a-b-c")
  })
  it("stringifies numbers", () => {
    expect(idAsString(42)).toBe("42")
  })
  it("throws on null/undefined", () => {
    expect(() => idAsString(null)).toThrow()
    expect(() => idAsString(undefined)).toThrow()
  })
})

describe("parseInfoField", () => {
  it("returns undefined for null/undefined/empty string", () => {
    expect(parseInfoField(null)).toBeUndefined()
    expect(parseInfoField(undefined)).toBeUndefined()
    expect(parseInfoField("")).toBeUndefined()
    expect(parseInfoField("   ")).toBeUndefined()
  })
  it("parses valid JSON strings", () => {
    expect(parseInfoField('{"foo":1}')).toEqual({ foo: 1 })
    expect(parseInfoField("[1,2,3]")).toEqual([1, 2, 3])
  })
  it("returns the raw string when JSON.parse fails", () => {
    expect(parseInfoField("not-json")).toBe("not-json")
  })
  it("passes objects through unchanged", () => {
    const obj = { a: 1 }
    expect(parseInfoField(obj)).toBe(obj)
  })
})
