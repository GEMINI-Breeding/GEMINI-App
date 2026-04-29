import { describe, expect, it } from "vitest"

import type { FileMetadata } from "@/client"

import { buildOrthoVersions, isOrthoTif } from "./orthoVersions"
import type { Run } from "./runStore"

const scope = {
  year: "2026",
  experiment: "GEMINI",
  location: "Davis",
  population: "Cowpea",
  date: "2026-04-28",
  platform: "Drone",
  sensor: "RGB",
}

function file(name: string, lastModified?: string): FileMetadata {
  return {
    object_name: `Processed/2026/GEMINI/Davis/Cowpea/2026-04-28/Drone/RGB/${name}`,
    size: 0,
    last_modified: lastModified ?? null,
    etag: null,
    content_type: null,
  } as unknown as FileMetadata
}

function makeRun(versions: Array<{
  filename: string
  label?: string
  source: "RUN_ODM" | "imported"
  createdAt: string
  jobId?: string
}>): Run {
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
    steps: {
      orthomosaic: {
        status: "completed",
        jobIds: [],
        outputs: { versions },
      },
    },
    createdAt: "2026-04-28T00:00:00.000Z",
    updatedAt: "2026-04-28T00:00:00.000Z",
  }
}

describe("isOrthoTif", () => {
  it("matches .tif and .tiff but excludes -Pyramid", () => {
    expect(isOrthoTif("odm_orthophoto.tif")).toBe(true)
    expect(isOrthoTif("odm_orthophoto.tiff")).toBe(true)
    expect(isOrthoTif("odm_orthophoto-Pyramid.tif")).toBe(false)
    expect(isOrthoTif("odm_orthophoto.png")).toBe(false)
  })
})

describe("buildOrthoVersions", () => {
  it("returns [] when scope is null", () => {
    expect(buildOrthoVersions(undefined, null, [])).toEqual([])
  })

  it("synthesizes a v1 from a single TIF with no metadata", () => {
    const out = buildOrthoVersions(undefined, scope, [file("odm_orthophoto.tif")])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      version: 1,
      filename: "odm_orthophoto.tif",
      label: null,
      source: "RUN_ODM",
      hasCog: false,
    })
    expect(out[0].path).toContain("Processed/2026/GEMINI/Davis/Cowpea/")
  })

  it("attaches the Pyramid COG flag when present", () => {
    const out = buildOrthoVersions(undefined, scope, [
      file("odm_orthophoto.tif"),
      file("odm_orthophoto-Pyramid.tif"),
    ])
    expect(out[0].hasCog).toBe(true)
  })

  it("falls back to MinIO last_modified when no runStore metadata exists", () => {
    const out = buildOrthoVersions(undefined, scope, [
      file("odm_orthophoto.tif", "2026-04-28T12:00:00.000Z"),
    ])
    expect(out[0].createdAt).toBe("2026-04-28T12:00:00.000Z")
  })

  it("uses MinIO last_modified for legacy meta entries with no createdAt-on-disk match", () => {
    // Synthesize a meta entry without createdAt (shouldn't really happen
    // — schema requires it — but defend against drift). Cast to bypass
    // the type check for the test.
    const run = makeRun([])
    const stepState = run.steps.orthomosaic
    if (stepState) {
      stepState.outputs = {
        versions: [
          {
            filename: "odm_orthophoto.tif",
            source: "RUN_ODM",
            createdAt: undefined as unknown as string,
          },
        ],
      }
    }
    const out = buildOrthoVersions(run, scope, [
      file("odm_orthophoto.tif", "2026-04-29T01:00:00.000Z"),
    ])
    expect(out[0].createdAt).toBe("2026-04-29T01:00:00.000Z")
  })

  it("uses runStore meta to attach labels and createdAt, newest first", () => {
    const run = makeRun([
      {
        filename: "odm_orthophoto.tif",
        label: "Final ortho",
        source: "RUN_ODM",
        createdAt: "2026-04-28T12:00:00.000Z",
        jobId: "job-A",
      },
    ])
    const out = buildOrthoVersions(run, scope, [file("odm_orthophoto.tif")])
    expect(out).toHaveLength(1)
    expect(out[0].label).toBe("Final ortho")
    expect(out[0].jobId).toBe("job-A")
    expect(out[0].createdAt).toBe("2026-04-28T12:00:00.000Z")
  })

  it("drops metadata entries whose files no longer exist on disk", () => {
    const run = makeRun([
      {
        filename: "odm_orthophoto.tif",
        source: "RUN_ODM",
        createdAt: "2026-04-28T12:00:00.000Z",
      },
      {
        filename: "ghost.tif",
        source: "imported",
        createdAt: "2026-04-28T11:00:00.000Z",
      },
    ])
    const out = buildOrthoVersions(run, scope, [file("odm_orthophoto.tif")])
    expect(out).toHaveLength(1)
    expect(out[0].filename).toBe("odm_orthophoto.tif")
  })

  it("sorts newest-first and assigns descending version numbers", () => {
    const run = makeRun([
      {
        filename: "odm_orthophoto.tif",
        source: "RUN_ODM",
        createdAt: "2026-04-28T12:00:00.000Z",
      },
      {
        filename: "imported_ortho.tif",
        source: "imported",
        createdAt: "2026-04-27T12:00:00.000Z",
      },
    ])
    const out = buildOrthoVersions(run, scope, [
      file("odm_orthophoto.tif"),
      file("imported_ortho.tif"),
    ])
    expect(out.map((v) => ({ filename: v.filename, version: v.version }))).toEqual([
      { filename: "odm_orthophoto.tif", version: 2 },
      { filename: "imported_ortho.tif", version: 1 },
    ])
  })
})
