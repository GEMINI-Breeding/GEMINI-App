import { describe, expect, it, vi } from "vitest"

import { PopulationsService, type PopulationInput } from "@/client"

import { populationsConfig } from "./populations"

describe("populationsConfig", () => {
  it("exposes a sensible config", () => {
    expect(populationsConfig.slug).toBe("populations")
    expect(populationsConfig.singular).toBe("Population")
    expect(populationsConfig.fields.map((f) => f.key)).toEqual([
      "population_name",
      "population_type",
      "species",
      "experiment_name",
      "population_info",
    ])
    expect(populationsConfig.fields[0].required).toBe(true)
    expect(populationsConfig.fields[4].tableHidden).toBe(true)
  })

  it("emptyInput is the minimal create payload", () => {
    expect(populationsConfig.emptyInput()).toEqual({ population_name: "" })
  })

  it("toInput drops write-only experiment_name + preserves info", () => {
    expect(
      populationsConfig.toInput({
        id: "p1",
        population_name: "Cowpea MAGIC",
        population_type: "MAGIC",
        species: "Vigna unguiculata",
        population_info: { generations: 8 },
      } as never),
    ).toEqual({
      population_name: "Cowpea MAGIC",
      population_type: "MAGIC",
      species: "Vigna unguiculata",
      population_info: { generations: 8 },
    })
  })

  it("create parses a JSON-string info field", async () => {
    const spy = vi
      .spyOn(PopulationsService, "apiPopulationsCreatePopulation")
      .mockResolvedValue({ id: "x", population_name: "X" } as never)
    const input: PopulationInput = {
      population_name: "X",
      population_info: '{"foo":42}' as unknown as PopulationInput["population_info"],
    }
    await populationsConfig.create(input)
    expect(spy).toHaveBeenCalledWith({
      requestBody: { population_name: "X", population_info: { foo: 42 } },
    })
    spy.mockRestore()
  })

  it("delete passes the id as a string for the SDK", async () => {
    const spy = vi
      .spyOn(PopulationsService, "apiPopulationsIdPopulationIdDeletePopulation")
      .mockResolvedValue({} as never)
    await populationsConfig.delete({ id: "p1", population_name: "Y" } as never)
    expect(spy).toHaveBeenCalledWith({ populationId: "p1" })
    spy.mockRestore()
  })
})
