import { describe, expect, it, vi } from "vitest"

import { LinesService, type LineInput } from "@/client"

import { linesConfig } from "./lines"

describe("linesConfig", () => {
  it("exposes a sensible config", () => {
    expect(linesConfig.slug).toBe("lines")
    expect(linesConfig.singular).toBe("Line")
    expect(linesConfig.fields.map((f) => f.key)).toEqual([
      "line_name",
      "species",
      "line_info",
    ])
    expect(linesConfig.fields[0].required).toBe(true)
    expect(linesConfig.fields[2].tableHidden).toBe(true)
  })

  it("emptyInput is the minimal create payload", () => {
    expect(linesConfig.emptyInput()).toEqual({ line_name: "" })
  })

  it("toInput preserves species + info field", () => {
    expect(
      linesConfig.toInput({
        id: "ln-1",
        line_name: "Heirloom-A",
        species: "Lycopersicon",
        line_info: { source: "USDA" },
      } as never),
    ).toEqual({
      line_name: "Heirloom-A",
      species: "Lycopersicon",
      line_info: { source: "USDA" },
    })
  })

  it("create parses a JSON-string info field", async () => {
    const spy = vi
      .spyOn(LinesService, "apiLinesCreateLine")
      .mockResolvedValue({ id: "x", line_name: "X" } as never)
    const input: LineInput = {
      line_name: "X",
      line_info: '{"foo":42}' as unknown as LineInput["line_info"],
    }
    await linesConfig.create(input)
    expect(spy).toHaveBeenCalledWith({
      requestBody: { line_name: "X", line_info: { foo: 42 } },
    })
    spy.mockRestore()
  })

  it("delete passes the id as a string for the SDK", async () => {
    const spy = vi
      .spyOn(LinesService, "apiLinesIdLineIdDeleteLine")
      .mockResolvedValue({} as never)
    await linesConfig.delete({ id: "ln-1", line_name: "Y" } as never)
    expect(spy).toHaveBeenCalledWith({ lineId: "ln-1" })
    spy.mockRestore()
  })
})
