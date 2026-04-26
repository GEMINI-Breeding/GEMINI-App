import {
  LinesService,
  type LineInput,
  type LineOutput,
} from "@/client"
import type { EntityConfig } from "@/features/admin/lib/types"
import { idAsString, parseInfoField } from "@/features/admin/lib/ids"

function normalize(input: LineInput): LineInput {
  return {
    ...input,
    line_info: parseInfoField(input.line_info) as LineInput["line_info"],
  }
}

export const linesConfig: EntityConfig<LineOutput, LineInput> = {
  slug: "lines",
  singular: "Line",
  plural: "Lines",
  queryKey: ["admin", "lines"],
  rowId: (r) => String(r.id ?? ""),
  list: async () =>
    (await LinesService.apiLinesAllGetAllLines({
      limit: 500,
      offset: 0,
    })) as LineOutput[],
  create: async (input) =>
    (await LinesService.apiLinesCreateLine({
      requestBody: normalize(input),
    })) as LineOutput,
  update: async (row, input) =>
    (await LinesService.apiLinesIdLineIdUpdateLine({
      lineId: idAsString(row.id),
      requestBody: normalize(input),
    })) as LineOutput,
  delete: async (row) =>
    LinesService.apiLinesIdLineIdDeleteLine({ lineId: idAsString(row.id) }),
  fields: [
    { key: "line_name", label: "Name", type: "text", required: true },
    { key: "species", label: "Species", type: "text" },
    { key: "line_info", label: "Info (JSON)", type: "json", tableHidden: true },
  ],
  emptyInput: () => ({ line_name: "" }),
  toInput: (row) => ({
    line_name: row.line_name ?? "",
    species: row.species ?? undefined,
    line_info: row.line_info ?? undefined,
  }),
}
