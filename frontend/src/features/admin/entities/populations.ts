import {
  type PopulationInput,
  type PopulationOutput,
  PopulationsService,
} from "@/client"
import { idAsString, parseInfoField } from "@/features/admin/lib/ids"
import type { EntityConfig } from "@/features/admin/lib/types"

function normalize(input: PopulationInput): PopulationInput {
  return {
    ...input,
    population_info: parseInfoField(
      input.population_info,
    ) as PopulationInput["population_info"],
  }
}

export const populationsConfig: EntityConfig<
  PopulationOutput,
  PopulationInput
> = {
  slug: "populations",
  singular: "Population",
  plural: "Populations",
  queryKey: ["admin", "populations"],
  rowId: (r) => String(r.id ?? ""),
  list: async () =>
    (await PopulationsService.apiPopulationsAllGetAllPopulations({
      limit: 500,
      offset: 0,
    })) as PopulationOutput[],
  create: async (input) =>
    (await PopulationsService.apiPopulationsCreatePopulation({
      requestBody: normalize(input),
    })) as PopulationOutput,
  update: async (row, input) =>
    (await PopulationsService.apiPopulationsIdPopulationIdUpdatePopulation({
      populationId: idAsString(row.id),
      requestBody: normalize(input),
    })) as PopulationOutput,
  delete: async (row) =>
    PopulationsService.apiPopulationsIdPopulationIdDeletePopulation({
      populationId: idAsString(row.id),
    }),
  fields: [
    { key: "population_name", label: "Name", type: "text", required: true },
    { key: "population_type", label: "Type", type: "text" },
    { key: "species", label: "Species", type: "text" },
    {
      key: "experiment_name",
      label: "Experiment",
      type: "text",
      placeholder: "(experiment name)",
      description: "Free-text reference to an existing experiment.",
    },
    {
      key: "population_info",
      label: "Info (JSON)",
      type: "json",
      tableHidden: true,
    },
  ],
  emptyInput: () => ({ population_name: "" }),
  toInput: (row) => ({
    population_name: row.population_name ?? "",
    population_type: row.population_type ?? undefined,
    species: row.species ?? undefined,
    // experiment_name is write-only — PopulationOutput doesn't echo it back.
    population_info: row.population_info ?? undefined,
  }),
}
