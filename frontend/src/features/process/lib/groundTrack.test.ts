import { describe, expect, it } from "vitest"

import type { FileMetadata } from "@/client"
import {
  findGroundTracks,
  nextStitchPrefix,
  type PlotSelection,
  parseTrack,
  plotMarkingsDirectory,
  stitchVersions,
  translateMarkings,
  withGps,
} from "./groundTrack"
import type { AerialScope } from "./paths"

const file = (object_name: string): FileMetadata => ({
  bucket_name: "gemini",
  object_name,
  last_modified: "",
  etag: "",
  size: 1,
})

const RAW = "Raw/2024/E/Davis/Cowpea/2024-07-15/Amiga/RGB/"

describe("findGroundTracks", () => {
  it("pairs each dataset's top-camera frames with its msgs_synced", () => {
    const tracks = findGroundTracks(
      [
        file(`${RAW}bbbb2222/RGB/Images/top/rgb-2.jpg`),
        file(`${RAW}aaaa1111/RGB/Images/top/rgb-20.jpg`),
        file(`${RAW}aaaa1111/RGB/Images/top/rgb-10.jpg`),
        file(`${RAW}aaaa1111/RGB/Metadata/msgs_synced.csv`),
        file(`${RAW}aaaa1111/RGB/Metadata/gps_pvt.csv`),
        file(`${RAW}aaaa1111/report.txt`),
        // Other cameras and elsewhere in the bucket are not tracks.
        file(`${RAW}aaaa1111/RGB/Images/left/rgb-1.jpg`),
        file("Raw/2024/E/Davis/Other/x/RGB/Images/top/rgb-1.jpg"),
      ],
      RAW,
    )
    expect(tracks).toEqual([
      {
        dataset: "aaaa1111",
        imagesPrefix: `${RAW}aaaa1111/RGB/Images/top/`,
        images: ["rgb-10.jpg", "rgb-20.jpg"],
        msgsSyncedPath: `${RAW}aaaa1111/RGB/Metadata/msgs_synced.csv`,
      },
      {
        dataset: "bbbb2222",
        imagesPrefix: `${RAW}bbbb2222/RGB/Images/top/`,
        images: ["rgb-2.jpg"],
        msgsSyncedPath: null,
      },
    ])
  })

  it("pairs a handheld image upload with separately uploaded Synced Metadata", () => {
    const raw = "Raw/2024/E/Davis/Cowpea/2024-07-15/Monopod/RGB/"
    const tracks = findGroundTracks(
      [
        file(`${raw}cccc3333/Images/IMG_0002.JPG`),
        file(`${raw}cccc3333/Images/IMG_0001.JPG`),
        file(`${raw}dddd4444/Metadata/msgs_synced.csv`),
      ],
      raw,
    )
    expect(tracks).toEqual([
      {
        dataset: "cccc3333",
        imagesPrefix: `${raw}cccc3333/Images/`,
        images: ["IMG_0001.JPG", "IMG_0002.JPG"],
        msgsSyncedPath: `${raw}dddd4444/Metadata/msgs_synced.csv`,
      },
    ])
  })
})

const CSV = [
  "/top/rgb,lat,lon,/top/rgb_file,direction",
  "1,38.5,-121.7,/top/rgb-1.jpg,South",
  "2,38.4999,-121.7,/top/rgb-2.jpg,South",
  "3,,,/top/rgb-3.jpg,",
].join("\n")

describe("parseTrack", () => {
  it("reads frame names, fixes and direction in file order", () => {
    expect(parseTrack(CSV)).toEqual([
      { image: "rgb-1.jpg", lat: 38.5, lon: -121.7, direction: "South" },
      { image: "rgb-2.jpg", lat: 38.4999, lon: -121.7, direction: "South" },
      { image: "rgb-3.jpg", lat: null, lon: null, direction: null },
    ])
  })

  it("is empty without an image column", () => {
    expect(parseTrack("lat,lon\n1,2")).toEqual([])
  })
})

const sel = (p: Partial<PlotSelection>): PlotSelection => ({
  plot_id: 1,
  start_image: null,
  end_image: null,
  direction: "right",
  ...p,
})

describe("markings and GPS", () => {
  const track = parseTrack(CSV)

  it("withGps records each marker's position", () => {
    const [s] = withGps(
      [
        sel({
          start_image: "rgb-1.jpg",
          end_image: "rgb-2.jpg",
          translated: true,
        }),
      ],
      track,
    )
    expect(s).toMatchObject({
      start_lat: 38.5,
      start_lon: -121.7,
      end_lat: 38.4999,
      end_lon: -121.7,
    })
    expect(s.translated).toBeUndefined()
  })

  it("moves markers from another track to the nearest frame here", () => {
    const other = [
      sel({
        start_image: "rgb-OLD-A.jpg",
        start_lat: 38.50001, // ~1 m from rgb-1
        start_lon: -121.7,
        end_image: "rgb-2.jpg", // already on this track
      }),
    ]
    const images = new Set(track.map((p) => p.image))
    const out = translateMarkings(other, images, track)
    expect(out.translated).toBe(true)
    expect(out.selections[0]).toMatchObject({
      start_image: "rgb-1.jpg",
      end_image: "rgb-2.jpg",
      translated: true,
    })
  })

  it("leaves a marker alone when nothing is within 50 m", () => {
    const far = [
      sel({ start_image: "rgb-X.jpg", start_lat: 38.6, start_lon: -121.7 }),
    ]
    const out = translateMarkings(far, new Set(["rgb-1.jpg"]), track)
    expect(out.translated).toBe(false)
    expect(out.selections[0].start_image).toBe("rgb-X.jpg")
  })

  it("keys markings by population", () => {
    expect(
      plotMarkingsDirectory({
        year: "2024",
        experiment: "E",
        location: "Davis",
        population: "Cowpea",
      }),
    ).toBe("Processed/2024/E/Davis/Cowpea/PlotMarkings")
  })
})

const SCOPE: AerialScope = {
  year: "2024",
  experiment: "E",
  location: "Davis",
  population: "Cowpea",
  date: "2024-07-15",
  platform: "Amiga",
  sensor: "RGB",
}
const PROC = "Processed/2024/E/Davis/Cowpea/2024-07-15/Amiga/RGB/"

describe("stitchVersions", () => {
  it("groups a run's AgRowStitch_v{N} outputs, newest first", () => {
    const v = stitchVersions(
      [
        file(`${PROC}AgRowStitch_v1/full_res_mosaic_temp_plot_10.png`),
        file(`${PROC}AgRowStitch_v1/full_res_mosaic_temp_plot_2.png`),
        file(`${PROC}AgRowStitch_v1/combined_mosaic.tif`),
        file(`${PROC}AgRowStitch_v1/stitch_manifest.json`),
        file(`${PROC}AgRowStitch_v2/full_res_mosaic_temp_plot_1.png`),
        file(`${PROC}odm_orthophoto.tif`),
      ],
      SCOPE,
    )
    expect(v.map((x) => x.version)).toEqual([2, 1])
    expect(v[1].plotImages.map((p) => p.plotId)).toEqual(["2", "10"])
    expect(v[1].combinedMosaic).toBe(
      `${PROC}AgRowStitch_v1/combined_mosaic.tif`,
    )
    expect(v[0].combinedMosaic).toBeNull()
    expect(nextStitchPrefix(SCOPE, v)).toBe(`${PROC}AgRowStitch_v3/`)
    expect(nextStitchPrefix(SCOPE, [])).toBe(`${PROC}AgRowStitch_v1/`)
  })
})
