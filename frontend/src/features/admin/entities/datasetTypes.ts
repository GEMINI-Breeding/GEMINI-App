import {
  type DatasetTypeInput,
  type DatasetTypeOutput,
  DatasetTypesService,
} from "@/client"
import { idAsNumber, parseInfoField } from "@/features/admin/lib/ids"
import type { EntityConfig } from "@/features/admin/lib/types"

function normalize(input: DatasetTypeInput): DatasetTypeInput {
  return {
    ...input,
    dataset_type_info: parseInfoField(
      input.dataset_type_info,
    ) as DatasetTypeInput["dataset_type_info"],
  }
}

export const datasetTypesConfig: EntityConfig<
  DatasetTypeOutput,
  DatasetTypeInput
> = {
  slug: "dataset-types",
  singular: "Dataset type",
  plural: "Dataset types",
  queryKey: ["admin", "dataset_types"],
  rowId: (r) => String(r.id ?? ""),
  list: async () =>
    (await DatasetTypesService.apiDatasetTypesAllGetAllDatasetTypes({
      limit: 500,
      offset: 0,
    })) as DatasetTypeOutput[],
  create: async (input) =>
    (await DatasetTypesService.apiDatasetTypesCreateDatasetType({
      requestBody: normalize(input),
    })) as DatasetTypeOutput,
  update: async (row, input) =>
    (await DatasetTypesService.apiDatasetTypesIdDatasetTypeIdUpdateDatasetType({
      datasetTypeId: idAsNumber(row.id),
      requestBody: normalize(input),
    })) as DatasetTypeOutput,
  delete: async (row) =>
    DatasetTypesService.apiDatasetTypesIdDatasetTypeIdDeleteDatasetType({
      datasetTypeId: idAsNumber(row.id),
    }),
  fields: [
    { key: "dataset_type_name", label: "Name", type: "text", required: true },
    {
      key: "dataset_type_info",
      label: "Info (JSON)",
      type: "json",
      tableHidden: true,
    },
  ],
  emptyInput: () => ({ dataset_type_name: "" }),
  toInput: (row) => ({
    dataset_type_name: row.dataset_type_name ?? "",
    dataset_type_info: row.dataset_type_info ?? undefined,
  }),
}
