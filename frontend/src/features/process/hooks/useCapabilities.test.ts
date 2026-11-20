import { describe, expect, it } from "vitest"

import { type Capabilities, capabilityWarningForStep } from "./useCapabilities"

const CAPS = (over: Partial<Capabilities> = {}): Capabilities => ({
  agrowstitch: { available: true, path: null },
  odm: { worker: true, nodeodm: true },
  torch_version: null,
  cuda_available: false,
  mps_available: false,
  cpu_count: 12,
  signup_enabled: false,
  ...over,
})

describe("capabilityWarningForStep", () => {
  it("warns on stitching when no stitch worker is running", () => {
    const w = capabilityWarningForStep(
      "stitching",
      CAPS({ agrowstitch: { available: false, path: null } }),
    )
    expect(w).toMatch(/No stitch worker/)
  })

  it("stays silent on stitching when a stitch worker is running", () => {
    expect(capabilityWarningForStep("stitching", CAPS())).toBeUndefined()
  })

  it("warns on orthomosaic without an ODM worker or NodeODM", () => {
    expect(
      capabilityWarningForStep(
        "orthomosaic",
        CAPS({ odm: { worker: false, nodeodm: true } }),
      ),
    ).toMatch(/No ODM worker/)
    expect(
      capabilityWarningForStep(
        "orthomosaic",
        CAPS({ odm: { worker: true, nodeodm: false } }),
      ),
    ).toMatch(/NodeODM isn't answering/)
    expect(capabilityWarningForStep("orthomosaic", CAPS())).toBeUndefined()
  })

  it("stays silent when the probe hasn't resolved or predates the ODM check", () => {
    expect(capabilityWarningForStep("stitching", undefined)).toBeUndefined()
    expect(capabilityWarningForStep("stitching", null)).toBeUndefined()
    expect(
      capabilityWarningForStep("orthomosaic", CAPS({ odm: null })),
    ).toBeUndefined()
  })

  it("says nothing about steps with no worker requirement", () => {
    const degraded = CAPS({
      agrowstitch: { available: false, path: null },
      odm: { worker: false, nodeodm: false },
    })
    for (const step of [
      "data_sync",
      "gcp_selection",
      "plot_boundary_prep",
      "trait_extraction",
      "inference",
    ]) {
      expect(
        capabilityWarningForStep(step, degraded),
        `step ${step}`,
      ).toBeUndefined()
    }
  })
})
