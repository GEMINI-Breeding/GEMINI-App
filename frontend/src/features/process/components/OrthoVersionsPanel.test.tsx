import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { FileMetadata } from "@/client"
import type { AerialScope } from "@/features/process/lib/paths"
import type { Run } from "@/features/process/lib/runStore"

import { OrthoVersionsPanel } from "./OrthoVersionsPanel"

// Stub OrthoMapView so jsdom doesn't choke on leaflet's DOM measurement —
// this test exercises the dialog's tilejson plumbing and render-state logic,
// not the leaflet wiring (covered by the live e2e).
vi.mock("@/features/process/components/OrthoMapView", () => ({
  OrthoMapView: (props: { orthoTileUrl?: string }) => (
    <div
      data-testid="ortho-viewer-map"
      data-tile-url={props.orthoTileUrl ?? ""}
    />
  ),
}))

// Suppress toast side-effects from any mutation paths (none triggered in
// these tests, but the panel imports the hook at module load).
vi.mock("sonner", () => ({
  toast: {
    success: () => {},
    error: () => {},
    info: () => {},
  },
}))

const SCOPE: AerialScope = {
  year: "2026",
  experiment: "GEMINI",
  location: "Davis",
  population: "Cowpea MAGIC",
  date: "2026-05-04",
  platform: "Drone",
  sensor: "iPhone",
}

const VERSION_PATH =
  "gemini/Processed/2026/GEMINI/Davis/Cowpea MAGIC/2026-05-04/Drone/iPhone/odm_orthophoto.tif"

function makeRun(): Run {
  return {
    id: "r1",
    pipelineId: "p1",
    workspaceId: "w1",
    scope: {
      experimentId: "e1",
      seasonId: null,
      siteId: null,
      populationId: null,
    },
    status: "running",
    steps: {},
    createdAt: "2026-05-04T00:00:00.000Z",
    updatedAt: "2026-05-04T00:00:00.000Z",
  } as unknown as Run
}

function makeFiles(): FileMetadata[] {
  return [
    {
      object_name:
        "Processed/2026/GEMINI/Davis/Cowpea MAGIC/2026-05-04/Drone/iPhone/odm_orthophoto.tif",
      size: 1234,
      last_modified: "2026-05-04T00:00:00Z",
      etag: null,
      content_type: null,
    } as unknown as FileMetadata,
  ]
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function clickViewIcon() {
  const user = userEvent.setup()
  const viewBtn = await screen.findByRole("button", { name: /^view v1$/i })
  await user.click(viewBtn)
}

describe("OrthoVersionsPanel viewer dialog", () => {
  it("opens the viewer, requests TiTiler tilejson with %20-encoded paths, and renders the map on success", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          tiles: ["https://example/tile/{z}/{x}/{y}"],
          bounds: [-121.7, 38.4, -121.6, 38.5],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    )

    render(
      <OrthoVersionsPanel
        run={makeRun()}
        scope={SCOPE}
        files={makeFiles()}
        onOpenImport={() => {}}
      />,
      { wrapper },
    )

    // Click the eye icon — buildOrthoVersions yields a single v1 row from the
    // file listing.
    await clickViewIcon()

    const map = await screen.findByTestId("ortho-viewer-map")
    expect(map).toBeTruthy()

    // The tilejson URL must encode spaces as %20 (TiTiler 2.0.1 returns
    // tiles[0] with `+` for spaces, which S3 rejects on object keys with
    // spaces — our buildTitilerTileUrl + the dialog's encoded request side-
    // step that). Same regression covered in activeOrtho.test.ts; this
    // assertion pins the dialog's own fetch.
    const tileJsonCall = fetchMock.mock.calls.find(([url]) =>
      typeof url === "string"
        ? url.includes("/titiler/cog/WebMercatorQuad/tilejson.json")
        : false,
    )
    expect(tileJsonCall).toBeDefined()
    const [tileJsonUrl] = tileJsonCall as [string]
    expect(tileJsonUrl).toContain("Cowpea%20MAGIC")
    expect(tileJsonUrl).not.toContain("Cowpea+MAGIC")
    expect(tileJsonUrl).toContain("tilesize=256")

    // Tile URL forwarded to the (mocked) OrthoMapView should also use %20.
    expect(map.getAttribute("data-tile-url")).toContain("Cowpea%20MAGIC")
    expect(map.getAttribute("data-tile-url")).toContain("tilesize=256")
  })

  it("shows an inline error and keeps Download GeoTIFF available when TiTiler fails", async () => {
    fetchMock.mockResolvedValue(
      new Response("nope", {
        status: 502,
        headers: { "Content-Type": "text/plain" },
      }),
    )

    render(
      <OrthoVersionsPanel
        run={makeRun()}
        scope={SCOPE}
        files={makeFiles()}
        onOpenImport={() => {}}
      />,
      { wrapper },
    )
    await clickViewIcon()

    await waitFor(() =>
      expect(screen.getByTestId("ortho-viewer-error")).toBeTruthy(),
    )
    expect(screen.getByText(/TiTiler tilejson failed: 502/i)).toBeTruthy()
    // Map must NOT have rendered.
    expect(screen.queryByTestId("ortho-viewer-map")).toBeNull()
    // Download button stays mounted in the error state.
    expect(
      screen.getByRole("button", { name: /download geotiff/i }),
    ).toBeTruthy()
  })

  it("shows the Building tile preview… loading state while tilejson is in flight", async () => {
    // Never-resolving fetch keeps tilejsonQuery in pending state.
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}))

    render(
      <OrthoVersionsPanel
        run={makeRun()}
        scope={SCOPE}
        files={makeFiles()}
        onOpenImport={() => {}}
      />,
      { wrapper },
    )
    await clickViewIcon()

    expect(await screen.findByTestId("ortho-viewer-loading")).toBeTruthy()
    expect(screen.getByText(/Building tile preview…/i)).toBeTruthy()
    // Path debug line is rendered in every state.
    expect(screen.getByText(VERSION_PATH)).toBeTruthy()
  })
})
