import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { StackProgress, StackStatus } from "@/lib/stack"

// The Tauri bridge (src-tauri/src/lib.rs stack_* commands).
const invoke = vi.fn()
let progressHandler: ((e: { payload: StackProgress }) => void) | null = null
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invoke(cmd, args),
}))
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (_: string, h: (e: { payload: StackProgress }) => void) => {
    progressHandler = h
    return () => {
      progressHandler = null
    }
  },
}))
const login = vi.fn()
vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  login: (...a: unknown[]) => login(...a),
}))

import { OpenAPI } from "@/client/core/OpenAPI"
import { StackGate } from "./StackGate"

const config = { data_dir: "/data", api_port: 17777, titiler_port: 18091 }
const status = (over: Partial<StackStatus> = {}): StackStatus => ({
  managed: true,
  version: "edge",
  docker: { state: "ready", version: "28.0" },
  config,
  api_url: "http://127.0.0.1:17777",
  titiler_url: "http://127.0.0.1:18091",
  healthy: true,
  default_data_dir: "/home/u/GEMINI-Stack",
  legacy_install: null,
  ...over,
})

type W = Window & {
  __GEMI_MANAGED_STACK__?: boolean
  __GEMI_BACKEND_URL__?: string
  __GEMI_TITILER_URL__?: string
}

const app = () =>
  render(
    <StackGate>
      <div>the app</div>
    </StackGate>,
  )

describe("StackGate", () => {
  beforeEach(() => {
    ;(window as W).__GEMI_MANAGED_STACK__ = true
    localStorage.clear()
    invoke.mockReset()
    login.mockReset()
  })
  afterEach(() => {
    const w = window as W
    delete w.__GEMI_MANAGED_STACK__
    delete w.__GEMI_BACKEND_URL__
    delete w.__GEMI_TITILER_URL__
    OpenAPI.BASE = ""
  })

  it("outside the desktop app renders the app untouched", () => {
    delete (window as W).__GEMI_MANAGED_STACK__
    app()
    expect(screen.getByText("the app")).toBeInTheDocument()
    expect(invoke).not.toHaveBeenCalled()
  })

  it("stack already up: points requests at it, signs in, renders the app", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "stack_status") return status()
      if (cmd === "stack_credentials")
        return { email: "user@gemini.local", password: "pw" }
    })
    app()
    await screen.findByText("the app")
    expect(OpenAPI.BASE).toBe("http://127.0.0.1:17777")
    expect((window as W).__GEMI_TITILER_URL__).toBe("http://127.0.0.1:18091")
    expect(login).toHaveBeenCalledWith("user@gemini.local", "pw")
    expect(invoke).not.toHaveBeenCalledWith("stack_start", undefined)
  })

  it("an existing token is reused, not replaced", async () => {
    localStorage.setItem("gemini.auth.token", "t")
    invoke.mockResolvedValue(status())
    app()
    await screen.findByText("the app")
    expect(login).not.toHaveBeenCalled()
  })

  it("Docker missing: explains, and never renders the app", async () => {
    invoke.mockResolvedValue(status({ docker: { state: "missing" } }))
    app()
    expect(
      await screen.findByText("GEMINI needs Docker Desktop"),
    ).toBeInTheDocument()
    expect(screen.queryByText("the app")).toBeNull()
  })

  it("Docker not running: says to start it and shows why", async () => {
    invoke.mockResolvedValue(
      status({
        docker: {
          state: "not_running",
          detail: "Cannot connect to the daemon",
        },
      }),
    )
    app()
    expect(await screen.findByText("Start Docker Desktop")).toBeInTheDocument()
    expect(screen.getByText("Cannot connect to the daemon")).toBeInTheDocument()
  })

  it("first run: asks for the data folder, then configures and starts", async () => {
    let configured = false
    let started = false
    invoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "stack_status")
        return configured
          ? status({ healthy: started })
          : status({
              config: null,
              api_url: null,
              titiler_url: null,
              healthy: false,
            })
      if (cmd === "stack_configure") {
        expect(args).toEqual({ dataDir: "/big/drive/gemini" })
        configured = true
        return config
      }
      if (cmd === "stack_start") {
        progressHandler?.({ payload: { phase: "pull", message: "Pulling db" } })
        started = true
      }
      if (cmd === "stack_credentials") return { email: "e", password: "p" }
    })
    app()
    const input = await screen.findByLabelText("Data folder")
    expect(input).toHaveValue("/home/u/GEMINI-Stack")
    fireEvent.change(input, { target: { value: "/big/drive/gemini" } })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }))
    })
    await screen.findByText("the app")
    expect(invoke).toHaveBeenCalledWith("stack_start", undefined)
  })

  it("first run after v0.0.5 promises the old data stays untouched", async () => {
    invoke.mockResolvedValue(
      status({
        config: null,
        healthy: false,
        legacy_install: "/Users/u/Library/Application Support/GEMI/gemi.db",
      }),
    )
    app()
    expect(
      await screen.findByText(/never modified or deleted/),
    ).toBeInTheDocument()
  })

  it("start failure: shows the error, logs on request, and retries", async () => {
    let attempts = 0
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "stack_status") return status({ healthy: attempts > 1 })
      if (cmd === "stack_start") {
        attempts++
        if (attempts === 1)
          throw "Port 7777 (GEMINI API) is in use by another program."
      }
      if (cmd === "stack_logs") return "rest-api | boom"
      if (cmd === "stack_credentials") return { email: "e", password: "p" }
    })
    app()
    expect(await screen.findByText(/Port 7777/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Show service logs" }))
    expect(await screen.findByText("rest-api | boom")).toBeInTheDocument()
    attempts = 1 // the next start succeeds
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    })
    await waitFor(() => expect(screen.getByText("the app")).toBeInTheDocument())
  })
})
