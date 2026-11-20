import { describe, expect, it } from "vitest"

import { appTour, getTourSection, TOUR_SECTIONS } from "./tourSteps"

describe("tour sections", () => {
  it("gives each stage of the app its own tour", () => {
    expect(getTourSection("/process/w1/run/r1").label).toBe("Run")
    expect(getTourSection("/process/w1").label).toBe("Process")
    expect(getTourSection("/analyze").steps.length).toBeGreaterThan(1)
    expect(getTourSection("/console").label).toBe("Console")
    expect(getTourSection("/settings").label).toBe("Settings")
    expect(getTourSection("/process/w1/tool", "plot_boundary_prep").label).toBe(
      "Plot Boundary Prep",
    )
  })

  it("the whole-app tour visits every stage", () => {
    const routes = appTour().steps.map((s) => s.route)
    for (const r of ["/files", "/process", "/analyze", "/console", "/settings"])
      expect(routes).toContain(r)
  })

  it("step ids are unique", () => {
    const ids = Object.values(TOUR_SECTIONS).flatMap((s) =>
      s.steps.map((x) => x.id),
    )
    expect(new Set(ids).size).toBe(ids.length)
  })
})
