/**
 * runApi tests. Real runStore (it's an in-memory module store with a
 * reset hook); JobsService mocked at the module level so we can assert
 * the exact request bodies submitted per step type.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { JobOutput } from "@/client"

import type { AerialScope } from "@/features/process/lib/paths"

import {
  type ExecuteStepInput,
  executeStep,
  markStepComplete,
  markStepSkipped,
  stopStep,
} from "./runApi"
import {
  __resetRunStoreForTests,
  appendStepJobId,
  createPipeline,
  createRun,
  createWorkspace,
  getRun,
  type Run,
} from "./runStore"

const submitMock = vi.fn()
const cancelMock = vi.fn()
vi.mock("@/client", () => ({
  JobsService: {
    apiJobsSubmitSubmitJob: (data: unknown) => submitMock(data),
    apiJobsJobIdCancelCancelJob: (data: unknown) => cancelMock(data),
  },
  // OpenAPI is read by thermalGpsPreflight to build the rest-api URL.
  // Stub with an empty BASE so the preflight's relative fetch path
  // ("/api/files/download/...") falls back to whatever vi.stubGlobal
  // assigns to `fetch`.
  OpenAPI: { BASE: "" },
}))

const SCOPE: AerialScope = {
  year: "2026",
  experiment: "GEMINI",
  location: "Davis",
  population: "Cowpea",
  date: "2026-04-29",
  platform: "Drone",
  sensor: "RGB",
}

function seedRun(): Run {
  const ws = createWorkspace({
    name: "W",
    experimentId: "exp-uuid",
    defaultScope: {
      experimentId: "exp-uuid",
      seasonId: null,
      siteId: null,
      populationId: null,
    },
  })
  const p = createPipeline({
    workspaceId: ws.id,
    name: "P",
    type: "aerial",
    params: {},
  })
  const r = createRun({
    pipelineId: p.id,
    scope: ws.defaultScope ?? {
      experimentId: "exp-uuid",
      seasonId: null,
      siteId: null,
      populationId: null,
    },
  })
  return r
}

const SHORT_ID = "a2f31b04"

function baseInput(run: Run, stepKey: string): ExecuteStepInput {
  return {
    runId: run.id,
    stepKey,
    scope: SCOPE,
    // Single dataset selected by default — orthomosaic preflight runs
    // exactly one fetch against the short-id's per-dataset summary.
    // Tests covering the "all datasets" no-preflight branch override
    // this to [].
    datasetShortIds: [SHORT_ID],
    experimentId: "exp-uuid",
  }
}

beforeEach(() => {
  localStorage.clear()
  __resetRunStoreForTests()
  submitMock.mockReset()
  cancelMock.mockReset()
  // Orthomosaic step calls checkThermalGpsPreflight, which fetches
  // RawThermal/thermal_dataset.json from the rest API. Default to 404
  // (non-thermal dataset) so existing tests keep submitting without
  // having to mock fetch themselves. Thermal-specific tests below
  // override this with their own stub.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(null, { status: 404 }))),
  )
})

describe("executeStep", () => {
  describe("data_sync", () => {
    it("flips the step to completed without submitting a job", async () => {
      const run = seedRun()
      const result = await executeStep(baseInput(run, "data_sync"))
      expect(result).toEqual({ jobId: null, done: true })
      expect(submitMock).not.toHaveBeenCalled()
      expect(getRun(run.id)?.steps.data_sync?.status).toBe("completed")
    })
  })

  describe("gcp_selection (skip path)", () => {
    it("flips the step to skipped without submitting a job", async () => {
      const run = seedRun()
      const result = await executeStep(baseInput(run, "gcp_selection"))
      expect(result).toEqual({ jobId: null, done: true })
      expect(submitMock).not.toHaveBeenCalled()
      expect(getRun(run.id)?.steps.gcp_selection?.status).toBe("skipped")
    })
  })

  describe("orthomosaic", () => {
    it("submits RUN_ODM with the scope flattened into parameters", async () => {
      const run = seedRun()
      submitMock.mockResolvedValue({
        id: "ortho-job-1",
      } as unknown as JobOutput)
      const result = await executeStep({
        ...baseInput(run, "orthomosaic"),
        orthomosaic: {
          reconstruction_quality: "High Quality",
          custom_options: "--fast",
        },
      })
      expect(submitMock).toHaveBeenCalledOnce()
      const call = submitMock.mock.calls[0][0] as {
        requestBody: { parameters: Record<string, unknown> }
      }
      expect(call.requestBody.parameters).toMatchObject({
        year: "2026",
        experiment: "GEMINI",
        location: "Davis",
        population: "Cowpea",
        date: "2026-04-29",
        platform: "Drone",
        sensor: "RGB",
        dataset_short_ids: [SHORT_ID],
        reconstruction_quality: "High Quality",
        custom_options: "--fast",
      })
      expect(result).toEqual({ jobId: "ortho-job-1", done: false })
      const updated = getRun(run.id)
      expect(updated?.steps.orthomosaic?.jobIds).toEqual(["ortho-job-1"])
      expect(updated?.status).toBe("running")
    })

    it("omits optional knobs when not provided", async () => {
      const run = seedRun()
      submitMock.mockResolvedValue({
        id: "ortho-job-2",
      } as unknown as JobOutput)
      await executeStep(baseInput(run, "orthomosaic"))
      const call = submitMock.mock.calls[0][0] as {
        requestBody: { parameters: Record<string, unknown> }
      }
      expect(call.requestBody.parameters).not.toHaveProperty(
        "reconstruction_quality",
      )
      expect(call.requestBody.parameters).not.toHaveProperty("custom_options")
    })

    it("omits dataset_short_ids and skips preflight when 'all datasets' (empty list)", async () => {
      // Empty list = "all datasets at this scope"; worker recurses
      // the scope root. No canonical short-id to preflight against,
      // so the thermal sidecar fetch is skipped entirely.
      const run = seedRun()
      const fetchSpy = vi.fn(() =>
        Promise.resolve(new Response(null, { status: 404 })),
      )
      vi.stubGlobal("fetch", fetchSpy)
      submitMock.mockResolvedValue({
        id: "ortho-all",
      } as unknown as JobOutput)
      await executeStep({
        ...baseInput(run, "orthomosaic"),
        datasetShortIds: [],
      })
      expect(fetchSpy).not.toHaveBeenCalled()
      const call = submitMock.mock.calls[0][0] as {
        requestBody: { parameters: Record<string, unknown> }
      }
      expect(call.requestBody.parameters).not.toHaveProperty(
        "dataset_short_ids",
      )
    })

    it("throws when the SDK returns no job id", async () => {
      const run = seedRun()
      submitMock.mockResolvedValue({ id: null } as unknown as JobOutput)
      await expect(executeStep(baseInput(run, "orthomosaic"))).rejects.toThrow(
        /RUN_ODM submitted but no job id returned/i,
      )
    })

    it("refuses to submit when the thermal preflight reports missing GPS", async () => {
      const run = seedRun()
      // Override the default 404 fetch stub with a thermal summary
      // that has no per-image GPS — the worker-side contract for a
      // Boson-class dataset.
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                mode: "boson_tlinear_high",
                has_gps: false,
                total_files: 11,
              }),
            ),
          ),
        ),
      )
      submitMock.mockResolvedValue({
        id: "should-not-be-submitted",
      } as unknown as JobOutput)

      // The preflight throws a typed ThermalGpsRequiredError so the
      // RunDetail handler can route it to a modal dialog rather than
      // a toast.
      await expect(
        executeStep(baseInput(run, "orthomosaic")),
      ).rejects.toThrow(/no per-image GPS/i)
      expect(submitMock).not.toHaveBeenCalled()
    })

    it("auto-applies the Standard preset for thermal datasets with GPS", async () => {
      // Radiometric thermal previews are low-contrast; pushing them
      // to High Quality / Ultra over-detects features. Auto-pick
      // Standard when the caller didn't pass an explicit preset.
      const run = seedRun()
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                mode: "flir_one_pro",
                has_gps: true,
                total_files: 22,
              }),
            ),
          ),
        ),
      )
      submitMock.mockResolvedValue({
        id: "ortho-thermal-1",
      } as unknown as JobOutput)
      await executeStep(baseInput(run, "orthomosaic"))
      const call = submitMock.mock.calls[0][0] as {
        requestBody: { parameters: Record<string, unknown> }
      }
      expect(call.requestBody.parameters.reconstruction_quality).toBe(
        "Standard",
      )
    })

    it("sends skip_gcps=true when the gcp_selection step was skipped", async () => {
      // The "Skip" affordance in the GcpPicker sets the step to
      // status="skipped" in the run store. Without forwarding that
      // state to the worker, any gcp_list.txt / geo.txt left in MinIO
      // from a prior session silently re-applies — the worker auto-
      // sniffs the scope root for sidecars. The user reasonably
      // expects "Skip" to mean "no GCPs this run."
      const run = seedRun()
      // Run the gcp_selection skip path so the step status flips.
      await executeStep(baseInput(run, "gcp_selection"))
      submitMock.mockResolvedValue({
        id: "ortho-no-gcps",
      } as unknown as JobOutput)
      await executeStep(baseInput(run, "orthomosaic"))
      const call = submitMock.mock.calls[0][0] as {
        requestBody: { parameters: Record<string, unknown> }
      }
      expect(call.requestBody.parameters.skip_gcps).toBe(true)
    })

    it("omits skip_gcps when the gcp_selection step was not skipped", async () => {
      const run = seedRun()
      // Don't touch gcp_selection — its status stays "pending".
      submitMock.mockResolvedValue({
        id: "ortho-with-gcps",
      } as unknown as JobOutput)
      await executeStep(baseInput(run, "orthomosaic"))
      const call = submitMock.mock.calls[0][0] as {
        requestBody: { parameters: Record<string, unknown> }
      }
      expect(call.requestBody.parameters).not.toHaveProperty("skip_gcps")
    })

    it("respects an explicit reconstruction_quality even for thermal", async () => {
      const run = seedRun()
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve(
            new Response(
              JSON.stringify({ mode: "flir_one_pro", has_gps: true }),
            ),
          ),
        ),
      )
      submitMock.mockResolvedValue({ id: "j" } as unknown as JobOutput)
      await executeStep({
        ...baseInput(run, "orthomosaic"),
        orthomosaic: { reconstruction_quality: "Ultra" },
      })
      const call = submitMock.mock.calls[0][0] as {
        requestBody: { parameters: Record<string, unknown> }
      }
      expect(call.requestBody.parameters.reconstruction_quality).toBe(
        "Ultra",
      )
    })
  })

  describe("trait_extraction", () => {
    it("requires the trait params shape", async () => {
      const run = seedRun()
      await expect(
        executeStep(baseInput(run, "trait_extraction")),
      ).rejects.toThrow(/trait_extraction requires/i)
    })

    it("submits EXTRACT_TRAITS with the chosen ortho + boundary paths", async () => {
      const run = seedRun()
      submitMock.mockResolvedValue({
        id: "trait-job-1",
      } as unknown as JobOutput)
      await executeStep({
        ...baseInput(run, "trait_extraction"),
        traitExtraction: {
          orthomosaicPath: "Processed/.../odm.tif",
          boundaryGeojsonPath: "Processed/.../boundary.geojson",
          outputTraitsGeojsonPath: "Processed/.../traits.geojson",
          demPath: "Processed/.../dem.tif",
          exgThreshold: 0.18,
        },
      })
      const call = submitMock.mock.calls[0][0] as {
        requestBody: { job_type: string; parameters: Record<string, unknown> }
      }
      expect(call.requestBody.job_type).toBe("EXTRACT_TRAITS")
      expect(call.requestBody.parameters).toEqual({
        orthomosaic_path: "Processed/.../odm.tif",
        boundary_geojson_path: "Processed/.../boundary.geojson",
        output_traits_geojson_path: "Processed/.../traits.geojson",
        dem_path: "Processed/.../dem.tif",
        exg_threshold: 0.18,
      })
      expect(getRun(run.id)?.steps.trait_extraction?.jobIds).toEqual([
        "trait-job-1",
      ])
    })
  })

  describe("stitching", () => {
    it("rejects fewer than 2 images", async () => {
      const run = seedRun()
      await expect(
        executeStep({
          ...baseInput(run, "stitching"),
          stitching: {
            imagePaths: ["only-one.jpg"],
            outputMosaicPath: "Processed/mosaic.tif",
          },
        }),
      ).rejects.toThrow(/at least 2 images/i)
    })

    it("requires the stitching params shape", async () => {
      const run = seedRun()
      await expect(executeStep(baseInput(run, "stitching"))).rejects.toThrow(
        /stitching requires/i,
      )
    })

    it("submits RUN_STITCH with config + cpu_count when supplied", async () => {
      const run = seedRun()
      submitMock.mockResolvedValue({
        id: "stitch-job-1",
      } as unknown as JobOutput)
      await executeStep({
        ...baseInput(run, "stitching"),
        stitching: {
          imagePaths: ["a.jpg", "b.jpg", "c.jpg"],
          outputMosaicPath: "Processed/mosaic.tif",
          config: { stitching_direction: "RIGHT" },
          cpuCount: 4,
        },
      })
      const call = submitMock.mock.calls[0][0] as {
        requestBody: { parameters: Record<string, unknown> }
      }
      expect(call.requestBody.parameters).toMatchObject({
        image_paths: ["a.jpg", "b.jpg", "c.jpg"],
        output_mosaic_path: "Processed/mosaic.tif",
        config: { stitching_direction: "RIGHT" },
        cpu_count: 4,
      })
    })
  })

  describe("associate_boundaries (no-op)", () => {
    it("flips the step to completed with synthetic outputs and no job", async () => {
      const run = seedRun()
      const result = await executeStep(baseInput(run, "associate_boundaries"))
      expect(result).toEqual({ jobId: null, done: true })
      expect(submitMock).not.toHaveBeenCalled()
      const ab = getRun(run.id)?.steps.associate_boundaries
      expect(ab?.status).toBe("completed")
      expect(ab?.outputs).toMatchObject({ synthetic: true })
    })
  })

  describe("inference", () => {
    it("requires the inference params shape", async () => {
      const run = seedRun()
      await expect(executeStep(baseInput(run, "inference"))).rejects.toThrow(
        /inference requires/i,
      )
    })

    it("submits LOCATE_PLANTS with thresholds when supplied", async () => {
      const run = seedRun()
      submitMock.mockResolvedValue({
        id: "infer-job-1",
      } as unknown as JobOutput)
      await executeStep({
        ...baseInput(run, "inference"),
        inference: {
          imagePath: "Processed/img.png",
          apiKey: "rf_test",
          modelId: "ws/model/3",
          outputPredictionsPath: "Processed/preds.json",
          confidenceThreshold: 0.4,
          iouThreshold: 0.6,
        },
      })
      const call = submitMock.mock.calls[0][0] as {
        requestBody: { job_type: string; parameters: Record<string, unknown> }
      }
      expect(call.requestBody.job_type).toBe("LOCATE_PLANTS")
      expect(call.requestBody.parameters).toEqual({
        image_path: "Processed/img.png",
        api_key: "rf_test",
        model_id: "ws/model/3",
        output_predictions_path: "Processed/preds.json",
        confidence_threshold: 0.4,
        iou_threshold: 0.6,
      })
    })
  })

  describe("unknown step", () => {
    it("throws a not-yet-wired error", async () => {
      const run = seedRun()
      await expect(executeStep(baseInput(run, "made_up_step"))).rejects.toThrow(
        /not yet wired/i,
      )
    })
  })
})

describe("stopStep", () => {
  it("does nothing when the run is missing", async () => {
    await expect(stopStep("not-a-run", "orthomosaic")).resolves.toBeUndefined()
    expect(cancelMock).not.toHaveBeenCalled()
  })

  it("does nothing when the step has no jobIds", async () => {
    const run = seedRun()
    await stopStep(run.id, "orthomosaic")
    expect(cancelMock).not.toHaveBeenCalled()
  })

  it("cancels every job and flips the step to failed", async () => {
    const run = seedRun()
    appendStepJobId(run.id, "orthomosaic", "j1")
    appendStepJobId(run.id, "orthomosaic", "j2")
    cancelMock.mockResolvedValue({} as never)
    await stopStep(run.id, "orthomosaic")
    expect(cancelMock).toHaveBeenCalledTimes(2)
    expect(cancelMock).toHaveBeenNthCalledWith(1, { jobId: "j1" })
    expect(cancelMock).toHaveBeenNthCalledWith(2, { jobId: "j2" })
    const step = getRun(run.id)?.steps.orthomosaic
    expect(step?.status).toBe("failed")
    expect(step?.error).toBe("Cancelled")
  })

  it("survives a per-job cancel error and still flips the step", async () => {
    const run = seedRun()
    appendStepJobId(run.id, "orthomosaic", "j1")
    cancelMock.mockRejectedValue(new Error("already terminal"))
    await stopStep(run.id, "orthomosaic")
    expect(getRun(run.id)?.steps.orthomosaic?.status).toBe("failed")
  })
})

describe("markStepComplete + markStepSkipped", () => {
  it("markStepComplete writes status=completed", () => {
    const run = seedRun()
    markStepComplete(run.id, "data_sync")
    expect(getRun(run.id)?.steps.data_sync?.status).toBe("completed")
  })

  it("markStepSkipped writes status=skipped", () => {
    const run = seedRun()
    markStepSkipped(run.id, "gcp_selection")
    expect(getRun(run.id)?.steps.gcp_selection?.status).toBe("skipped")
  })
})
