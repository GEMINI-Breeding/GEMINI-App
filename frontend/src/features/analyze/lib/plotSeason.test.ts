import { describe, expect, it } from "vitest"
import {
  imageFor,
  imagePopulations,
  indexSeasonImages,
  kindLabel,
  parsePlotImageName,
  suggestPlots,
} from "./plotSeason"

const P = "Processed/2026/E/Davis/Cowpea"
const f = (n: string) => ({ object_name: `${P}/${n}` }) as never

describe("plot images through the season", () => {
  it("reads plot and accession from the name, frames included", () => {
    expect(parsePlotImageName("plot_12_accession_CB27.png")).toEqual({
      plot: "12",
      accession: "CB27",
      frame: null,
    })
    expect(
      parsePlotImageName("plot_L2_accession_IT_93K_frame1_DJI_0001_V.jpg"),
    ).toEqual({ plot: "L2", accession: "IT_93K", frame: 1 })
    expect(parsePlotImageName("manifest.json")).toBeNull()
  })

  it("indexes each kind by date and plot, the best frame per plot", () => {
    const idx = indexSeasonImages([
      f("2026-06-15/Drone/RGB/PlotImages/plot_1_accession_A.png"),
      f("2026-06-22/Drone/RGB/PlotImages/plot_1_accession_A.png"),
      f("2026-06-15/Drone/RGB/PlotFrames/straightened/plot_1_accession_A.png"),
      f(
        "2026-06-15/Drone/RGB/PlotFrames/crops/plot_1_accession_A_frame2_DJI_9_V.jpg",
      ),
      f(
        "2026-06-15/Drone/RGB/PlotFrames/crops/plot_1_accession_A_frame0_DJI_8_V.jpg",
      ),
      f(
        "2026-06-15/Drone/RGB/PlotFrames/Thermal/straightened/plot_1_accession_A.png",
      ),
      f(
        "2026-06-15/Drone/RGB/PlotFrames/Thermal/straightened/plot_1_accession_A.tif",
      ),
      f("2026-06-15/Drone/RGB/traits/v1-traits.geojson"),
    ])
    expect(idx.kinds).toEqual([
      "ortho",
      "straightened",
      "frame",
      "Thermal:straightened",
    ])
    expect([...(idx.byKind.get("ortho")?.keys() ?? [])]).toEqual([
      "2026-06-15",
      "2026-06-22",
    ])
    expect(idx.byKind.get("frame")?.get("2026-06-15")?.get("1")).toContain(
      "frame0",
    )
    expect(idx.accessions.get("1")).toBe("A")
    expect(kindLabel("Thermal:straightened")).toBe("Thermal camera, top-down")
  })

  it("keeps to one crop of a site listing", () => {
    const site = [
      {
        object_name:
          "Processed/2026/E/Davis/Cowpea/2026-06-15/Drone/RGB/PlotImages/plot_1_accession_A.png",
      },
      {
        object_name:
          "Processed/2026/E/Davis/Sorghum/2026-06-15/Drone/RGB/PlotImages/plot_1_accession_S.png",
      },
    ] as never[]
    expect(imagePopulations(site)).toEqual(["Cowpea", "Sorghum"])
    const idx = indexSeasonImages(site, "Sorghum")
    expect(idx.accessions.get("1")).toBe("S")
  })

  it("suggests plots by number first, then by accession", () => {
    const plots = [
      { plot: "1", accession: "CB27" },
      { plot: "10", accession: "IT93K" },
      { plot: "11", accession: "CB27" },
      { plot: "2", accession: "X1" },
    ]
    const s = suggestPlots(plots, "1")
    expect(s.plots.map((p) => p.plot).slice(0, 3)).toEqual(["1", "10", "11"])
    expect(s.plots.map((p) => p.plot)).toContain("2") // X1 contains "1"
    const acc = suggestPlots(plots, "cb27")
    expect(acc.accessions).toEqual([{ accession: "CB27", plots: ["1", "11"] }])
    // A single-plot accession is offered too, and every accession before typing.
    expect(suggestPlots(plots, "x1").accessions).toEqual([
      { accession: "X1", plots: ["2"] },
    ])
    expect(suggestPlots(plots, "").accessions.map((a) => a.accession)).toEqual([
      "CB27",
      "IT93K",
      "X1",
    ])
  })
})

describe("the server's name filter", () => {
  it("keeps plot images, top-down frames and the best crop only", async () => {
    const { PLOT_IMAGE_MATCH } = await import("./plotSeason")
    const re = new RegExp(PLOT_IMAGE_MATCH)
    const d = "P/2026-06-15/Drone/RGB"
    expect(re.test(`${d}/PlotImages/plot_1_accession_A.png`)).toBe(true)
    expect(re.test(`${d}/PlotFrames/straightened/plot_1_accession_A.png`)).toBe(
      true,
    )
    expect(
      re.test(`${d}/PlotFrames/Thermal/straightened/plot_1_accession_A.png`),
    ).toBe(true)
    expect(
      re.test(`${d}/PlotFrames/Thermal/straightened/plot_1_accession_A.tif`),
    ).toBe(false)
    expect(
      re.test(`${d}/PlotFrames/crops/plot_1_accession_A_frame1_DJI_1_V.jpg`),
    ).toBe(true)
    expect(
      re.test(`${d}/PlotFrames/crops/plot_1_accession_A_frame2_DJI_1_V.jpg`),
    ).toBe(false)
    expect(re.test(`${d}/traits/v1-traits.geojson`)).toBe(false)
  })
})

describe("imageFor", () => {
  it("shows the row's own date, the orthomosaic's image first", () => {
    const idx = indexSeasonImages([
      f("2026-07-23/Drone/RGB/PlotImages/plot_575_accession_S.png"),
      f("2026-07-27/Drone/RGB/PlotImages/plot_575_accession_S.png"),
      f(
        "2026-07-27/Drone/RGB/PlotFrames/straightened/plot_575_accession_S.png",
      ),
      f(
        "2026-08-03/Drone/RGB/PlotFrames/straightened/plot_575_accession_S.png",
      ),
    ])
    expect(imageFor(idx, "575", "2026-07-27")?.path).toContain(
      "2026-07-27/Drone/RGB/PlotImages",
    )
    expect(imageFor(idx, "575", "2026-08-03")?.kind).toBe("straightened")
    // No image that day: the latest.
    expect(imageFor(idx, "575", "2026-09-01")?.date).toBe("2026-08-03")
    expect(imageFor(idx, "999", "2026-07-27")).toBeNull()
  })
})
