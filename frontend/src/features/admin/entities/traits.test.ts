import { describe, expect, it, vi } from "vitest"

import { TraitsService, type TraitInput } from "@/client"

import { traitsConfig } from "./traits"

describe("traitsConfig", () => {
  it("exposes a sensible config", () => {
    expect(traitsConfig.slug).toBe("traits")
    expect(traitsConfig.singular).toBe("Trait")
    expect(traitsConfig.fields.map((f) => f.key)).toEqual([
      "trait_name",
      "trait_units",
      "trait_level_id",
      "trait_metrics",
      "trait_info",
    ])
    expect(traitsConfig.fields[0].required).toBe(true)
    expect(traitsConfig.fields[2].type).toBe("select")
    expect(typeof traitsConfig.fields[2].optionsHook).toBe("function")
    expect(traitsConfig.fields[3].tableHidden).toBe(true)
    expect(traitsConfig.fields[4].tableHidden).toBe(true)
  })

  it("emptyInput is the minimal create payload", () => {
    expect(traitsConfig.emptyInput()).toEqual({ trait_name: "" })
  })

  it("toInput coerces trait_level_id + preserves units / metrics / info", () => {
    expect(
      traitsConfig.toInput({
        id: "t-1",
        trait_name: "Plant Height",
        trait_units: "m",
        trait_level_id: "2",
        trait_metrics: { mean: 1.4 },
        trait_info: { source: "agronomist" },
      } as never),
    ).toEqual({
      trait_name: "Plant Height",
      trait_units: "m",
      trait_level_id: 2,
      trait_metrics: { mean: 1.4 },
      trait_info: { source: "agronomist" },
    })
  })

  it("create parses BOTH trait_metrics and trait_info JSON strings", async () => {
    const spy = vi
      .spyOn(TraitsService, "apiTraitsCreateTrait")
      .mockResolvedValue({ id: "x", trait_name: "X" } as never)
    const input: TraitInput = {
      trait_name: "X",
      trait_metrics: '{"mean":1}' as unknown as TraitInput["trait_metrics"],
      trait_info: '{"src":"y"}' as unknown as TraitInput["trait_info"],
    }
    await traitsConfig.create(input)
    expect(spy).toHaveBeenCalledWith({
      requestBody: {
        trait_name: "X",
        trait_metrics: { mean: 1 },
        trait_info: { src: "y" },
      },
    })
    spy.mockRestore()
  })

  it("delete passes the id as a string for the SDK", async () => {
    const spy = vi
      .spyOn(TraitsService, "apiTraitsIdTraitIdDeleteTrait")
      .mockResolvedValue({} as never)
    await traitsConfig.delete({ id: "t-1", trait_name: "Y" } as never)
    expect(spy).toHaveBeenCalledWith({ traitId: "t-1" })
    spy.mockRestore()
  })
})
