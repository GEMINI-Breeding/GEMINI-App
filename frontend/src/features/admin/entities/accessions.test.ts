import { describe, expect, it, vi } from "vitest"

import { type AccessionInput, AccessionsService } from "@/client"

import { accessionsConfig } from "./accessions"

describe("accessionsConfig", () => {
  it("exposes a sensible config", () => {
    expect(accessionsConfig.slug).toBe("accessions")
    expect(accessionsConfig.singular).toBe("Accession")
    expect(accessionsConfig.plural).toBe("Accessions")
    expect(accessionsConfig.fields.map((f) => f.key)).toEqual([
      "accession_name",
      "line_name",
      "species",
      "population_name",
      "accession_info",
    ])
    expect(accessionsConfig.fields[0].required).toBe(true)
    // Info column hidden in the table view.
    expect(accessionsConfig.fields[4].tableHidden).toBe(true)
  })

  it("emptyInput is the minimal create payload", () => {
    expect(accessionsConfig.emptyInput()).toEqual({ accession_name: "" })
  })

  it("toInput drops write-only FK names + preserves the info field", () => {
    expect(
      accessionsConfig.toInput({
        id: "abc-1",
        accession_name: "Heirloom",
        species: "Lycopersicon",
        accession_info: { source: "USDA" },
      } as never),
    ).toEqual({
      accession_name: "Heirloom",
      species: "Lycopersicon",
      accession_info: { source: "USDA" },
    })
  })

  it("create parses a JSON-string info field via normalize", async () => {
    const spy = vi
      .spyOn(AccessionsService, "apiAccessionsCreateAccession")
      .mockResolvedValue({ id: "x", accession_name: "X" } as never)
    const input: AccessionInput = {
      accession_name: "X",
      accession_info:
        '{"foo":42}' as unknown as AccessionInput["accession_info"],
    }
    await accessionsConfig.create(input)
    expect(spy).toHaveBeenCalledWith({
      requestBody: { accession_name: "X", accession_info: { foo: 42 } },
    })
    spy.mockRestore()
  })

  it("delete passes the id as a string for the SDK", async () => {
    const spy = vi
      .spyOn(AccessionsService, "apiAccessionsIdAccessionIdDeleteAccession")
      .mockResolvedValue({} as never)
    await accessionsConfig.delete({ id: "abc-1", accession_name: "Y" } as never)
    expect(spy).toHaveBeenCalledWith({ accessionId: "abc-1" })
    spy.mockRestore()
  })
})
