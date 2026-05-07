import { describe, expect, it, vi } from "vitest"

import { type DatasetTypeInput, DatasetTypesService } from "@/client"

import { datasetTypesConfig } from "./datasetTypes"

describe("datasetTypesConfig", () => {
  it("exposes a sensible config", () => {
    expect(datasetTypesConfig.slug).toBe("dataset-types")
    expect(datasetTypesConfig.singular).toBe("Dataset type")
    expect(datasetTypesConfig.fields.map((f) => f.key)).toEqual([
      "dataset_type_name",
      "dataset_type_info",
    ])
    expect(datasetTypesConfig.fields[0].required).toBe(true)
    expect(datasetTypesConfig.fields[1].tableHidden).toBe(true)
  })

  it("emptyInput is the minimal create payload", () => {
    expect(datasetTypesConfig.emptyInput()).toEqual({ dataset_type_name: "" })
  })

  it("toInput rebuilds the form from a row", () => {
    expect(
      datasetTypesConfig.toInput({
        id: 9,
        dataset_type_name: "Image set",
        dataset_type_info: { vendor: "Phantom" },
      } as never),
    ).toEqual({
      dataset_type_name: "Image set",
      dataset_type_info: { vendor: "Phantom" },
    })
  })

  it("create parses a JSON-string info field", async () => {
    const spy = vi
      .spyOn(DatasetTypesService, "apiDatasetTypesCreateDatasetType")
      .mockResolvedValue({ id: 2, dataset_type_name: "X" } as never)
    const input: DatasetTypeInput = {
      dataset_type_name: "X",
      dataset_type_info:
        '{"k":1}' as unknown as DatasetTypeInput["dataset_type_info"],
    }
    await datasetTypesConfig.create(input)
    expect(spy).toHaveBeenCalledWith({
      requestBody: { dataset_type_name: "X", dataset_type_info: { k: 1 } },
    })
    spy.mockRestore()
  })

  it("delete coerces id to a number for the SDK", async () => {
    const spy = vi
      .spyOn(
        DatasetTypesService,
        "apiDatasetTypesIdDatasetTypeIdDeleteDatasetType",
      )
      .mockResolvedValue({} as never)
    await datasetTypesConfig.delete({
      id: "11",
      dataset_type_name: "Y",
    } as never)
    expect(spy).toHaveBeenCalledWith({ datasetTypeId: 11 })
    spy.mockRestore()
  })
})
