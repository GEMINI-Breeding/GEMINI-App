import {
  type DataTypeInput,
  type DataTypeOutput,
  DataTypesService,
} from "@/client"
import { idAsNumber, parseInfoField } from "@/features/admin/lib/ids"
import type { EntityConfig } from "@/features/admin/lib/types"

function normalize(input: DataTypeInput): DataTypeInput {
  return {
    ...input,
    data_type_info: parseInfoField(
      input.data_type_info,
    ) as DataTypeInput["data_type_info"],
  }
}

export const dataTypesConfig: EntityConfig<DataTypeOutput, DataTypeInput> = {
  slug: "data-types",
  singular: "Data type",
  plural: "Data types",
  queryKey: ["admin", "data_types"],
  rowId: (r) => String(r.id ?? ""),
  list: async () =>
    (await DataTypesService.apiDataTypesAllGetAllDataTypes({
      limit: 500,
      offset: 0,
    })) as DataTypeOutput[],
  create: async (input) =>
    (await DataTypesService.apiDataTypesCreateDataType({
      requestBody: normalize(input),
    })) as DataTypeOutput,
  update: async (row, input) =>
    (await DataTypesService.apiDataTypesIdDataTypeIdUpdateDataType({
      dataTypeId: idAsNumber(row.id),
      requestBody: normalize(input),
    })) as DataTypeOutput,
  delete: async (row) =>
    DataTypesService.apiDataTypesIdDataTypeIdDeleteDataType({
      dataTypeId: idAsNumber(row.id),
    }),
  fields: [
    {
      key: "data_type_name",
      label: "Name",
      type: "text",
      required: true,
    },
    {
      key: "data_type_info",
      label: "Info (JSON)",
      type: "json",
      tableHidden: true,
    },
  ],
  emptyInput: () => ({ data_type_name: "" }),
  toInput: (row) => ({
    data_type_name: row.data_type_name ?? "",
    data_type_info: row.data_type_info ?? undefined,
  }),
}
