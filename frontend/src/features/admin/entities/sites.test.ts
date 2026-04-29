import { describe, expect, it, vi } from "vitest"

import { SitesService, type SiteInput } from "@/client"

import { sitesConfig } from "./sites"

describe("sitesConfig", () => {
  it("exposes a sensible config", () => {
    expect(sitesConfig.slug).toBe("sites")
    expect(sitesConfig.singular).toBe("Site")
    expect(sitesConfig.fields.map((f) => f.key)).toEqual([
      "site_name",
      "site_city",
      "site_state",
      "site_country",
      "site_info",
    ])
    expect(sitesConfig.fields[0].required).toBe(true)
    expect(sitesConfig.fields[4].tableHidden).toBe(true)
  })

  it("emptyInput is the minimal create payload", () => {
    expect(sitesConfig.emptyInput()).toEqual({ site_name: "" })
  })

  it("toInput preserves city/state/country + info", () => {
    expect(
      sitesConfig.toInput({
        id: "x1",
        site_name: "Davis",
        site_city: "Davis",
        site_state: "CA",
        site_country: "USA",
        site_info: { lat: 38.5 },
      } as never),
    ).toEqual({
      site_name: "Davis",
      site_city: "Davis",
      site_state: "CA",
      site_country: "USA",
      site_info: { lat: 38.5 },
    })
  })

  it("create parses a JSON-string info field", async () => {
    const spy = vi
      .spyOn(SitesService, "apiSitesCreateSite")
      .mockResolvedValue({ id: "y", site_name: "Y" } as never)
    const input: SiteInput = {
      site_name: "Y",
      site_info: '{"k":1}' as unknown as SiteInput["site_info"],
    }
    await sitesConfig.create(input)
    expect(spy).toHaveBeenCalledWith({
      requestBody: { site_name: "Y", site_info: { k: 1 } },
    })
    spy.mockRestore()
  })

  it("delete passes the id as a string for the SDK", async () => {
    const spy = vi
      .spyOn(SitesService, "apiSitesIdSiteIdDeleteSite")
      .mockResolvedValue({} as never)
    await sitesConfig.delete({ id: "x1", site_name: "Y" } as never)
    expect(spy).toHaveBeenCalledWith({ siteId: "x1" })
    spy.mockRestore()
  })
})
