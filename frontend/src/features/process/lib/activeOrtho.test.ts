import { describe, expect, it } from "vitest"

import type { FileMetadata } from "@/client"

import {
  buildTitilerTileUrl,
  resolveActiveOrtho,
  s3UrlForOrtho,
  tilejsonBoundsToLeaflet,
} from "./activeOrtho"
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
    expect(
      resolveActiveOrtho(makeRun(), null, [file("odm_orthophoto.tif")]),
    ).toBeNull()
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
    expect(s3UrlForOrtho(v)).toBe(
      "s3://gemini/Raw/foo/Orthomosaic/ortho-Pyramid.tif",
    )
  })
})

describe("buildTitilerTileUrl", () => {
  it("produces the standard XYZ template", () => {
    const url = buildTitilerTileUrl(
      "s3://gemini/Processed/foo/odm_orthophoto.tif",
    )
    expect(url).toContain("/titiler/cog/tiles/WebMercatorQuad/{z}/{x}/{y}")
    expect(url).toContain("tilesize=256")
  })

  it("encodes spaces in the s3 URL as %20, not +", () => {
    // Regression: TiTiler 2.0.1's tilejson `tiles[0]` template uses `+`
    // for spaces in the s3 URL (form-encoded query convention). When
    // the browser round-trips that URL, S3 receives literal `+` rather
    // than spaces and 404s on object keys with spaces (e.g. real-world
    // population names like "Cowpea MAGIC"). buildTitilerTileUrl uses
    // encodeURIComponent which always emits %20, which S3 decodes
    // correctly. Asserting the encoded form here means a regression
    // that reverts to tilejson's `tiles[0]` will fail this test
    // without needing an end-to-end round trip.
    const url = buildTitilerTileUrl(
      "s3://gemini/Processed/2026/Davis/Cowpea MAGIC/odm_orthophoto.tif",
    )
    expect(url).toContain("Cowpea%20MAGIC")
    expect(url).not.toContain("Cowpea+MAGIC")
  })

  it("encodes other reserved characters consistently", () => {
    const url = buildTitilerTileUrl(
      "s3://gemini/Processed/path/with#hash & ampersand.tif",
    )
    // # would terminate URL parsing; & would split the query.
    expect(url).toContain(encodeURIComponent("#"))
    expect(url).toContain(encodeURIComponent("&"))
  })
})

describe("tilejsonBoundsToLeaflet", () => {
  it("reshapes [w,s,e,n] into [[s,w],[n,e]]", () => {
    expect(tilejsonBoundsToLeaflet([-121.7, 38.4, -121.6, 38.5])).toEqual([
      [38.4, -121.7],
      [38.5, -121.6],
    ])
  })
})
