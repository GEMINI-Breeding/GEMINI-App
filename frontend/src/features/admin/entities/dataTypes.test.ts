import { describe, expect, it, vi } from "vitest"

import { DataTypesService, type DataTypeInput } from "@/client"

import { dataTypesConfig } from "./dataTypes"

describe("dataTypesConfig", () => {
  it("exposes a sensible config", () => {
    expect(dataTypesConfig.slug).toBe("data-types")
    expect(dataTypesConfig.singular).toBe("Data type")
    expect(dataTypesConfig.fields.map((f) => f.key)).toEqual([
      "data_type_name",
      "data_type_info",
    ])
    expect(dataTypesConfig.fields[0].required).toBe(true)
    expect(dataTypesConfig.fields[1].tableHidden).toBe(true)
  })

  it("emptyInput is the minimal create payload", () => {
    expect(dataTypesConfig.emptyInput()).toEqual({ data_type_name: "" })
  })

  it("toInput rebuilds the form from a row", () => {
    expect(
      dataTypesConfig.toInput({
        id: 7,
        data_type_name: "Image Data",
        data_type_info: { extensions: ["jpg", "png"] },
      } as never),
    ).toEqual({
      data_type_name: "Image Data",
      data_type_info: { extensions: ["jpg", "png"] },
    })
  })

  it("create parses a JSON-string info field", async () => {
    const spy = vi
      .spyOn(DataTypesService, "apiDataTypesCreateDataType")
      .mockResolvedValue({ id: 1, data_type_name: "X" } as never)
    const input: DataTypeInput = {
      data_type_name: "X",
      data_type_info: '{"foo":42}' as unknown as DataTypeInput["data_type_info"],
    }
    await dataTypesConfig.create(input)
    expect(spy).toHaveBeenCalledWith({
      requestBody: { data_type_name: "X", data_type_info: { foo: 42 } },
    })
    spy.mockRestore()
  })

  it("delete coerces id to a number for the SDK", async () => {
    const spy = vi
      .spyOn(DataTypesService, "apiDataTypesIdDataTypeIdDeleteDataType")
      .mockResolvedValue({} as never)
    await dataTypesConfig.delete({ id: "9", data_type_name: "Y" } as never)
    expect(spy).toHaveBeenCalledWith({ dataTypeId: 9 })
    spy.mockRestore()
  })
})
