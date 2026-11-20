import { beforeEach, describe, expect, it } from "vitest"

import { legacyRunCount, regroupAgentRuns } from "./regroup"
import {
  __resetRunStoreForTests,
  createPipeline,
  createRun,
  createWorkspace,
  getState,
  updateRun,
} from "./runStore"

const NO_SCOPE = {
  experimentId: null,
  seasonId: null,
  siteId: null,
  populationId: null,
}

const scope = (experiment: string) => ({
  year: "2024",
  experiment,
  location: "Davis",
  population: "Cowpea",
  date: "2024-07-15",
  platform: "Amiga",
  sensor: "RGB",
})

describe("regroupAgentRuns", () => {
  beforeEach(() => __resetRunStoreForTests())

  it("files agent runs under their experiment and removes the old workspace", () => {
    const mine = createWorkspace({ name: "Cowpea 2024" })
    const rover = createPipeline({
      workspaceId: mine.id,
      name: "Rover",
      type: "ground",
      params: {},
    })
    createRun({
      pipelineId: rover.id,
      scope: NO_SCOPE,
      uploadScope: scope("Cowpea 2024"),
    })

    const legacy = createWorkspace({ name: "Agent runs" })
    const agentPipe = createPipeline({
      workspaceId: legacy.id,
      name: "Ground (agent)",
      type: "ground",
      params: { device: "cpu" },
    })
    const a = createRun({
      pipelineId: agentPipe.id,
      scope: NO_SCOPE,
      uploadScope: scope("cowpea_2024"),
    })
    const b = createRun({
      pipelineId: agentPipe.id,
      scope: NO_SCOPE,
      uploadScope: scope("Wheat"),
    })
    updateRun(a.id, { createdBy: "agent" })
    updateRun(b.id, { createdBy: "agent" })

    expect(legacyRunCount()).toBe(2)
    expect(regroupAgentRuns()).toBe(2)
    expect(legacyRunCount()).toBe(0)

    const st = getState()
    expect(st.workspaces.map((w) => w.name).sort()).toEqual([
      "Cowpea 2024",
      "Wheat",
    ])
    const ra = st.runs.find((r) => r.id === a.id)
    expect(ra?.pipelineId).toBe(rover.id) // joined the person's pipeline
    expect(ra?.createdBy).toBe("agent")
    const rb = st.runs.find((r) => r.id === b.id)
    const wheatPipe = st.pipelines.find((p) => p.id === rb?.pipelineId)
    expect(wheatPipe?.params).toEqual({ device: "cpu" }) // settings came along
  })
})
