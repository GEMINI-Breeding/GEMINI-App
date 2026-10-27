import { describe, expect, it } from "vitest"

import {
  framesDownload,
  type PlotFramesManifest,
  partlySeen,
  plotStem,
  unseenPlots,
} from "./plotFrames"

const P = "Processed/2026/E/D/S/2026-08-17/Drone/RGB/PlotFrames"
const RAW = "Raw/2026/E/D/S/2026-08-17/Drone/RGB/ab12cd34/Images"

const frame = (rank: number, img: string, plot: number, inside = 1) => ({
  rank,
  image: `${RAW}/${img}`,
  crop: `${P}/crops/plot_${plot}_accession_PI_${plot}_frame${rank}_${img.replace(".JPG", "")}.jpg`,
  inside,
  off_nadir_deg: rank * 3,
  center_offset: 0.1 * rank,
  gsd_cm: 0.8,
})

const M: PlotFramesManifest = {
  orthomosaics: ["x"],
  crs: "EPSG:32610",
  frames_per_plot: 3,
  ground: ["dsm"],
  plots: [
    {
      plot: 1,
      accession: "PI 1",
      ground_z: 15,
      straightened: `${P}/straightened/plot_1_accession_PI_1.png`,
      frames: [frame(1, "DJI_0001.JPG", 1), frame(2, "DJI_0002.JPG", 1)],
    },
    {
      plot: 2,
      accession: "PI 2",
      ground_z: 15,
      straightened: `${P}/straightened/plot_2_accession_PI_2.png`,
      // The same frame is the best view of plot 2 too.
      frames: [frame(1, "DJI_0001.JPG", 2, 0.9)],
    },
    {
      plot: 3,
      accession: "PI/3",
      ground_z: 15,
      straightened: null,
      frames: [],
    },
  ],
}

describe("plot frames downloads", () => {
  it("names full frames by plot and accession, once per plot they show", () => {
    const got = framesDownload(M, "frames-best")
    expect(got.map((e) => e.name)).toEqual([
      "plot_1_accession_PI_1_frame1_DJI_0001.JPG",
      "plot_2_accession_PI_2_frame1_DJI_0001.JPG",
    ])
    expect(new Set(got.map((e) => e.object)).size).toBe(1)
    expect(framesDownload(M, "frames-all")).toHaveLength(3)
  })
  it("crops and straightened views keep their stored names", () => {
    expect(framesDownload(M, "crops-best").map((e) => e.name)).toEqual([
      "plot_1_accession_PI_1_frame1_DJI_0001.jpg",
      "plot_2_accession_PI_2_frame1_DJI_0001.jpg",
    ])
    expect(framesDownload(M, "straightened")).toHaveLength(2)
  })
  it("says which plots no frame shows, or shows only in part", () => {
    expect(unseenPlots(M)).toEqual([3])
    expect(partlySeen(M)).toEqual([2])
    expect(plotStem(M.plots[2])).toBe("plot_3_accession_PI_3")
  })
})
