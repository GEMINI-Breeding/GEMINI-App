import { describe, expect, it } from "vitest"

import type { ComputePart } from "@/features/agent/lib/agentApi"
import { workerLine } from "./LabelingWorker"

const part = (over: Partial<ComputePart>): ComputePart =>
  ({
    name: "ml",
    label: "Models and traits",
    does: "",
    job_types: ["LOCATE_PLANTS"],
    state: "stopped",
    where: "auto",
    options: [],
    resources: "",
    jobs_waiting: 0,
    jobs_running: 0,
    busy: null,
    last: null,
    ...over,
  }) as ComputePart

describe("workerLine", () => {
  it("is ready only when the worker runs", () => {
    expect(
      workerLine(part({ state: "running", node: "gpu-1" }), null),
    ).toMatchObject({
      ready: true,
      tone: "ok",
    })
    expect(workerLine(part({ state: "stopped" }), null).ready).toBe(false)
  })
  it("says why a queued worker waits", () => {
    expect(
      workerLine(part({ state: "queued", reason: "Priority" }), null).text,
    ).toContain("Slurm: Priority")
  })
  it("reports a lost link before anything else", () => {
    expect(workerLine(part({ state: "running" }), "tunnel down").tone).toBe(
      "bad",
    )
  })
})
