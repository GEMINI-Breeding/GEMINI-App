import { type SiteInput, type SiteOutput, SitesService } from "@/client"
import { idAsString, parseInfoField } from "@/features/admin/lib/ids"
import type { EntityConfig } from "@/features/admin/lib/types"

function normalize(input: SiteInput): SiteInput {
  return {
    ...input,
    site_info: parseInfoField(input.site_info) as SiteInput["site_info"],
  }
}

export const sitesConfig: EntityConfig<SiteOutput, SiteInput> = {
  slug: "sites",
  singular: "Site",
  plural: "Sites",
  queryKey: ["admin", "sites"],
  rowId: (r) => String(r.id ?? ""),
  list: async () =>
    (await SitesService.apiSitesAllGetAllSites({
      limit: 500,
      offset: 0,
    })) as SiteOutput[],
  create: async (input) =>
    (await SitesService.apiSitesCreateSite({
      requestBody: normalize(input),
    })) as SiteOutput,
  update: async (row, input) =>
    (await SitesService.apiSitesIdSiteIdUpdateSite({
      siteId: idAsString(row.id),
      requestBody: normalize(input),
    })) as SiteOutput,
  delete: async (row) =>
    SitesService.apiSitesIdSiteIdDeleteSite({ siteId: idAsString(row.id) }),
  fields: [
    { key: "site_name", label: "Name", type: "text", required: true },
    { key: "site_city", label: "City", type: "text" },
    { key: "site_state", label: "State", type: "text" },
    { key: "site_country", label: "Country", type: "text" },
    { key: "site_info", label: "Info (JSON)", type: "json", tableHidden: true },
  ],
  emptyInput: () => ({ site_name: "" }),
  toInput: (row) => ({
    site_name: row.site_name ?? "",
    site_city: row.site_city ?? undefined,
    site_state: row.site_state ?? undefined,
    site_country: row.site_country ?? undefined,
    site_info: row.site_info ?? undefined,
  }),
}
