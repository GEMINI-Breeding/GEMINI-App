import {
  SeasonsService,
  type SeasonInput,
  type SeasonOutput,
} from "@/client"
import type { EntityConfig } from "@/features/admin/lib/types"
import { idAsString, parseInfoField } from "@/features/admin/lib/ids"

function normalize(input: SeasonInput): SeasonInput {
  return {
    ...input,
    season_info: parseInfoField(input.season_info) as SeasonInput["season_info"],
  }
}

export const seasonsConfig: EntityConfig<SeasonOutput, SeasonInput> = {
  slug: "seasons",
  singular: "Season",
  plural: "Seasons",
  queryKey: ["admin", "seasons"],
  rowId: (r) => String(r.id ?? ""),
  list: async () =>
    (await SeasonsService.apiSeasonsAllGetAllSeasons({
      limit: 500,
      offset: 0,
    })) as SeasonOutput[],
  create: async (input) =>
    (await SeasonsService.apiSeasonsCreateSeason({
      requestBody: normalize(input),
    })) as SeasonOutput,
  update: async (row, input) =>
    (await SeasonsService.apiSeasonsIdSeasonIdUpdateSeason({
      seasonId: idAsString(row.id),
      requestBody: normalize(input),
    })) as SeasonOutput,
  delete: async (row) =>
    SeasonsService.apiSeasonsIdSeasonIdDeleteSeason({ seasonId: idAsString(row.id) }),
  fields: [
    { key: "season_name", label: "Name", type: "text", required: true },
    { key: "season_start_date", label: "Start date", type: "date" },
    { key: "season_end_date", label: "End date", type: "date" },
    {
      key: "experiment_name",
      label: "Experiment",
      type: "text",
      placeholder: "(experiment name)",
    },
    { key: "season_info", label: "Info (JSON)", type: "json", tableHidden: true },
  ],
  emptyInput: () => ({ season_name: "" }),
  toInput: (row) => ({
    season_name: row.season_name ?? "",
    season_start_date: row.season_start_date ?? undefined,
    season_end_date: row.season_end_date ?? undefined,
    // experiment_name is write-only on SeasonInput; SeasonOutput exposes
    // experiment_id but not the name. Leave blank on edit.
    season_info: row.season_info ?? undefined,
  }),
}
