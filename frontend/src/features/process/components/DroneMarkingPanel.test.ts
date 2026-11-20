import { describe, expect, it } from "vitest"

import { droneCandidates } from "./DroneMarkingPanel"

const scope = {
  year: "2025",
  experiment: "GEMINI",
  location: "Davis",
  population: "Legumes",
  date: "2025-08-08",
  platform: "Rover",
  sensor: "RGB",
}
const dir = (
  date: string,
  platform = "Drone",
  pop = "Legumes",
  sensor = "RGB",
) => `Processed/2025/GEMINI/Davis/${pop}/${date}/${platform}/${sensor}/`

describe("drone boundaries for a rover track", () => {
  it("offers this field's drone versions, one per flight, nearest date first", () => {
    const rows = [
      {
        directory: dir("2025-07-01"),
        version: 1,
        is_active: true,
        plot_count: 444,
      },
      {
        directory: dir("2025-08-08", "Drone", "Legumes", "RGB-IPhone"),
        version: 1,
        is_active: false,
        plot_count: 444,
      },
      {
        directory: dir("2025-08-08", "Drone", "Legumes", "RGB-IPhone"),
        version: 2,
        is_active: true,
        plot_count: 444,
      },
      {
        directory: dir("2025-08-08", "Rover"),
        version: 1,
        is_active: true,
        plot_count: 30,
      },
      {
        directory: dir("2025-08-08", "Drone", "Cowpea"),
        version: 1,
        is_active: true,
        plot_count: 100,
      },
      {
        directory: dir("2025-08-01"),
        version: 1,
        is_active: true,
        plot_count: 0,
      },
    ]
    const out = droneCandidates(rows, scope)
    expect(out.map((r) => [r.directory, r.version])).toEqual([
      [dir("2025-08-08", "Drone", "Legumes", "RGB-IPhone"), 2],
      [dir("2025-07-01"), 1],
    ])
  })
})
