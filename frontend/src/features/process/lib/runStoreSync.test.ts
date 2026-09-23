/**
 * runStore ↔ /api/process_state: the outbox, write ordering, retries, the
 * one-time upload of a browser's old localStorage-only data, and pulling
 * server state without losing unsent local writes.
 *
 * `fetch` is replaced by a tiny in-memory server that enforces the same
 * parent-exists rule as the real controller (409 for an orphan).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  __resetRunStoreForTests,
  createPipeline,
  createRun,
  createWorkspace,
  deleteWorkspace,
  getRun,
  getWorkspace,
  hydrateRunStore,
  updateRun,
  useWorkspaces,
} from "./runStore"

type Doc = { id: string; workspaceId?: string; pipelineId?: string }
type Call = { method: string; kind: string; id: string }

const scope = {
  experimentId: "e",
  seasonId: "s",
  siteId: "l",
  populationId: "p",
}

function fakeServer() {
  const docs = {
    workspace: new Map<string, Doc>(),
    pipeline: new Map<string, Doc>(),
    run: new Map<string, Doc>(),
  }
  const calls: Call[] = []
  let failNext = 0
  let offline = false
  const parentOf = (kind: string, doc: Doc) =>
    kind === "pipeline"
      ? docs.workspace.has(doc.workspaceId ?? "")
      : kind === "run"
        ? docs.pipeline.has(doc.pipelineId ?? "")
        : true
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (offline) throw new TypeError("Failed to fetch")
    const path = new URL(url, "http://x").pathname
    const method = init?.method ?? "GET"
    if (method === "GET") {
      return new Response(
        JSON.stringify({
          workspaces: [...docs.workspace.values()],
          pipelines: [...docs.pipeline.values()],
          runs: [...docs.run.values()],
        }),
        { status: 200 },
      )
    }
    const [, , , kind, id] = path.split("/") as [
      string,
      string,
      string,
      keyof typeof docs,
      string,
    ]
    calls.push({ method, kind, id })
    if (failNext > 0) {
      failNext -= 1
      return new Response("boom", { status: 500 })
    }
    if (method === "DELETE") {
      docs[kind].delete(id)
      return new Response("{}", { status: 200 })
    }
    const doc = JSON.parse(String(init?.body)).doc as Doc
    if (!parentOf(kind, doc)) return new Response("{}", { status: 409 })
    docs[kind].set(id, doc)
    return new Response("{}", { status: 200 })
  })
  return {
    docs,
    calls,
    fetchMock,
    failOnce: () => {
      failNext = 1
    },
    setOffline: (v: boolean) => {
      offline = v
    },
  }
}

const settle = () => new Promise((r) => setTimeout(r, 0))

describe("runStore server sync", () => {
  let server: ReturnType<typeof fakeServer>

  beforeEach(() => {
    localStorage.clear()
    __resetRunStoreForTests()
    server = fakeServer()
    vi.stubGlobal("fetch", server.fetchMock)
  })
  afterEach(() => {
    __resetRunStoreForTests()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("writes nothing until sync starts, then sends parents before children", async () => {
    const ws = createWorkspace({ name: "W", defaultScope: scope })
    const pl = createPipeline({
      workspaceId: ws.id,
      name: "P",
      type: "ground",
      params: {},
    })
    createRun({ pipelineId: pl.id, scope })
    expect(server.calls).toEqual([])

    await hydrateRunStore()
    expect(server.calls.map((c) => c.kind)).toEqual([
      "workspace",
      "pipeline",
      "run",
    ])
    expect(server.docs.run.size).toBe(1)
  })

  it("uploads a browser's old local-only data once, skipping orphans", async () => {
    localStorage.setItem(
      "gemini.process.runStore.v1",
      JSON.stringify({
        workspaces: [{ id: "w1", name: "old" }],
        pipelines: [
          { id: "p1", workspaceId: "w1" },
          { id: "p-orphan", workspaceId: "gone" },
        ],
        runs: [
          { id: "r1", pipelineId: "p1", steps: {} },
          { id: "r-orphan", pipelineId: "p-orphan", steps: {} },
        ],
      }),
    )
    await hydrateRunStore()
    expect([...server.docs.pipeline.keys()]).toEqual(["p1"])
    expect([...server.docs.run.keys()]).toEqual(["r1"])
    expect(localStorage.getItem("gemini.process.migratedToServer.v1")).toBe("1")

    // A second start (new tab) doesn't upload it again.
    __resetRunStoreForTests()
    const before = server.calls.length
    await hydrateRunStore()
    expect(server.calls.length).toBe(before)
  })

  it("pulls server state, keeping unsent local writes on top", async () => {
    server.docs.workspace.set("w-remote", { id: "w-remote" })
    await hydrateRunStore()
    server.setOffline(true)
    const local = createWorkspace({ name: "made offline", defaultScope: scope })
    await settle()
    server.setOffline(false)
    // A poll lands before the outbox drains: the local one must survive.
    server.docs.workspace.set("w-remote-2", { id: "w-remote-2" })
    window.dispatchEvent(new Event("focus"))
    await settle()
    await settle()
    expect(getWorkspace(local.id)?.name).toBe("made offline")
    expect(getWorkspace("w-remote-2")).toBeDefined()
    expect(getWorkspace("w-remote")).toBeDefined()
  })

  it("retries a failed write and keeps the newest version of an entity", async () => {
    vi.useFakeTimers()
    await hydrateRunStore()
    const ws = createWorkspace({ name: "W", defaultScope: scope })
    const pl = createPipeline({
      workspaceId: ws.id,
      name: "P",
      type: "aerial",
      params: {},
    })
    const run = createRun({ pipelineId: pl.id, scope })
    await vi.runOnlyPendingTimersAsync()

    server.failOnce()
    updateRun(run.id, { status: "running" })
    updateRun(run.id, { status: "completed" })
    await vi.runOnlyPendingTimersAsync()
    await vi.advanceTimersByTimeAsync(5_000)
    expect((server.docs.run.get(run.id) as { status?: string })?.status).toBe(
      "completed",
    )
    expect(getRun(run.id)?.status).toBe("completed")
  })

  it("deletes children before parents", async () => {
    await hydrateRunStore()
    const ws = createWorkspace({ name: "W", defaultScope: scope })
    const pl = createPipeline({
      workspaceId: ws.id,
      name: "P",
      type: "aerial",
      params: {},
    })
    createRun({ pipelineId: pl.id, scope })
    await settle()
    server.calls.length = 0
    deleteWorkspace(ws.id)
    await settle()
    await settle()
    expect(server.calls.map((c) => `${c.method} ${c.kind}`)).toEqual([
      "DELETE run",
      "DELETE pipeline",
      "DELETE workspace",
    ])
    expect(server.docs.workspace.size).toBe(0)
  })

  it("drops a write whose parent is gone (409) instead of retrying forever", async () => {
    await hydrateRunStore()
    const ws = createWorkspace({ name: "W", defaultScope: scope })
    await settle()
    server.docs.workspace.delete(ws.id) // deleted in another browser
    createPipeline({
      workspaceId: ws.id,
      name: "P",
      type: "aerial",
      params: {},
    })
    await settle()
    await settle()
    expect(
      JSON.parse(localStorage.getItem("gemini.process.outbox.v1") ?? "[]"),
    ).toEqual([])
  })

  it("ignores a pull that was in flight while a local write landed", async () => {
    await hydrateRunStore()
    const ws = createWorkspace({ name: "W", defaultScope: scope })
    const pl = createPipeline({
      workspaceId: ws.id,
      name: "P",
      type: "ground",
      params: {},
    })
    const run = createRun({ pipelineId: pl.id, scope })
    await settle()
    await settle()
    // A poll starts, the server answers with the pre-save state…
    let answer: (r: Response) => void = () => {}
    const stale = JSON.stringify({
      workspaces: [...server.docs.workspace.values()],
      pipelines: [...server.docs.pipeline.values()],
      runs: [...server.docs.run.values()],
    })
    server.fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((res) => {
          answer = res
        }),
    )
    window.dispatchEvent(new Event("focus"))
    // …while the user saves and the save is acknowledged…
    updateRun(run.id, { status: "completed" })
    await settle()
    await settle()
    // …and only then does the stale answer arrive.
    answer(new Response(stale, { status: 200 }))
    await settle()
    await settle()
    expect(getRun(run.id)?.status).toBe("completed")
  })

  it("counts as ready once the first load finishes, even offline", async () => {
    server.setOffline(true)
    await hydrateRunStore()
    const { useRunStoreReady } = await import("./runStore")
    const { renderHook } = await import("@testing-library/react")
    expect(renderHook(() => useRunStoreReady()).result.current).toBe(true)
    expect(renderHook(() => useWorkspaces()).result.current).toEqual([])
  })
})
