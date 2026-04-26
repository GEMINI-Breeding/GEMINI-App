import {
  TraitLevelsService,
  type TraitLevelInput,
  type TraitLevelOutput,
} from "@/client"
import type { EntityConfig } from "@/features/admin/lib/types"
import { idAsNumber, parseInfoField } from "@/features/admin/lib/ids"

function normalize(input: TraitLevelInput): TraitLevelInput {
  return {
    ...input,
    trait_level_info: parseInfoField(input.trait_level_info) as TraitLevelInput["trait_level_info"],
  }
}

export const traitLevelsConfig: EntityConfig<TraitLevelOutput, TraitLevelInput> = {
  slug: "trait-levels",
  singular: "Trait level",
  plural: "Trait levels",
  queryKey: ["admin", "trait_levels"],
  rowId: (r) => String(r.id ?? ""),
  list: async () =>
    (await TraitLevelsService.apiTraitLevelsAllGetAllTraitLevels({
      limit: 500,
      offset: 0,
    })) as TraitLevelOutput[],
  create: async (input) =>
    (await TraitLevelsService.apiTraitLevelsCreateTraitLevel({
      requestBody: normalize(input),
    })) as TraitLevelOutput,
  update: async (row, input) =>
    (await TraitLevelsService.apiTraitLevelsIdTraitLevelIdUpdateTraitLevel({
      traitLevelId: idAsNumber(row.id),
      requestBody: normalize(input),
    })) as TraitLevelOutput,
  delete: async (row) =>
    TraitLevelsService.apiTraitLevelsIdTraitLevelIdDeleteTraitLevel({
      traitLevelId: idAsNumber(row.id),
    }),
  fields: [
    { key: "trait_level_name", label: "Name", type: "text", required: true },
    { key: "trait_level_info", label: "Info (JSON)", type: "json", tableHidden: true },
  ],
  emptyInput: () => ({ trait_level_name: "" }),
  toInput: (row) => ({
    trait_level_name: row.trait_level_name ?? "",
    trait_level_info: row.trait_level_info ?? undefined,
  }),
}
