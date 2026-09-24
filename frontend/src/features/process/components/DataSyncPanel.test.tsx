import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

let result: unknown = null
vi.mock("@/client", () => ({
  JobsService: { apiJobsJobIdGetJob: async () => ({ result }) },
}))

import { DataSyncPanel } from "./DataSyncPanel"

const show = (r: unknown) => {
  result = r
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DataSyncPanel jobId="j1" status="completed" />
    </QueryClientProvider>,
  )
}
const base = {
  mode: "own_metadata",
  images: 10,
  located: 10,
  datasets: { "Raw/x/Images/": { images: 10, platform_log: 10 } },
}

describe("DataSyncPanel altitude notice", () => {
  it("says how many altitudes were estimated", async () => {
    show({ ...base, altitude: { estimated: 3, missing: 0 } })
    expect(await screen.findByTestId("data-sync-altitude")).toHaveTextContent(
      "3 images had no altitude — estimated from the nearest image in time.",
    )
  })

  it("explains when no image has an altitude", async () => {
    show({ ...base, altitude: { estimated: 0, missing: 10 } })
    expect(await screen.findByTestId("data-sync-altitude")).toHaveTextContent(
      "No image has an altitude",
    )
  })

  it("says nothing when every altitude was known (and for older jobs)", async () => {
    show({ ...base, altitude: { estimated: 0, missing: 0 } })
    await screen.findByTestId("data-sync-summary")
    expect(screen.queryByTestId("data-sync-altitude")).toBeNull()
  })
})
