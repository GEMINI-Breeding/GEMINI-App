import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ConfirmDialogProvider } from "@/components/ui/confirm-dialog"
import type { StackStatus } from "@/lib/stack"

// The Tauri bridge (src-tauri/src/lib.rs stack_* commands) and native dialog.
const invoke = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invoke(cmd, args),
}))
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }))
let picked: string | null = "/big/new"
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: async () => picked }))

import { StackSettings } from "./StackSettings"

type W = Window & { __GEMI_MANAGED_STACK__?: boolean }

const status: StackStatus = {
  managed: true,
  version: "sha-0fb532b",
  docker: { state: "ready", version: "28.0" },
  config: { data_dir: "/data/old", api_port: 7777, titiler_port: 8091 },
  api_url: "http://127.0.0.1:7777",
  titiler_url: "http://127.0.0.1:8091",
  healthy: true,
  default_data_dir: null,
  legacy_install: null,
}

let runningJobs: unknown[] = []
const fetchMock = vi.fn(async (url: string) => ({
  ok: true,
  json: async () => (String(url).includes("RUNNING") ? runningJobs : []),
}))

const renderSettings = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ConfirmDialogProvider>
        <StackSettings />
      </ConfirmDialogProvider>
    </QueryClientProvider>,
  )

describe("StackSettings", () => {
  beforeEach(() => {
    ;(window as W).__GEMI_MANAGED_STACK__ = true
    picked = "/big/new"
    runningJobs = []
    invoke.mockReset()
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "stack_status") return status
      if (cmd === "stack_data_size") return 12.3e9
    })
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => {
    delete (window as W).__GEMI_MANAGED_STACK__
    vi.unstubAllGlobals()
  })

  it("outside the desktop app explains where the dev stack is configured", () => {
    delete (window as W).__GEMI_MANAGED_STACK__
    renderSettings()
    expect(
      screen.getByText(/backend\/gemini\/pipeline\/.env/),
    ).toBeInTheDocument()
    expect(invoke).not.toHaveBeenCalled()
  })

  it("shows the data folder, its size and the release", async () => {
    renderSettings()
    expect(await screen.findByText("/data/old")).toBeInTheDocument()
    expect(await screen.findByText("12.3 GB")).toBeInTheDocument()
    expect(screen.getByText("sha-0fb532b")).toBeInTheDocument()
    expect(screen.getByText("Running")).toBeInTheDocument()
  })

  it("move: confirms, moves, and says the old folder is untouched", async () => {
    renderSettings()
    await screen.findByText("/data/old")
    fireEvent.click(
      screen.getByRole("button", { name: /Move to another folder/ }),
    )
    expect(await screen.findByText(/left exactly as it is/)).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Move" }))
    })
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("stack_move_data", {
        to: "/big/new",
      }),
    )
    const done = await screen.findByTestId("stack-moved")
    expect(done).toHaveTextContent("GEMINI now uses /big/new")
    expect(done).toHaveTextContent("/data/old, is untouched")
  })

  it("move: cancelling the folder picker does nothing", async () => {
    picked = null
    renderSettings()
    await screen.findByText("/data/old")
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /Move to another folder/ }),
      )
    })
    expect(invoke).not.toHaveBeenCalledWith(
      "stack_move_data",
      expect.anything(),
    )
  })

  it("running jobs: warns first, and backing out moves nothing", async () => {
    runningJobs = [{ id: "j1" }]
    renderSettings()
    await screen.findByText("/data/old")
    fireEvent.click(
      screen.getByRole("button", { name: /Move to another folder/ }),
    )
    expect(
      await screen.findByText("1 job is still running"),
    ).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    })
    expect(invoke).not.toHaveBeenCalledWith(
      "stack_move_data",
      expect.anything(),
    )
  })

  it("a failed move shows why in a dialog", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "stack_status") return status
      if (cmd === "stack_data_size") return 1e9
      if (cmd === "stack_move_data")
        throw "Not enough space: the data is 1.0 GB, and /big/new has 0.2 GB free."
    })
    renderSettings()
    await screen.findByText("/data/old")
    fireEvent.click(
      screen.getByRole("button", { name: /Move to another folder/ }),
    )
    await screen.findByText(/left exactly as it is/)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Move" }))
    })
    expect(await screen.findByTestId("stack-settings-error")).toHaveTextContent(
      "Not enough space",
    )
    expect(screen.queryByTestId("stack-moved")).toBeNull()
  })

  it("restart and stop-and-quit call the stack", async () => {
    renderSettings()
    await screen.findByText("/data/old")
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restart services" }))
    })
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("stack_restart", undefined),
    )
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Stop services and quit" }),
      )
    })
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("stack_stop_and_quit", undefined),
    )
  })
})
