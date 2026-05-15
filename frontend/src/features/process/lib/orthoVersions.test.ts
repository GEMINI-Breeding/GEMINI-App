import { describe, expect, it } from "vitest"

import type { FileMetadata } from "@/client"

import {
  buildOrthoVersions,
  isOrthoTif,
  mergeOrthoVersionFromJobResult,
  type OrthoVersionMeta,
} from "./orthoVersions"
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

function makeRun(
  versions: Array<{
    filename: string
    label?: string
    source: "RUN_ODM" | "imported"
    createdAt: string
    jobId?: string
  }>,
): Run {
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
    const out = buildOrthoVersions(undefined, scope, [
      file("odm_orthophoto.tif"),
    ])
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

  it("synthesizes one entry per `odm_orthophoto-{jobId}.tif` on disk", () => {
    // Two RUN_ODM runs in this scope's folder, neither yet recorded in
    // run metadata (e.g., page just reloaded after the second run). Both
    // should surface as separate versions, newest first.
    const out = buildOrthoVersions(undefined, scope, [
      file("odm_orthophoto-job-A.tif", "2026-04-28T10:00:00.000Z"),
      file("odm_orthophoto-job-B.tif", "2026-04-28T12:00:00.000Z"),
    ])
    expect(
      out.map((v) => ({ filename: v.filename, version: v.version })),
    ).toEqual([
      { filename: "odm_orthophoto-job-B.tif", version: 2 },
      { filename: "odm_orthophoto-job-A.tif", version: 1 },
    ])
  })

  it("attaches per-version COG flags for versioned filenames", () => {
    const out = buildOrthoVersions(undefined, scope, [
      file("odm_orthophoto-job-A.tif", "2026-04-28T10:00:00.000Z"),
      file("odm_orthophoto-job-A-Pyramid.tif"),
      file("odm_orthophoto-job-B.tif", "2026-04-28T12:00:00.000Z"),
    ])
    const aEntry = out.find((v) => v.filename === "odm_orthophoto-job-A.tif")
    const bEntry = out.find((v) => v.filename === "odm_orthophoto-job-B.tif")
    expect(aEntry?.hasCog).toBe(true)
    expect(bEntry?.hasCog).toBe(false)
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
    expect(
      out.map((v) => ({ filename: v.filename, version: v.version })),
    ).toEqual([
      { filename: "odm_orthophoto.tif", version: 2 },
      { filename: "imported_ortho.tif", version: 1 },
    ])
  })
})

describe("mergeOrthoVersionFromJobResult", () => {
  const baseJob = {
    id: "job-A",
    completed_at: "2026-04-28T12:00:00.000Z",
    result: {
      orthophoto_path:
        "Processed/2026/GEMINI/Davis/Cowpea/2026-04-28/Drone/RGB/odm_orthophoto-job-A.tif",
      image_count: 42,
    },
  }

  it("appends a RUN_ODM meta entry derived from the job result", () => {
    const merged = mergeOrthoVersionFromJobResult([], baseJob)
    expect(merged).not.toBeNull()
    expect(merged).toHaveLength(1)
    expect(merged?.[0]).toMatchObject({
      filename: "odm_orthophoto-job-A.tif",
      source: "RUN_ODM",
      jobId: "job-A",
      createdAt: "2026-04-28T12:00:00.000Z",
    })
    expect(merged?.[0].path).toBe(
      "gemini/Processed/2026/GEMINI/Davis/Cowpea/2026-04-28/Drone/RGB/odm_orthophoto-job-A.tif",
    )
  })

  it("is idempotent on jobId — duplicate call returns null", () => {
    const first = mergeOrthoVersionFromJobResult([], baseJob)
    expect(first).not.toBeNull()
    const second = mergeOrthoVersionFromJobResult(
      first as OrthoVersionMeta[],
      baseJob,
    )
    expect(second).toBeNull()
  })

  it("returns null when the job has no orthophoto_path", () => {
    expect(
      mergeOrthoVersionFromJobResult([], {
        id: "job-X",
        result: { image_count: 0 },
      }),
    ).toBeNull()
    expect(
      mergeOrthoVersionFromJobResult([], { id: "job-Y", result: null }),
    ).toBeNull()
    expect(mergeOrthoVersionFromJobResult([], null)).toBeNull()
  })

  it("preserves existing entries when appending", () => {
    const existing: OrthoVersionMeta[] = [
      {
        filename: "odm_orthophoto-job-old.tif",
        source: "RUN_ODM",
        jobId: "job-old",
        createdAt: "2026-04-28T08:00:00.000Z",
      },
    ]
    const merged = mergeOrthoVersionFromJobResult(existing, baseJob)
    expect(merged).toHaveLength(2)
    expect(merged?.[0].jobId).toBe("job-old")
    expect(merged?.[1].jobId).toBe("job-A")
  })
})
