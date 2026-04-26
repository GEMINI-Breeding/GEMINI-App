import {
  AccessionsService,
  type AccessionInput,
  type AccessionOutput,
} from "@/client"
import type { EntityConfig } from "@/features/admin/lib/types"
import { idAsString, parseInfoField } from "@/features/admin/lib/ids"

function normalize(input: AccessionInput): AccessionInput {
  return {
    ...input,
    accession_info: parseInfoField(input.accession_info) as AccessionInput["accession_info"],
  }
}

export const accessionsConfig: EntityConfig<AccessionOutput, AccessionInput> = {
  slug: "accessions",
  singular: "Accession",
  plural: "Accessions",
  queryKey: ["admin", "accessions"],
  rowId: (r) => String(r.id ?? ""),
  list: async () =>
    (await AccessionsService.apiAccessionsAllGetAllAccessions({
      limit: 500,
      offset: 0,
    })) as AccessionOutput[],
  create: async (input) =>
    (await AccessionsService.apiAccessionsCreateAccession({
      requestBody: normalize(input),
    })) as AccessionOutput,
  update: async (row, input) =>
    (await AccessionsService.apiAccessionsIdAccessionIdUpdateAccession({
      accessionId: idAsString(row.id),
      requestBody: normalize(input),
    })) as AccessionOutput,
  delete: async (row) =>
    AccessionsService.apiAccessionsIdAccessionIdDeleteAccession({
      accessionId: idAsString(row.id),
    }),
  fields: [
    { key: "accession_name", label: "Name", type: "text", required: true },
    { key: "line_name", label: "Line", type: "text" },
    { key: "species", label: "Species", type: "text" },
    {
      key: "population_name",
      label: "Population",
      type: "text",
      placeholder: "(population name)",
    },
    { key: "accession_info", label: "Info (JSON)", type: "json", tableHidden: true },
  ],
  emptyInput: () => ({ accession_name: "" }),
  toInput: (row) => ({
    accession_name: row.accession_name ?? "",
    // line_name / population_name are write-only on this endpoint —
    // AccessionOutput exposes the FK ids, not the names.
    species: row.species ?? undefined,
    accession_info: row.accession_info ?? undefined,
  }),
}
