import { describe, expect, it } from "vitest"

import {
  stoppedWorkerFor,
  workerToAutoStart,
} from "@/features/agent/components/WorkerStartPrompt"
import type {
  ComputeOverview,
  ComputePart,
} from "@/features/agent/lib/agentApi"

const part = (state: ComputePart["state"]): ComputePart => ({
  name: "ml",
  label: "models (ml)",
  does: "",
  job_types: ["EXTRACT_TRAITS"],
  state,
  where: "auto",
  options: [],
  resources: "",
  jobs_waiting: 1,
  jobs_running: 0,
  busy: null,
  last: null,
})
const overview = (
  p: ComputePart,
  more: Partial<ComputeOverview> = {},
): ComputeOverview => ({
  cluster: "farm",
  parts: [p],
  auto_start: false,
  ...more,
})

describe("stoppedWorkerFor", () => {
  it("names the stopped worker a job waits for", () => {
    expect(
      stoppedWorkerFor(overview(part("stopped")), "EXTRACT_TRAITS")?.name,
    ).toBe("ml")
  })
  it("asks nothing when it runs, starts, or starts on its own", () => {
    expect(
      stoppedWorkerFor(overview(part("running")), "EXTRACT_TRAITS"),
    ).toBeNull()
    expect(
      stoppedWorkerFor(overview(part("queued")), "EXTRACT_TRAITS"),
    ).toBeNull()
    expect(
      stoppedWorkerFor(
        overview(part("stopped"), { auto_start: true }),
        "EXTRACT_TRAITS",
      ),
    ).toBeNull()
  })
  it("asks nothing when the cluster can't be reached or no worker takes the job", () => {
    expect(
      stoppedWorkerFor(
        overview(part("stopped"), { error: "down" }),
        "EXTRACT_TRAITS",
      ),
    ).toBeNull()
    expect(stoppedWorkerFor(overview(part("stopped")), "RUN_ODM")).toBeNull()
    expect(stoppedWorkerFor(undefined, "EXTRACT_TRAITS")).toBeNull()
  })
})

describe("workerToAutoStart", () => {
  it("starts the stopped worker right away when the setting is on", () => {
    const on = { auto_start: true }
    expect(
      workerToAutoStart(overview(part("stopped"), on), "EXTRACT_TRAITS")?.name,
    ).toBe("ml")
    expect(
      workerToAutoStart(overview(part("stopped")), "EXTRACT_TRAITS"),
    ).toBeNull()
    expect(
      workerToAutoStart(overview(part("starting"), on), "EXTRACT_TRAITS"),
    ).toBeNull()
    expect(
      workerToAutoStart(
        overview(
          { ...part("stopped"), busy: { action: "starting", since: 1 } },
          on,
        ),
        "EXTRACT_TRAITS",
      ),
    ).toBeNull()
  })
})
