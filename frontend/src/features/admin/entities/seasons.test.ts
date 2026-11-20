import { describe, expect, it, vi } from "vitest"

import { type SeasonInput, SeasonsService } from "@/client"

import { seasonsConfig } from "./seasons"

describe("seasonsConfig", () => {
  it("exposes a sensible config", () => {
    expect(seasonsConfig.slug).toBe("seasons")
    expect(seasonsConfig.singular).toBe("Season")
    expect(seasonsConfig.fields.map((f) => f.key)).toEqual([
      "season_name",
      "season_start_date",
      "season_end_date",
      "experiment_name",
      "season_info",
    ])
    expect(seasonsConfig.fields[0].required).toBe(true)
    expect(seasonsConfig.fields[4].tableHidden).toBe(true)
  })

  it("emptyInput is the minimal create payload", () => {
    expect(seasonsConfig.emptyInput()).toEqual({ season_name: "" })
  })

  it("toInput drops write-only experiment_name + preserves dates + info", () => {
    expect(
      seasonsConfig.toInput({
        id: "s1",
        season_name: "Summer 2026",
        season_start_date: "2026-06-01",
        season_end_date: "2026-09-01",
        season_info: { region: "CA" },
      } as never),
    ).toEqual({
      season_name: "Summer 2026",
      season_start_date: "2026-06-01",
      season_end_date: "2026-09-01",
      season_info: { region: "CA" },
    })
  })

  it("create parses a JSON-string info field", async () => {
    const spy = vi
      .spyOn(SeasonsService, "apiSeasonsCreateSeason")
      .mockResolvedValue({ id: "x", season_name: "X" } as never)
    const input: SeasonInput = {
      season_name: "X",
      season_info: '{"foo":1}' as unknown as SeasonInput["season_info"],
    }
    await seasonsConfig.create(input)
    expect(spy).toHaveBeenCalledWith({
      requestBody: { season_name: "X", season_info: { foo: 1 } },
    })
    spy.mockRestore()
  })

  it("delete passes the id as a string for the SDK", async () => {
    const spy = vi
      .spyOn(SeasonsService, "apiSeasonsIdSeasonIdDeleteSeason")
      .mockResolvedValue({} as never)
    await seasonsConfig.delete({ id: "s1", season_name: "Y" } as never)
    expect(spy).toHaveBeenCalledWith({ seasonId: "s1" })
    spy.mockRestore()
  })
})
