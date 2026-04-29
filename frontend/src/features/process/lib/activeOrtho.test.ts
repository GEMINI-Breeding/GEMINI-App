import { describe, expect, it } from "vitest"

import type { FileMetadata } from "@/client"

import { resolveActiveOrtho, s3UrlForOrtho } from "./activeOrtho"
import type { OrthoVersion } from "./orthoVersions"
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
    createdAt: "2026-04-28T00:00:00.000Z",
    updatedAt: "2026-04-28T00:00:00.000Z",
  } as unknown as Run
}

describe("resolveActiveOrtho", () => {
  it("returns null when no ortho is on disk", () => {
    expect(resolveActiveOrtho(makeRun(), scope, [])).toBeNull()
  })

  it("returns null when scope is null", () => {
    expect(resolveActiveOrtho(makeRun(), null, [file("odm_orthophoto.tif")])).toBeNull()
  })

  it("picks the newest version when multiple exist on disk", () => {
    const files = [
      file("odm_orthophoto.tif", "2026-04-20T00:00:00Z"),
      file("odm_orthophoto-Pyramid.tif", "2026-04-20T00:00:00Z"),
    ]
    const v = resolveActiveOrtho(undefined, scope, files)
    expect(v?.filename).toBe("odm_orthophoto.tif")
    expect(v?.hasCog).toBe(true)
  })
})

describe("s3UrlForOrtho", () => {
  it("rewrites to the -Pyramid sibling when hasCog is true", () => {
    const v: OrthoVersion = {
      version: 1,
      filename: "odm_orthophoto.tif",
      path: "gemini/Processed/2026/GEMINI/Davis/Cowpea/2026-04-28/Drone/RGB/odm_orthophoto.tif",
      label: null,
      source: "RUN_ODM",
      createdAt: null,
      hasCog: true,
    }
    expect(s3UrlForOrtho(v)).toBe(
      "s3://gemini/Processed/2026/GEMINI/Davis/Cowpea/2026-04-28/Drone/RGB/odm_orthophoto-Pyramid.tif",
    )
  })

  it("falls back to the source TIF when no COG exists", () => {
    const v: OrthoVersion = {
      version: 1,
      filename: "odm_orthophoto.tif",
      path: "gemini/Processed/2026/GEMINI/Davis/Cowpea/2026-04-28/Drone/RGB/odm_orthophoto.tif",
      label: null,
      source: "RUN_ODM",
      createdAt: null,
      hasCog: false,
    }
    expect(s3UrlForOrtho(v)).toBe(
      "s3://gemini/Processed/2026/GEMINI/Davis/Cowpea/2026-04-28/Drone/RGB/odm_orthophoto.tif",
    )
  })

  it("handles uppercase .TIFF extensions", () => {
    const v: OrthoVersion = {
      version: 1,
      filename: "ortho.TIFF",
      path: "gemini/Raw/foo/Orthomosaic/ortho.TIFF",
      label: null,
      source: "imported",
      createdAt: null,
      hasCog: true,
    }
    expect(s3UrlForOrtho(v)).toBe("s3://gemini/Raw/foo/Orthomosaic/ortho-Pyramid.tif")
  })
})
