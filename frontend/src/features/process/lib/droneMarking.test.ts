import { describe, expect, it } from "vitest"

import {
  applyTrackCorrection,
  correctedMsgsCsv,
  dronePlots,
  estimateOffsets,
  LocalFrame,
  markFromDrone,
  passesOf,
  snapToBeds,
  trackFit,
  trackGeometry,
  type XY,
} from "./droneMarking"
import type { TrackPoint } from "./groundTrack"

const LON0 = -121.778
const LAT0 = 38.5365
const frame = new LocalFrame(LON0, LAT0)

const BEDS = 5
const TIERS = 6
const SPACING = 1.52 // bed centre to bed centre, east-west
const PLOT = 3 // plot length north-south
const ALLEY = 1

/** Beds run north; plot "b-t" is bed b, tier t. */
function field(): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (let b = 0; b < BEDS; b++)
    for (let t = 0; t < TIERS; t++) {
      const x0 = b * SPACING - 0.5
      const x1 = b * SPACING + 0.5
      const y0 = t * (PLOT + ALLEY)
      const y1 = y0 + PLOT
      const ring = [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
        [x0, y0],
      ].map(([x, y]) => {
        const { lon, lat } = frame.toDeg([x, y])
        return [lon, lat]
      })
      features.push({
        type: "Feature",
        properties: { plot: `${b + 1}-${t + 1}`, accession: `G${b}${t}` },
        geometry: { type: "Polygon", coordinates: [ring] },
      })
    }
  return { type: "FeatureCollection", features }
}

/**
 * A serpentine drive over the beds: one pass per bed (north on odd beds,
 * south on even), a turn at each end, a frame every 0.2 m. The GPS is off
 * by `shift` and the antenna is `left` metres left of the camera.
 */
function drive(shift: XY = [0, 0], left = 0): TrackPoint[] {
  const pts: TrackPoint[] = []
  const len = TIERS * (PLOT + ALLEY)
  let k = 0
  const push = (x: number, y: number) => {
    const { lon, lat } = frame.toDeg([x + shift[0], y + shift[1]])
    pts.push({
      image: `rgb-${String(k++).padStart(6, "0")}.jpg`,
      lat,
      lon,
      direction: null,
    })
  }
  for (let b = 0; b < BEDS; b++) {
    const north = b % 2 === 0
    // left of travel: west going north, east going south
    const x = b * SPACING + (north ? -left : left)
    for (let s = -2; s <= len + 2; s += 0.2) push(x, north ? s : len - s)
    // the turn: a short hop over to the next bed
    if (b < BEDS - 1) {
      const yEnd = north ? len + 2 : -2
      for (let s = 0.2; s < SPACING; s += 0.2)
        push(b * SPACING + s, yEnd + (north ? 1.5 : -1.5))
    }
  }
  return pts
}

