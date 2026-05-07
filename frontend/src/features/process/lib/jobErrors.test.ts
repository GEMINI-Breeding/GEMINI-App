import { describe, expect, it } from "vitest"

import { humanizeJobError } from "./jobErrors"

const NO_BOUNDARY =
  "S3 operation failed; code: NoSuchKey, message: Object does not exist, " +
  "resource: /gemini/Processed/2026/GEMINI/Davis/Cowpea MAGIC/2026-03-04/" +
  "drone/iPhone/plot-boundaries/v1.geojson, request_id: 18A, host_id: dd, " +
  "bucket_name: gemini, " +
  "object_name: Processed/2026/GEMINI/Davis/Cowpea MAGIC/2026-03-04/drone/" +
  "iPhone/plot-boundaries/v1.geojson"

const NO_ORTHO =
  "S3 operation failed; code: NoSuchKey, message: Object does not exist, " +
  "object_name: Processed/2026/X/Y/Z/2026-03-04/drone/RGB/odm_orthophoto.tif"

const NO_DEM =
  "S3 NoSuchKey: object_name: Processed/2026/X/Y/Z/2026-03-04/drone/RGB/dem.tif"

describe("humanizeJobError", () => {
  it("handles empty / missing input", () => {
    expect(humanizeJobError("trait_extraction", "")).toMatchObject({
      headline: expect.stringMatching(/without a recorded reason/i),
      details: "",
    })
    expect(humanizeJobError("trait_extraction", undefined).headline).toMatch(
      /without a recorded reason/i,
    )
  })

  it("recognizes missing plot-boundary file", () => {
    const r = humanizeJobError("trait_extraction", NO_BOUNDARY)
    expect(r.headline).toMatch(/plot-boundary file is missing/i)
    expect(r.hint).toMatch(/plot boundary prep/i)
    expect(r.details).toBe(NO_BOUNDARY)
  })

  it("recognizes missing orthomosaic", () => {
    const r = humanizeJobError("trait_extraction", NO_ORTHO)
    expect(r.headline).toMatch(/orthomosaic file is missing/i)
    expect(r.hint).toMatch(/orthomosaic step/i)
  })

  it("recognizes missing DEM", () => {
    const r = humanizeJobError("trait_extraction", NO_DEM)
    expect(r.headline).toMatch(/dem .*is missing/i)
  })

  it("falls back to generic NoSuchKey copy with the file name", () => {
    const r = humanizeJobError(
      "trait_extraction",
      "S3 NoSuchKey object_name: Processed/foo/bar/something_unexpected.tif",
    )
    expect(r.headline).toMatch(/required file is missing/i)
    expect(r.headline).toContain("something_unexpected.tif")
  })

  it("recognizes AgRowStitch not vendored", () => {
    const r = humanizeJobError(
      "stitching",
      "AgRowStitch is not importable inside the worker. ...",
    )
    expect(r.headline).toMatch(/stitching is not available/i)
    expect(r.hint).toMatch(/vendored/i)
  })

  it("recognizes Roboflow 401 (bad API key)", () => {
    const r = humanizeJobError(
      "inference",
      "Roboflow API returned 401 Unauthorized for model 'foo/bar'. Check your API key.",
    )
    expect(r.headline).toMatch(/roboflow rejected the api key/i)
    expect(r.hint).toMatch(/api key/i)
  })

  it("recognizes Roboflow 404 (bad model id)", () => {
    const r = humanizeJobError(
      "inference",
      "Roboflow model 'foo/bar' not found (404). Check the model ID.",
    )
    expect(r.headline).toMatch(/could not find that model/i)
    expect(r.hint).toMatch(/model id/i)
  })

  it("falls back to a generic Roboflow message for other Roboflow errors", () => {
    const r = humanizeJobError(
      "inference",
      "Roboflow returned an empty body (status 502).",
    )
    expect(r.headline).toMatch(/roboflow inference failed/i)
  })

  it("uses the step name in the generic fallback", () => {
    expect(
      humanizeJobError("trait_extraction", "TypeError: blah").headline,
    ).toMatch(/^trait extraction failed/i)
    expect(humanizeJobError("orthomosaic", "blah").headline).toMatch(
      /^orthomosaic failed/i,
    )
    expect(humanizeJobError("stitching", "blah").headline).toMatch(
      /^stitching failed/i,
    )
    expect(humanizeJobError("unknown", "blah").headline).toMatch(
      /^this step failed/i,
    )
  })

  it("always returns the raw details unchanged for the disclosure", () => {
    const raw = "S3 NoSuchKey: object_name: foo/bar/v1.geojson"
    expect(humanizeJobError("trait_extraction", raw).details).toBe(raw)
  })

  // ── Orthomosaic / ODM diagnostics ─────────────────────────────────────
  // The exact strings here mirror what the ODM worker's
  // _diagnose_odm_failure helper produces. Keep them in sync if the
  // backend wording changes, or these will drift silently.

  it("recognizes the OpenMVS-zero-images preset failure (the bug that motivated this)", () => {
    const raw =
      "ODM processing failed: Cannot process dataset — likely cause: " +
      "OpenMVS rejected every image during dense reconstruction — " +
      "the quality preset is likely too aggressive for this dataset. " +
      "Retry with a higher Reconstruction quality (e.g. Low or Medium " +
      "instead of Lowest)\n" +
      "Full ODM log: gemini/Processed/2026/X/Y/Z/2026-05-04/Drone/RGB/odm_log.txt"
    const r = humanizeJobError("orthomosaic", raw)
    expect(r.headline).toMatch(/quality preset too aggressive/i)
    expect(r.hint).toMatch(/low or medium/i)
    expect(r.details).toBe(raw)
  })

  it("recognizes the depth-map OOM failure", () => {
    const raw =
      "ODM processing failed: Cannot process dataset — likely cause: " +
      "out-of-memory during depth-map fusion. The OpenMVS step needs..."
    const r = humanizeJobError("orthomosaic", raw)
    expect(r.headline).toMatch(/not enough memory/i)
    expect(r.hint).toMatch(/16 ?GiB|Docker/i)
  })

  it("recognizes NodeODM-out-of-disk", () => {
    const raw =
      "ODM processing failed: Cannot process dataset — likely cause: " +
      "NodeODM ran out of disk space. Free space on the Docker volume..."
    const r = humanizeJobError("orthomosaic", raw)
    expect(r.headline).toMatch(/out of disk space/i)
    expect(r.hint).toMatch(/NodeODM admin UI|prune/i)
  })

  it("recognizes not-enough-overlap / no-image-match failures", () => {
    const raw1 =
      "ODM processing failed: ... — likely cause: " +
      "not enough overlapping features between images. ODM needs ~80%..."
    expect(humanizeJobError("orthomosaic", raw1).headline).toMatch(
      /couldn't reconstruct/i,
    )
    const raw2 =
      "ODM processing failed: ... — likely cause: " +
      "ODM couldn't match any image pairs. Common causes: missing/wrong EXIF GPS..."
    expect(humanizeJobError("orthomosaic", raw2).hint).toMatch(/EXIF/i)
  })

  it("recognizes bad-EXIF / negative-GSD failures", () => {
    const raw =
      "ODM processing failed: Cannot process dataset — likely cause: " +
      "ODM couldn't establish a valid scene from the input EXIF " +
      "(negative GSD + unbounded scene). Verify image orientation..."
    const r = humanizeJobError("orthomosaic", raw)
    expect(r.headline).toMatch(/metadata looks invalid/i)
    expect(r.hint).toMatch(/EXIF|metadata/i)
  })

  it("falls back with the saved-log path when no ODM pattern matches", () => {
    // Worker hits an unfamiliar failure and the diagnose helper returns
    // empty. The new behavior: error_message still includes the MinIO log
    // path, and the FE pulls it into the hint.
    const raw =
      "ODM processing failed: Cannot process dataset. The failure " +
      "signature isn't one we recognize automatically — check the saved " +
      "log for the underlying error.\n" +
      "Full ODM log: gemini/Processed/2026/X/Y/Z/2026-05-04/Drone/RGB/odm_log.txt"
    const r = humanizeJobError("orthomosaic", raw)
    expect(r.headline).toMatch(/^orthomosaic failed/i)
    expect(r.hint).toContain(
      "gemini/Processed/2026/X/Y/Z/2026-05-04/Drone/RGB/odm_log.txt",
    )
  })

  it("falls back without a log path when the worker didn't include one", () => {
    // Defensive: legacy or partial messages where the log path was lost.
    const raw = "ODM processing failed: something obscure happened."
    const r = humanizeJobError("orthomosaic", raw)
    expect(r.headline).toMatch(/^orthomosaic failed/i)
    expect(r.hint).toMatch(/technical details/i)
  })
})
