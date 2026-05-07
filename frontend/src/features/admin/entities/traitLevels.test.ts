import { describe, expect, it, vi } from "vitest"

import { type TraitLevelInput, TraitLevelsService } from "@/client"

import { traitLevelsConfig } from "./traitLevels"

describe("traitLevelsConfig", () => {
  it("exposes a sensible config", () => {
    expect(traitLevelsConfig.slug).toBe("trait-levels")
    expect(traitLevelsConfig.singular).toBe("Trait level")
    expect(traitLevelsConfig.fields.map((f) => f.key)).toEqual([
      "trait_level_name",
      "trait_level_info",
    ])
    expect(traitLevelsConfig.fields[0].required).toBe(true)
    expect(traitLevelsConfig.fields[1].tableHidden).toBe(true)
  })

  it("emptyInput is the minimal create payload", () => {
    expect(traitLevelsConfig.emptyInput()).toEqual({ trait_level_name: "" })
  })

  it("toInput rebuilds the form from a row", () => {
    expect(
      traitLevelsConfig.toInput({
        id: 5,
        trait_level_name: "Plot",
        trait_level_info: { unit: "" },
      } as never),
    ).toEqual({
      trait_level_name: "Plot",
      trait_level_info: { unit: "" },
    })
  })

  it("create parses a JSON-string info field", async () => {
    const spy = vi
      .spyOn(TraitLevelsService, "apiTraitLevelsCreateTraitLevel")
      .mockResolvedValue({ id: 1, trait_level_name: "X" } as never)
    const input: TraitLevelInput = {
      trait_level_name: "X",
      trait_level_info:
        '{"k":1}' as unknown as TraitLevelInput["trait_level_info"],
    }
    await traitLevelsConfig.create(input)
    expect(spy).toHaveBeenCalledWith({
      requestBody: { trait_level_name: "X", trait_level_info: { k: 1 } },
    })
    spy.mockRestore()
  })

  it("delete coerces id to a number for the SDK", async () => {
    const spy = vi
      .spyOn(TraitLevelsService, "apiTraitLevelsIdTraitLevelIdDeleteTraitLevel")
      .mockResolvedValue({} as never)
    await traitLevelsConfig.delete({ id: "5", trait_level_name: "Y" } as never)
    expect(spy).toHaveBeenCalledWith({ traitLevelId: 5 })
    spy.mockRestore()
  })
})