describe("plot marking from drone boundaries", () => {
  it("splits a serpentine drive into one pass per bed", () => {
    const geo = trackGeometry(drive())!
    expect(geo.passes).toHaveLength(BEDS)
    expect(geo.passes[0].u[1]).toBeGreaterThan(0.99) // north
    expect(geo.passes[1].u[1]).toBeLessThan(-0.99) // south
  })

  it("finds every plot, in driving order, with its drone label", () => {
    const pts = drive()
    const geo = trackGeometry(pts)!
    const plots = dronePlots(field(), geo.frame)
    const fit = trackFit(geo.xy, geo.passes, plots)
    expect(fit.shifted).toBe(false)
    expect(fit.spacing_m).toBeCloseTo(SPACING, 1)
    const m = markFromDrone(pts, geo.located, geo.xy, geo.passes, plots, "down")
    expect(m.selections).toHaveLength(BEDS * TIERS)
    const labels = m.selections.map((s) => s.boundary?.label)
    expect(labels.slice(0, 7)).toEqual([
      "1-1",
      "1-2",
      "1-3",
      "1-4",
      "1-5",
      "1-6",
      "2-6",
    ])
    expect(m.selections.every((s) => s.direction === "down")).toBe(true)
    // plot 1-1 runs from y=0 to y=3: about 15 frames
    const first = m.selections[0]
    const a = pts.findIndex((p) => p.image === first.start_image)
    const b = pts.findIndex((p) => p.image === first.end_image)
    expect(b - a).toBeGreaterThan(12)
    expect(b - a).toBeLessThan(17)
  })

  it("notices a GPS shift and an off-centre antenna, and snapping fixes both", () => {
    const pts = drive([0.55, 0.3], 0.35)
    const geo = trackGeometry(pts)!
    const plots = dronePlots(field(), geo.frame)
    const before = trackFit(geo.xy, geo.passes, plots)
    expect(before.shifted).toBe(true)
    expect(before.offset_m).toBeGreaterThan(0.15)

    const est = estimateOffsets(geo.xy, geo.passes, plots)!
    expect(est.across_m).toBeCloseTo(-0.55, 1) // back west
    expect(est.left_m).toBeCloseTo(0.35, 1)
    expect(est.beds).toBe(BEDS)
    const c = snapToBeds(geo.xy, geo.passes, plots)
    const moved = applyTrackCorrection(geo.xy, geo.passes, c)
    const after = trackFit(moved, geo.passes, plots)
    expect(after.offset_m).toBeLessThan(0.05)
    expect(after.shifted).toBe(false)
    const m = markFromDrone(pts, geo.located, moved, geo.passes, plots, "down")
    expect(m.selections).toHaveLength(BEDS * TIERS)
  })

  it("names the rover-frame offset when passes alternate sides", () => {
    const pts = drive([0, 0], 0.6)
    const geo = trackGeometry(pts)!
    const plots = dronePlots(field(), geo.frame)
    const fit = trackFit(geo.xy, geo.passes, plots)
    expect(fit.shifted).toBe(true)
    expect(fit.reason).toMatch(/direction of travel/)
    // a left offset of 0.6 m, undone in the rover's frame
    const moved = applyTrackCorrection(geo.xy, geo.passes, {
      rover_m: [0, -0.6],
    })
    expect(trackFit(moved, geo.passes, plots).offset_m).toBeLessThan(0.05)
  })

  it("shifts along the beds with the whole-track shift", () => {
    const pts = drive([0, 1])
    const geo = trackGeometry(pts)!
    const moved = applyTrackCorrection(geo.xy, geo.passes, { shift_m: [0, -1] })
    const back = drive()
    moved.forEach((p, i) => {
      const { lat, lon } = geo.frame.toDeg(p)
      expect(lat).toBeCloseTo(back[i].lat as number, 8)
      expect(lon).toBeCloseTo(back[i].lon as number, 8)
    })
  })

  it("ignores short stops and jumps when splitting passes", () => {
    const xy: XY[] = []
    for (let y = 0; y < 20; y += 0.2) xy.push([0, y])
    for (let y = 30; y < 50; y += 0.2) xy.push([0, y]) // a 10 m gap: a new pass
    expect(passesOf(xy)).toHaveLength(2)
  })

  it("writes corrected positions into msgs_synced, keeping the rover's", () => {
    const csv =
      "/top/rgb_file,lat,lon,direction\nrgb-1.jpg,38.5,-121.7,North\nrgb-2.jpg,38.6,-121.8,North\n"
    const out = correctedMsgsCsv(
      csv,
      new Map([["rgb-1.jpg", { lat: 38.4, lon: -121.6 }]]),
    )
    const rows = out.trim().split("\n")
    expect(rows[0]).toBe("/top/rgb_file,lat,lon,direction,lat_raw,lon_raw")
    expect(rows[1]).toBe(
      "rgb-1.jpg,38.400000000,-121.600000000,North,38.5,-121.7",
    )
    expect(rows[2]).toBe("rgb-2.jpg,38.6,-121.8,North,38.6,-121.8")
  })
})
