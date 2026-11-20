import {
  type DataFormatInput,
  type DataFormatOutput,
  DataFormatsService,
} from "@/client"
import { idAsNumber, parseInfoField } from "@/features/admin/lib/ids"
import type { EntityConfig } from "@/features/admin/lib/types"

function normalize(input: DataFormatInput): DataFormatInput {
  return {
    ...input,
    data_format_info: parseInfoField(
      input.data_format_info,
    ) as DataFormatInput["data_format_info"],
  }
}

export const dataFormatsConfig: EntityConfig<
  DataFormatOutput,
  DataFormatInput
> = {
  slug: "data-formats",
  singular: "Data format",
  plural: "Data formats",
  queryKey: ["admin", "data_formats"],
  rowId: (r) => String(r.id ?? ""),
  list: async () =>
    (await DataFormatsService.apiDataFormatsAllGetAllDataFormats({
      limit: 500,
      offset: 0,
    })) as DataFormatOutput[],
  create: async (input) =>
    (await DataFormatsService.apiDataFormatsCreateDataFormat({
      requestBody: normalize(input),
    })) as DataFormatOutput,
  update: async (row, input) =>
    (await DataFormatsService.apiDataFormatsIdDataFormatIdUpdateDataFormat({
      dataFormatId: idAsNumber(row.id),
      requestBody: normalize(input),
    })) as DataFormatOutput,
  delete: async (row) =>
    DataFormatsService.apiDataFormatsIdDataFormatIdDeleteDataFormat({
      dataFormatId: idAsNumber(row.id),
    }),
  fields: [
    { key: "data_format_name", label: "Name", type: "text", required: true },
    {
      key: "data_format_mime_type",
      label: "MIME type",
      type: "text",
      placeholder: "image/tiff",
    },
    {
      key: "data_format_info",
      label: "Info (JSON)",
      type: "json",
      tableHidden: true,
    },
  ],
  emptyInput: () => ({ data_format_name: "" }),
  toInput: (row) => ({
    data_format_name: row.data_format_name ?? "",
    data_format_mime_type: row.data_format_mime_type ?? undefined,
    data_format_info: row.data_format_info ?? undefined,
  }),
}
