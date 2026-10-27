import { describe, expect, it } from "vitest"

import {
  ALL_SENSORS,
  canopyTemperatures,
  companionSensors,
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

const TP = `${P}/Thermal`
const TRAW = "Raw/2026/E/D/S/2026-08-17/Drone/Thermal/ef01ab23/Images"
const WITH_THERMAL: PlotFramesManifest = {
  ...M,
  sensor: "RGB",
  companions: {
    Thermal: { frames: 3, matched: 3, plots_seen: 1, prefix: `${TP}/` },
    Multispectral: { frames: 4, error: "no frame within 2 s" },
  },
  plots: [
    {
      ...M.plots[0],
      companions: {
        Thermal: {
          frames: [
            {
              rank: 1,
              image: `${TRAW}/DJI_0001_T.tif`,
              rgb_frame: `${RAW}/DJI_0001.JPG`,
              seconds_from_rgb: 1,
              inside: 1,
              off_nadir_deg: 2,
              gsd_cm: 2,
              crop: `${TP}/crops/plot_1_accession_PI_1_frame1_DJI_0001_T.tif`,
              crop_preview: `${TP}/crops/plot_1_accession_PI_1_frame1_DJI_0001_T.jpg`,
            },
          ],
          straightened: `${TP}/straightened/plot_1_accession_PI_1.tif`,
          straightened_preview: `${TP}/straightened/plot_1_accession_PI_1.png`,
          canopy: {
            canopy_mean_c: 27.4,
            plant_share: 0.6,
            plant_cells: 900,
            seen_cells: 1500,
          },
        },
      },
    },
    M.plots[1],
    M.plots[2],
  ],
}

describe("another camera's plot images", () => {
  it("lists only the cameras that gave plot images", () => {
    expect(companionSensors(WITH_THERMAL)).toEqual(["Thermal"])
    expect(companionSensors(M)).toEqual([])
  })
  it("downloads its values and coloured views, and full frames named by plot", () => {
    expect(
      framesDownload(WITH_THERMAL, "straightened", "Thermal").map(
        (e) => e.name,
      ),
    ).toEqual(["plot_1_accession_PI_1.tif", "plot_1_accession_PI_1.png"])
    expect(
      framesDownload(WITH_THERMAL, "crops-best", "Thermal").map((e) => e.name),
    ).toEqual([
      "plot_1_accession_PI_1_frame1_DJI_0001_T.tif",
      "plot_1_accession_PI_1_frame1_DJI_0001_T.jpg",
    ])
    expect(
      framesDownload(WITH_THERMAL, "frames-best", "Thermal").map((e) => e.name),
    ).toEqual(["plot_1_accession_PI_1_frame1_DJI_0001_T.tif"])
    // The frames' own sensor is the default.
    expect(framesDownload(WITH_THERMAL, "frames-best", "RGB")).toEqual(
      framesDownload(WITH_THERMAL, "frames-best"),
    )
  })
  it("all cameras: each in its own folder", () => {
    const names = framesDownload(WITH_THERMAL, "straightened", ALL_SENSORS).map(
      (e) => e.name,
    )
    expect(names).toContain("RGB/plot_1_accession_PI_1.png")
    expect(names).toContain("Thermal/plot_1_accession_PI_1.tif")
  })
  it("gives each plot's canopy temperature", () => {
    expect(canopyTemperatures(WITH_THERMAL, "Thermal")).toEqual([
      {
        plot: 1,
        accession: "PI 1",
        c: expect.objectContaining({ canopy_mean_c: 27.4 }),
      },
    ])
  })
})
