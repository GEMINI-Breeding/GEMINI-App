import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The desktop app's stack status (free space on the data folder's drive).
let freeBytes: number | null = null
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async () => ({ free_bytes: freeBytes }),
}))

let isSuperuser = true
vi.mock("@/hooks/useAuth", () => ({
  default: () => ({ user: { is_superuser: isSuperuser } }),
}))

import { LegacyImport } from "./LegacyImport"

type W = Window & { __GEMI_MANAGED_STACK__?: boolean }

const PLAN = {
  available: true,
  uploads: 2,
  files: 3,
  bytes: 5e9,
  experiments: ["Trial"],
  seasons: ["2025"],
  skipped: [],
  already_imported: 0,
}

function stubApi(plan: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (String(url).includes("/plan") ? plan : []),
    })),
  )
}

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LegacyImport />
    </QueryClientProvider>,
  )

describe("LegacyImport", () => {
  beforeEach(() => {
    freeBytes = null
    isSuperuser = true
  })
  afterEach(() => {
    delete (window as W).__GEMI_MANAGED_STACK__
    vi.unstubAllGlobals()
  })

  it("ordinary users never see it (nor call its superuser-only API)", async () => {
    isSuperuser = false
    stubApi({ available: true })
    const { container } = show()
    await new Promise((r) => setTimeout(r, 50))
    expect(container).toBeEmptyDOMElement()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("renders nothing when there is no previous install", async () => {
    stubApi({ available: false })
    const { container } = show()
    await new Promise((r) => setTimeout(r, 50))
    expect(container).toBeEmptyDOMElement()
  })

  it("desktop app: refuses to start when the data folder's drive is too small", async () => {
    ;(window as W).__GEMI_MANAGED_STACK__ = true
    freeBytes = 1e9
    stubApi(PLAN)
    show()
    expect(await screen.findByText(/Not enough free space/)).toHaveTextContent(
      "this needs 5.0 GB and the data folder's drive has 1.0 GB",
    )
    expect(screen.getByTestId("legacy-import-start")).toBeDisabled()
  })

  it("desktop app: enough space → Import is offered", async () => {
    ;(window as W).__GEMI_MANAGED_STACK__ = true
    freeBytes = 50e9
    stubApi(PLAN)
    show()
    expect(await screen.findByTestId("legacy-import-start")).toBeEnabled()
    expect(screen.queryByText(/Not enough free space/)).toBeNull()
  })
})
