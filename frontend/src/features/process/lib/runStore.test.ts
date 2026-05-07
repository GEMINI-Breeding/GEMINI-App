/**
 * Unit tests for runStore — Workspace/Pipeline/Run localStorage model.
 */
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { ProcessScope } from "@/features/process/lib/processScope"
import {
  __resetRunStoreForTests,
  appendStepJobId,
  createPipeline,
  createRun,
  createWorkspace,
  deletePipeline,
  deleteRun,
  deleteWorkspace,
  findRunByJobId,
  getRun,
  setStepState,
  updatePipeline,
  updateRun,
  updateWorkspace,
  usePipelines,
  useRun,
  useRuns,
  useWorkspace,
  useWorkspaceRuns,
  useWorkspaces,
} from "./runStore"

const scope: ProcessScope = {
  experimentId: "exp-1",
  seasonId: "season-1",
  siteId: "site-1",
  populationId: "pop-1",
}

describe("runStore", () => {
  beforeEach(() => {
    localStorage.clear()
    act(() => {
      __resetRunStoreForTests()
    })
  })
  afterEach(() => {
    localStorage.clear()
    act(() => {
      __resetRunStoreForTests()
    })
  })

  describe("workspaces", () => {
    it("starts empty", () => {
      const { result } = renderHook(() => useWorkspaces())
      expect(result.current).toEqual([])
    })

    it("createWorkspace persists and notifies subscribers", () => {
      const { result } = renderHook(() => useWorkspaces())
      let created: ReturnType<typeof createWorkspace> | undefined
      act(() => {
        created = createWorkspace({
          name: "Field A",
          experimentId: "exp-1",
          defaultScope: scope,
        })
      })
      expect(result.current).toHaveLength(1)
      expect(result.current[0]?.name).toBe("Field A")
      expect(result.current[0]?.id).toBe(created!.id)
      const raw = localStorage.getItem("gemini.process.runStore.v1")
      expect(raw).toBeTruthy()
      expect(JSON.parse(raw!).workspaces).toHaveLength(1)
    })

    it("updateWorkspace patches in place", () => {
      let id = ""
      act(() => {
        id = createWorkspace({
          name: "old",
          experimentId: "e",
          defaultScope: scope,
        }).id
        updateWorkspace(id, { name: "new", description: "d" })
      })
      const { result } = renderHook(() => useWorkspace(id))
      expect(result.current?.name).toBe("new")
      expect(result.current?.description).toBe("d")
    })

    it("deleteWorkspace cascades to pipelines and runs", () => {
      let wsId = ""
      let pipelineId = ""
      act(() => {
        wsId = createWorkspace({
          name: "ws",
          experimentId: "e",
          defaultScope: scope,
        }).id
        pipelineId = createPipeline({
          workspaceId: wsId,
          name: "p",
          type: "aerial",
          params: {},
        }).id
        createRun({ pipelineId, scope })
      })
      act(() => {
        deleteWorkspace(wsId)
      })
      const ws = renderHook(() => useWorkspaces())
      const ps = renderHook(() => usePipelines(wsId))
      const rs = renderHook(() => useWorkspaceRuns(wsId))
      expect(ws.result.current).toEqual([])
      expect(ps.result.current).toEqual([])
      expect(rs.result.current).toEqual([])
    })
  })

  describe("pipelines", () => {
    it("createPipeline links to a workspace", () => {
      let wsId = ""
      act(() => {
        wsId = createWorkspace({
          name: "w",
          experimentId: "e",
          defaultScope: scope,
        }).id
        createPipeline({
          workspaceId: wsId,
          name: "Aerial pipeline",
          type: "aerial",
          params: { fast: true },
        })
      })
      const { result } = renderHook(() => usePipelines(wsId))
      expect(result.current).toHaveLength(1)
      expect(result.current[0]?.type).toBe("aerial")
      expect(result.current[0]?.params).toEqual({ fast: true })
    })

    it("usePipelines for an unknown workspace returns []", () => {
      const { result } = renderHook(() => usePipelines("nope"))
      expect(result.current).toEqual([])
    })

    it("updatePipeline mutates params without resetting workspaceId", () => {
      let wsId = ""
      let pId = ""
      act(() => {
        wsId = createWorkspace({
          name: "w",
          experimentId: "e",
          defaultScope: scope,
        }).id
        pId = createPipeline({
          workspaceId: wsId,
          name: "p",
          type: "aerial",
          params: {},
        }).id
        updatePipeline(pId, { name: "renamed", params: { quality: "high" } })
      })
      const { result } = renderHook(() => usePipelines(wsId))
      expect(result.current[0]?.name).toBe("renamed")
      expect(result.current[0]?.params).toEqual({ quality: "high" })
      expect(result.current[0]?.workspaceId).toBe(wsId)
    })

    it("deletePipeline drops associated runs", () => {
      let pId = ""
      act(() => {
        const w = createWorkspace({
          name: "w",
          experimentId: "e",
          defaultScope: scope,
        })
        pId = createPipeline({
          workspaceId: w.id,
          name: "p",
          type: "aerial",
          params: {},
        }).id
        createRun({ pipelineId: pId, scope })
        deletePipeline(pId)
      })
      const { result } = renderHook(() => useRuns(pId))
      expect(result.current).toEqual([])
    })
  })

  describe("runs", () => {
    it("createRun copies workspaceId from the parent pipeline", () => {
      let wsId = ""
      let runId = ""
      act(() => {
        const w = createWorkspace({
          name: "w",
          experimentId: "e",
          defaultScope: scope,
        })
        wsId = w.id
        const p = createPipeline({
          workspaceId: wsId,
          name: "p",
          type: "aerial",
          params: {},
        })
        runId = createRun({ pipelineId: p.id, scope }).id
      })
      const { result } = renderHook(() => useRun(runId))
      expect(result.current?.workspaceId).toBe(wsId)
      expect(result.current?.status).toBe("draft")
      expect(result.current?.steps).toEqual({})
    })

    it("createRun throws for an unknown pipeline", () => {
      expect(() => createRun({ pipelineId: "nope", scope })).toThrow()
    })

    it("setStepState seeds a step that didn't exist yet", () => {
      let runId = ""
      act(() => {
        const w = createWorkspace({
          name: "w",
          experimentId: "e",
          defaultScope: scope,
        })
        const p = createPipeline({
          workspaceId: w.id,
          name: "p",
          type: "aerial",
          params: {},
        })
        runId = createRun({ pipelineId: p.id, scope }).id
        setStepState(runId, "orthomosaic", {
          status: "running",
          jobIds: ["job-1"],
        })
      })
      const r = getRun(runId)
      expect(r?.steps.orthomosaic?.status).toBe("running")
      expect(r?.steps.orthomosaic?.jobIds).toEqual(["job-1"])
    })

    it("appendStepJobId is idempotent and flips pending → running", () => {
      let runId = ""
      act(() => {
        const w = createWorkspace({
          name: "w",
          experimentId: "e",
          defaultScope: scope,
        })
        const p = createPipeline({
          workspaceId: w.id,
          name: "p",
          type: "aerial",
          params: {},
        })
        runId = createRun({ pipelineId: p.id, scope }).id
        appendStepJobId(runId, "orthomosaic", "job-1")
        appendStepJobId(runId, "orthomosaic", "job-1") // dedupe
        appendStepJobId(runId, "orthomosaic", "job-2")
      })
      const r = getRun(runId)
      expect(r?.steps.orthomosaic?.jobIds).toEqual(["job-1", "job-2"])
      expect(r?.steps.orthomosaic?.status).toBe("running")
      expect(r?.steps.orthomosaic?.startedAt).toBeTruthy()
    })

    it("appendStepJobId on a failed step resets it to running for retry", () => {
      let runId = ""
      act(() => {
        const w = createWorkspace({
          name: "w",
          experimentId: "e",
          defaultScope: scope,
        })
        const p = createPipeline({
          workspaceId: w.id,
          name: "p",
          type: "aerial",
          params: {},
        })
        runId = createRun({ pipelineId: p.id, scope }).id
        appendStepJobId(runId, "trait_extraction", "job-1")
        setStepState(runId, "trait_extraction", {
          status: "failed",
          error: "S3 NoSuchKey",
          completedAt: "2026-05-06T14:00:00Z",
        })
        appendStepJobId(runId, "trait_extraction", "job-2")
      })
      const r = getRun(runId)
      expect(r?.steps.trait_extraction?.status).toBe("running")
      expect(r?.steps.trait_extraction?.jobIds).toEqual(["job-1", "job-2"])
      expect(r?.steps.trait_extraction?.error).toBeUndefined()
      expect(r?.steps.trait_extraction?.completedAt).toBeUndefined()
    })

    it("updateRun bumps updatedAt", async () => {
      let runId = ""
      let firstUpdated = ""
      act(() => {
        const w = createWorkspace({
          name: "w",
          experimentId: "e",
          defaultScope: scope,
        })
        const p = createPipeline({
          workspaceId: w.id,
          name: "p",
          type: "aerial",
          params: {},
        })
        runId = createRun({ pipelineId: p.id, scope }).id
        firstUpdated = getRun(runId)!.updatedAt
      })
      // Wait at least one ms tick before mutating so the ISO string differs.
      await new Promise((r) => setTimeout(r, 5))
      act(() => {
        updateRun(runId, { status: "running" })
      })
      expect(getRun(runId)?.updatedAt).not.toBe(firstUpdated)
      expect(getRun(runId)?.status).toBe("running")
    })

    it("deleteRun removes one run without touching siblings", () => {
      let runA = ""
      let runB = ""
      act(() => {
        const w = createWorkspace({
          name: "w",
          experimentId: "e",
          defaultScope: scope,
        })
        const p = createPipeline({
          workspaceId: w.id,
          name: "p",
          type: "aerial",
          params: {},
        })
        runA = createRun({ pipelineId: p.id, scope }).id
        runB = createRun({ pipelineId: p.id, scope }).id
        deleteRun(runA)
      })
      expect(getRun(runA)).toBeUndefined()
      expect(getRun(runB)).toBeDefined()
    })
  })

  describe("findRunByJobId", () => {
    it("returns the run owning a job, or undefined", () => {
      let runId = ""
      act(() => {
        const w = createWorkspace({
          name: "w",
          experimentId: "e",
          defaultScope: scope,
        })
        const p = createPipeline({
          workspaceId: w.id,
          name: "p",
          type: "aerial",
          params: {},
        })
        runId = createRun({ pipelineId: p.id, scope }).id
        appendStepJobId(runId, "orthomosaic", "job-abc")
        appendStepJobId(runId, "inference", "job-def")
      })
      expect(findRunByJobId("job-abc")?.id).toBe(runId)
      expect(findRunByJobId("job-def")?.id).toBe(runId)
      expect(findRunByJobId("job-missing")).toBeUndefined()
    })
  })

  describe("subscriptions", () => {
    it("two consumers see the same store state", () => {
      const a = renderHook(() => useWorkspaces())
      const b = renderHook(() => useWorkspaces())
      act(() => {
        createWorkspace({
          name: "shared",
          experimentId: "e",
          defaultScope: scope,
        })
      })
      expect(a.result.current).toHaveLength(1)
      expect(b.result.current).toHaveLength(1)
      expect(a.result.current[0]?.id).toBe(b.result.current[0]?.id)
    })
  })
})
