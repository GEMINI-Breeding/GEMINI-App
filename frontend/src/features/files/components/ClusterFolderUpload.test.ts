import { describe, expect, it } from "vitest"

import { uploadSettings } from "./ClusterFolderUpload"

describe("cluster upload settings", () => {
  const scope = {
    experiment: { kind: "existing", name: "GEMINI-26" },
  } as never
  const form = {
    location: "Davis",
    population: "Sorghum",
    date: "2026-07-23",
    platform: "Drone",
    sensor: "RGB",
  }
  it("carries the run of the day and the treatment, so same-day batches stay apart", () => {
    expect(
      uploadSettings(
        "Image Data",
        { ...form, treatment: " drought ", run_of_day: "13:05" },
        scope,
      ),
    ).toMatchObject({
      experiment: "GEMINI-26",
      site: "Davis",
      data_type: "images",
      treatment: "drought",
      run_of_day: "13:05",
    })
  })
  it("leaves them out when not given", () => {
    const s = uploadSettings("Image Data", form, scope)
    expect(s).not.toHaveProperty("treatment")
    expect(s).not.toHaveProperty("run_of_day")
  })
})
