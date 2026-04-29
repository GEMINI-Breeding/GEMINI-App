import { describe, expect, it, vi } from "vitest"

import { DataFormatsService, type DataFormatInput } from "@/client"

import { dataFormatsConfig } from "./dataFormats"

describe("dataFormatsConfig", () => {
  it("exposes a sensible config", () => {
    expect(dataFormatsConfig.slug).toBe("data-formats")
    expect(dataFormatsConfig.singular).toBe("Data format")
    expect(dataFormatsConfig.fields.map((f) => f.key)).toEqual([
      "data_format_name",
      "data_format_mime_type",
      "data_format_info",
    ])
    expect(dataFormatsConfig.fields[0].required).toBe(true)
    expect(dataFormatsConfig.fields[2].tableHidden).toBe(true)
  })

  it("emptyInput is the minimal create payload", () => {
    expect(dataFormatsConfig.emptyInput()).toEqual({ data_format_name: "" })
  })

  it("toInput rebuilds the form from a row", () => {
    expect(
      dataFormatsConfig.toInput({
        id: 3,
        data_format_name: "GeoTIFF",
        data_format_mime_type: "image/tiff",
        data_format_info: { driver: "GTiff" },
      } as never),
    ).toEqual({
      data_format_name: "GeoTIFF",
      data_format_mime_type: "image/tiff",
      data_format_info: { driver: "GTiff" },
    })
  })

  it("create parses a JSON-string info field", async () => {
    const spy = vi
      .spyOn(DataFormatsService, "apiDataFormatsCreateDataFormat")
      .mockResolvedValue({ id: 1, data_format_name: "X" } as never)
    const input: DataFormatInput = {
      data_format_name: "X",
      data_format_info: '{"compression":"LZW"}' as unknown as DataFormatInput["data_format_info"],
    }
    await dataFormatsConfig.create(input)
    expect(spy).toHaveBeenCalledWith({
      requestBody: {
        data_format_name: "X",
        data_format_info: { compression: "LZW" },
      },
    })
    spy.mockRestore()
  })

  it("delete coerces id to a number for the SDK", async () => {
    const spy = vi
      .spyOn(DataFormatsService, "apiDataFormatsIdDataFormatIdDeleteDataFormat")
      .mockResolvedValue({} as never)
    await dataFormatsConfig.delete({ id: "5", data_format_name: "Y" } as never)
    expect(spy).toHaveBeenCalledWith({ dataFormatId: 5 })
    spy.mockRestore()
  })
})
