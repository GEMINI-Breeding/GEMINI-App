import { describe, expect, it } from "vitest"

import {
  type NavStatus,
  type NavStep,
  nextLockReason,
  waitingOn,
} from "@/features/process/lib/stepNav"

const STEPS: NavStep[] = [
  { key: "data_sync", label: "Data Sync", kind: "compute" },
  { key: "image_review", label: "Image Exclusion", kind: "optional" },
  { key: "orthomosaic", label: "Orthomosaic", kind: "compute" },
  { key: "plot_boundary_prep", label: "Boundaries", kind: "interactive" },
  {
    key: "trait_extraction",
    label: "Traits",
    kind: "compute",
    needs: ["orthomosaic", "plot_boundary_prep"],
  },
]

describe("nextLockReason", () => {
  it("opens the next step once a step is done or skipped", () => {
    expect(nextLockReason(STEPS[2], "completed")).toBeNull()
    expect(nextLockReason(STEPS[1], "skipped")).toBeNull()
  })
  it("says what is left to do", () => {
    expect(nextLockReason(STEPS[3], "ready")).toMatch(/save and activate/)
    expect(nextLockReason(STEPS[1], "ready")).toMatch(/skip/)
    expect(nextLockReason(STEPS[2], "running")).toMatch(/running/)
    expect(nextLockReason(STEPS[2], "failed")).toMatch(/failed/)
  })
})

describe("waitingOn", () => {
  const status: Record<string, NavStatus> = {
    data_sync: "completed",
    image_review: "ready",
    orthomosaic: "completed",
    plot_boundary_prep: "ready",
  }
  const of = (k: string) => status[k] ?? "locked"
  it("lists the unfinished required steps before it", () => {
    expect(waitingOn(STEPS, "trait_extraction", of)).toEqual(["Boundaries"])
    // Optional steps never hold a later step back.
    expect(waitingOn(STEPS, "orthomosaic", of)).toEqual([])
  })
})
