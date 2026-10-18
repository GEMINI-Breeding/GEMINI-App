import { beforeEach, describe, expect, it } from "vitest"

import {
  fileUploadAsRun,
  pipelineTypeFor,
  scopeFromUploadPath,
} from "./fileUpload"
import {
  __resetRunStoreForTests,
  createPipeline,
  createWorkspace,
  getState,
} from "./runStore"

const P = "Raw/2024/Cowpea 2024/Davis/MAGIC/2024-07-15"

describe("fileUploadAsRun", () => {
  beforeEach(() => __resetRunStoreForTests())

  it("reads the scope and batch from an upload path", () => {
    expect(scopeFromUploadPath(`${P}/Amiga/RGB/2c639384/`)).toMatchObject({
      experiment: "Cowpea 2024",
      platform: "Amiga",
      shortId: "2c639384",
    })
    expect(scopeFromUploadPath("Processed/x/y")).toBeNull()
    expect(scopeFromUploadPath("Raw/2024/Exp")).toBeNull()
  })

  it("routes rovers and hand-held cameras to ground, drones to aerial", () => {
    expect(pipelineTypeFor("Amiga")).toBe("ground")
    expect(pipelineTypeFor("Handheld phone")).toBe("ground")
    expect(pipelineTypeFor("Drone")).toBe("aerial")
  })

  it("makes a run in the experiment's workspace, then reuses it", () => {
    const first = fileUploadAsRun({
      path: `${P}/Amiga/RGB/aaaaaaaa/`,
      experimentId: "e1",
    })
    expect(first?.created).toBe(true)
    const st = getState()
    expect(st.workspaces.map((w) => w.name)).toEqual(["Cowpea 2024"])
    expect(st.pipelines[0].type).toBe("ground")
    expect(first?.run.uploadScope).toMatchObject({
      experimentId: "e1",
      datasetShortIds: ["aaaaaaaa"],
    })

    // the same batch again: the same run
    expect(fileUploadAsRun({ path: `${P}/Amiga/RGB/aaaaaaaa/` })?.run.id).toBe(
      first?.run.id,
    )
    // a second batch at the same scope joins it
    const second = fileUploadAsRun({ path: `${P}/Amiga/RGB/bbbbbbbb/` })
    expect(second?.created).toBe(false)
    expect(
      getState().runs.find((r) => r.id === first?.run.id)?.uploadScope
        ?.datasetShortIds,
    ).toEqual(["aaaaaaaa", "bbbbbbbb"])
    // a labelled batch (run of the day / treatment) gets its own run
    const labelled = fileUploadAsRun({
      path: `${P}/Amiga/RGB/cccccccc/`,
      batchLabel: "drought",
    })
    expect(labelled?.created).toBe(true)
    expect(labelled?.run.uploadScope?.batchLabel).toBe("drought")
    expect(getState().runs).toHaveLength(2)
  })

  it("joins a person's own workspace and pipeline for the experiment", () => {
    const ws = createWorkspace({ name: "cowpea_2024" })
    const pipe = createPipeline({
      workspaceId: ws.id,
      name: "Rover",
      type: "ground",
      params: { device: "cpu" },
    })
    const filed = fileUploadAsRun({ path: `${P}/Amiga/RGB/aaaaaaaa/` })
    expect(filed?.run.pipelineId).toBe(pipe.id)
    expect(getState().workspaces).toHaveLength(1)
  })

  it("ignores uploads that are not field data", () => {
    expect(fileUploadAsRun({ path: "Reference/Cowpea/design.csv" })).toBeNull()
  })
})
