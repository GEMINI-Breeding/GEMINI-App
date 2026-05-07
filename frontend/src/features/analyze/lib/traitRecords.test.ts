import { describe, expect, it } from "vitest"
import { parseNdjson } from "./traitRecords"

describe("parseNdjson", () => {
  it("returns [] for empty input", () => {
    expect(parseNdjson("")).toEqual([])
  })

  it("parses three records separated by newlines", () => {
    const raw = [
      '{"trait_id":1,"trait_name":"height","trait_value":1.2,"timestamp":"2026-01-01"}',
      '{"trait_id":1,"trait_name":"height","trait_value":1.5,"timestamp":"2026-01-02"}',
      '{"trait_id":1,"trait_name":"height","trait_value":1.7,"timestamp":"2026-01-03"}',
    ].join("\n")
    const result = parseNdjson(raw)
    expect(result).toHaveLength(3)
    expect(result[0].trait_value).toBe(1.2)
    expect(result[2].trait_value).toBe(1.7)
  })

  it("skips empty lines and trailing newline", () => {
    const raw =
      '{"trait_id":1,"trait_name":"a","trait_value":1,"timestamp":"t"}\n\n' +
      '{"trait_id":1,"trait_name":"a","trait_value":2,"timestamp":"t"}\n'
    const result = parseNdjson(raw)
    expect(result).toHaveLength(2)
  })

  it("propagates JSON.parse errors on malformed input", () => {
    expect(() => parseNdjson("{not json}")).toThrow()
  })
})
