import { describe, expect, it } from "vitest"
import type { JobOutput } from "@/client"
import {
  flightDir,
  otherRuns,
  recountable,
  recountParams,
} from "./recountThreshold"

const out = (date: string) =>
  `Processed/2026/E/Davis/Cowpea/${date}/Drone/RGB/PlotImages/inference/all-plots-1.json`
const job = (
  id: string,
  date: string,
  extra: Record<string, unknown> = {},
  more: Partial<JobOutput> = {},
): JobOutput =>
  ({
    id,
    job_type: "LOCATE_PLANTS",
    status: "COMPLETED",
    experiment_id: "exp1",
    created_at: `2026-11-01T0${id.length}:00:00`,
    parameters: {
      images_prefix: "x/",
      output_predictions_path: out(date),
      count_label: "Pods",
      source: "local_weights",
      weights_path: "Models/weights/pod.pt",
      task_type: "detection",
      api_key: "secret",
      ...extra,
    },
    ...more,
  }) as JobOutput

describe("saving a run's threshold", () => {
  it("knows the flight of a run", () => {
    expect(flightDir(out("2026-08-24"))).toBe(
      "Processed/2026/E/Davis/Cowpea/2026-08-24/Drone/RGB/",
    )
  })

  it("finds the same model's latest run on each other date", () => {
    const here = job("a", "2026-08-24")
    const all = [
      here,
      job("b", "2026-08-31"),
      job("bb", "2026-08-31"), // newer run of the same date
      job("c", "2026-08-17", { count_label: "Other model" }),
      job("d", "2026-08-10", {}, { experiment_id: "exp2" }),
      job("e", "2026-08-03", {}, { status: "FAILED" }),
      job("f", "2026-08-24"), // same date as this one
    ]
    expect(otherRuns(here, all).map((j) => j.id)).toEqual(["bb"])
  })

  it("leaves out classification runs", () => {
    expect(
      recountable(job("a", "2026-08-24", { task_type: "classification" })),
    ).toBe(false)
  })

  it("recounts with the run's predictions and label, never its keys", () => {
    const p = recountParams(job("a", "2026-08-24"), 0.456, { features: [] })
    expect(p).toMatchObject({
      recount: true,
      recount_of: "a",
      output_predictions_path: out("2026-08-24"),
      confidence_threshold: 0.46,
      count_label: "Pods",
      weights_path: "Models/weights/pod.pt",
    })
    expect(p.api_key).toBeUndefined()
  })
})
