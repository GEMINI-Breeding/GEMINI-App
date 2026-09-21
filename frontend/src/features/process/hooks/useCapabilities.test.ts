import { describe, expect, it } from "vitest"

import {
  type Capabilities,
  capabilityWarningForStep,
  type DockerStatus,
} from "./useCapabilities"

const CAPS = (over: Partial<Capabilities> = {}): Capabilities => ({
  agrowstitch: { available: true, path: "/opt/agrowstitch" },
  torch_version: "2.4.0",
  cuda_available: false,
  mps_available: false,
  cpu_count: 12,
  ...over,
})

const DOCKER = (over: Partial<DockerStatus> = {}): DockerStatus => ({
  available: true,
  ...over,
})

describe("capabilityWarningForStep", () => {
  it("warns on stitching when AgRowStitch is missing", () => {
    const w = capabilityWarningForStep(
      "stitching",
      CAPS({ agrowstitch: { available: false, path: null } }),
      DOCKER(),
    )
    expect(w).toMatch(/AgRowStitch/)
  })

  it("stays silent on stitching when AgRowStitch is present", () => {
    expect(
      capabilityWarningForStep("stitching", CAPS(), DOCKER()),
    ).toBeUndefined()
  })

  it("warns on orthomosaic when Docker is unavailable, naming the reason", () => {
    const w = capabilityWarningForStep(
      "orthomosaic",
      CAPS(),
      DOCKER({ available: false, reason: "not_installed" }),
    )
    expect(w).toMatch(/Docker/)
    expect(w).toMatch(/not_installed/)
  })

  it("stays silent on orthomosaic when Docker is available", () => {
    expect(
      capabilityWarningForStep("orthomosaic", CAPS(), DOCKER()),
    ).toBeUndefined()
  })

  it("stays silent when the probes haven't resolved", () => {
    // An unreachable probe must not block a step that may well work. The
    // warning is advisory, so absence of evidence is not evidence of
    // absence.
    expect(
      capabilityWarningForStep("stitching", undefined, undefined),
    ).toBeUndefined()
    expect(capabilityWarningForStep("stitching", null, null)).toBeUndefined()
    expect(capabilityWarningForStep("orthomosaic", null, null)).toBeUndefined()
  })

  it("says nothing about steps with no capability requirement", () => {
    const degraded = CAPS({ agrowstitch: { available: false, path: null } })
    const noDocker = DOCKER({ available: false, reason: "not_installed" })
    for (const step of [
      "data_sync",
      "gcp_selection",
      "plot_boundary_prep",
      "trait_extraction",
      "inference",
    ]) {
      expect(
        capabilityWarningForStep(step, degraded, noDocker),
        `step ${step} should not warn`,
      ).toBeUndefined()
    }
  })
})
