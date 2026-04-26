import {
  TraitLevelsService,
  TraitsService,
  type TraitInput,
  type TraitLevelOutput,
  type TraitOutput,
} from "@/client"
import type { EntityConfig, EntityField } from "@/features/admin/lib/types"
import { idAsNumber, idAsString, parseInfoField } from "@/features/admin/lib/ids"
import { useQuery } from "@tanstack/react-query"

function normalize(input: TraitInput): TraitInput {
  return {
    ...input,
    trait_info: parseInfoField(input.trait_info) as TraitInput["trait_info"],
    trait_metrics: parseInfoField(input.trait_metrics) as TraitInput["trait_metrics"],
  }
}

function useTraitLevelOptions(): Array<{ value: string | number; label: string }> {
  const { data } = useQuery<TraitLevelOutput[], Error>({
    queryKey: ["admin", "trait_levels", "options"],
    queryFn: async () =>
      (await TraitLevelsService.apiTraitLevelsAllGetAllTraitLevels({
        limit: 500,
        offset: 0,
      })) as TraitLevelOutput[],
  })
  return (data ?? [])
    .filter((tl) => tl.id != null)
    .map((tl) => ({
      value: idAsNumber(tl.id),
      label: tl.trait_level_name ?? `#${tl.id}`,
    }))
}

const fields: EntityField<TraitInput>[] = [
  { key: "trait_name", label: "Name", type: "text", required: true },
  { key: "trait_units", label: "Units", type: "text" },
  {
    key: "trait_level_id",
    label: "Trait level",
    type: "select",
    optionsHook: useTraitLevelOptions,
  },
  { key: "trait_metrics", label: "Metrics (JSON)", type: "json", tableHidden: true },
  { key: "trait_info", label: "Info (JSON)", type: "json", tableHidden: true },
]

export const traitsConfig: EntityConfig<TraitOutput, TraitInput> = {
  slug: "traits",
  singular: "Trait",
  plural: "Traits",
  queryKey: ["admin", "traits"],
  rowId: (r) => String(r.id ?? ""),
  list: async () =>
    (await TraitsService.apiTraitsAllGetAllTraits({
      limit: 500,
      offset: 0,
    })) as TraitOutput[],
  create: async (input) =>
    (await TraitsService.apiTraitsCreateTrait({
      requestBody: normalize(input),
    })) as TraitOutput,
  update: async (row, input) =>
    (await TraitsService.apiTraitsIdTraitIdUpdateTrait({
      traitId: idAsString(row.id),
      requestBody: normalize(input),
    })) as TraitOutput,
  delete: async (row) =>
    TraitsService.apiTraitsIdTraitIdDeleteTrait({ traitId: idAsString(row.id) }),
  fields,
  emptyInput: () => ({ trait_name: "" }),
  toInput: (row) => ({
    trait_name: row.trait_name ?? "",
    trait_units: row.trait_units ?? undefined,
    trait_level_id:
      row.trait_level_id != null ? idAsNumber(row.trait_level_id) : undefined,
    trait_metrics: row.trait_metrics ?? undefined,
    trait_info: row.trait_info ?? undefined,
  }),
}
