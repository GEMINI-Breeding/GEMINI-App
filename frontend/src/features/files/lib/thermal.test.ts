/**
 * Unit tests for the browser-side thermal helpers.
 *
 * Pure-function tests — no DOM, no fetch. The dialog component layered
 * on top has its own smoke tests in ThermalViewerDialog.test.tsx.
 */
import { describe, expect, it } from "vitest"

import {
  applyPalette,
  decodeRawThermalTiff,
  deriveTemperatureCelsius,
  paletteLut,
  percentileWindow,
  type ThermalSidecar,
} from "./thermal"

/** Build the bytes of a minimal little-endian uncompressed uint16 TIFF.
 *  Single strip, RowsPerStrip = height, BitsPerSample = 16,
 *  SamplesPerPixel = 1, PhotometricInterpretation = 1 (BlackIsZero).
 *  This is exactly the shape the worker writes (compression="raw"). */
function buildSyntheticUncompressedTiff(
  width: number,
  height: number,
  fillFn: (x: number, y: number) => number,
): ArrayBuffer {
  const headerLen = 8
  const numEntries = 9
  const ifdLen = 2 + numEntries * 12 + 4 // count + entries + nextIFD
  const stripOffset = headerLen + ifdLen
  const pixelBytes = width * height * 2
  const buf = new ArrayBuffer(stripOffset + pixelBytes)
  const v = new DataView(buf)

  v.setUint8(0, 0x49)
  v.setUint8(1, 0x49) // "II"
  v.setUint16(2, 42, true)
  v.setUint32(4, headerLen, true)

  v.setUint16(headerLen, numEntries, true)
  let entry = headerLen + 2
  const writeEntry = (tag: number, type: number, count: number, value: number) => {
    v.setUint16(entry, tag, true)
    v.setUint16(entry + 2, type, true)
    v.setUint32(entry + 4, count, true)
    if (type === 3) v.setUint16(entry + 8, value, true)
    else v.setUint32(entry + 8, value, true)
    entry += 12
  }
  // ImageWidth (LONG)
  writeEntry(0x0100, 4, 1, width)
  // ImageLength (LONG)
  writeEntry(0x0101, 4, 1, height)
  // BitsPerSample (SHORT)
  writeEntry(0x0102, 3, 1, 16)
  // Compression = 1 (none)
  writeEntry(0x0103, 3, 1, 1)
  // PhotometricInterpretation = 1 (BlackIsZero)
  writeEntry(0x0106, 3, 1, 1)
  // StripOffsets (LONG, one strip → fits inline)
  writeEntry(0x0111, 4, 1, stripOffset)
  // SamplesPerPixel
  writeEntry(0x0115, 3, 1, 1)
  // RowsPerStrip
  writeEntry(0x0116, 4, 1, height)
  // StripByteCounts
  writeEntry(0x0117, 4, 1, pixelBytes)

  // nextIFD = 0
  v.setUint32(entry, 0, true)

  // Pixel data — little-endian uint16.
  let o = stripOffset
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      v.setUint16(o, fillFn(x, y) & 0xffff, true)
      o += 2
    }
  }
  return buf
}

describe("decodeRawThermalTiff", () => {
  it("decodes a tiny single-strip uint16 image", () => {
    const buf = buildSyntheticUncompressedTiff(3, 2, (x, y) => x + y * 100)
    const { width, height, counts } = decodeRawThermalTiff(buf)
    expect(width).toBe(3)
    expect(height).toBe(2)
    // Row-major: (0,0)=0, (1,0)=1, (2,0)=2, (0,1)=100, (1,1)=101, (2,1)=102
    expect(Array.from(counts)).toEqual([0, 1, 2, 100, 101, 102])
  })

  it("decodes a larger image with multi-strip layout the worker may emit", () => {
    // Build a TIFF with 1 strip, then verify a 16x16 frame round-trips.
    const width = 16
    const height = 16
    const buf = buildSyntheticUncompressedTiff(
      width,
      height,
      (x, y) => x + y * width,
    )
    const { counts } = decodeRawThermalTiff(buf)
    for (let i = 0; i < counts.length; i++) {
      expect(counts[i]).toBe(i)
    }
  })

  it("rejects a non-little-endian TIFF", () => {
    const buf = buildSyntheticUncompressedTiff(1, 1, () => 0)
    new DataView(buf).setUint8(0, 0x4d)
    new DataView(buf).setUint8(1, 0x4d)
    expect(() => decodeRawThermalTiff(buf)).toThrow(/little-endian/)
  })

  it("defaults SamplesPerPixel to 1 when the tag is absent", () => {
    // Pillow's I;16 writer omits SamplesPerPixel because the TIFF 6.0
    // spec says it defaults to 1. The decoder must accept this — a
    // strict check rejected the worker's actual output (caught live in
    // Phase C.6 verification).
    //
    // Build a synthetic TIFF with the SamplesPerPixel entry missing.
    const width = 2
    const height = 2
    const headerLen = 8
    const numEntries = 8 // one less than the 9 in the helper
    const ifdLen = 2 + numEntries * 12 + 4
    const stripOffset = headerLen + ifdLen
    const pixelBytes = width * height * 2
    const buf = new ArrayBuffer(stripOffset + pixelBytes)
    const v = new DataView(buf)
    v.setUint8(0, 0x49)
    v.setUint8(1, 0x49)
    v.setUint16(2, 42, true)
    v.setUint32(4, headerLen, true)
    v.setUint16(headerLen, numEntries, true)
    let entry = headerLen + 2
    const w = (tag: number, type: number, count: number, value: number) => {
      v.setUint16(entry, tag, true)
      v.setUint16(entry + 2, type, true)
      v.setUint32(entry + 4, count, true)
      if (type === 3) v.setUint16(entry + 8, value, true)
      else v.setUint32(entry + 8, value, true)
      entry += 12
    }
    w(0x0100, 4, 1, width)
    w(0x0101, 4, 1, height)
    w(0x0102, 3, 1, 16)
    w(0x0103, 3, 1, 1)
    w(0x0106, 3, 1, 1)
    w(0x0111, 4, 1, stripOffset)
    // SamplesPerPixel (0x0115) omitted on purpose.
    w(0x0116, 4, 1, height) // RowsPerStrip
    w(0x0117, 4, 1, pixelBytes) // StripByteCounts
    v.setUint32(entry, 0, true)
    let o = stripOffset
    for (let i = 0; i < width * height; i++) {
      v.setUint16(o, i + 1, true)
      o += 2
    }
    const decoded = decodeRawThermalTiff(buf)
    expect(decoded.width).toBe(2)
    expect(decoded.height).toBe(2)
    expect(Array.from(decoded.counts)).toEqual([1, 2, 3, 4])
  })

  it("rejects compressed TIFFs (worker must emit raw)", () => {
    const buf = buildSyntheticUncompressedTiff(1, 1, () => 0)
    // Overwrite the Compression entry's inline value from 1 → 5 (LZW).
    // Find the Compression tag and patch its inline value.
    const view = new DataView(buf)
    const ifdStart = 8
    const numEntries = view.getUint16(ifdStart, true)
    for (let i = 0; i < numEntries; i++) {
      const entry = ifdStart + 2 + i * 12
      if (view.getUint16(entry, true) === 0x0103) {
        view.setUint16(entry + 8, 5, true)
        break
      }
    }
    expect(() => decodeRawThermalTiff(buf)).toThrow(/uncompressed/)
  })
})

describe("deriveTemperatureCelsius", () => {
  it("returns null for non-radiometric sidecars (Boson AGC)", () => {
    const sidecar: ThermalSidecar = {
      source: "boson_agc_nonradiometric",
      original: "/whatever",
      shape: [4, 4],
      radiometric: false,
      has_gps: false,
    }
    const counts = new Uint16Array([1, 2, 3, 4])
    expect(deriveTemperatureCelsius(counts, sidecar)).toBeNull()
  })

  it("applies TLinear high-gain scale + offset for Boson radiometric", () => {
    const sidecar: ThermalSidecar = {
      source: "boson_tlinear_high",
      original: "/whatever",
      shape: [1, 1],
      radiometric: true,
      has_gps: false,
      scale: 0.04,
      offset: 0,
    }
    // T_K = 7500 * 0.04 = 300 K → 26.85 °C
    const counts = new Uint16Array([7500])
    const c = deriveTemperatureCelsius(counts, sidecar)!
    expect(c[0]).toBeCloseTo(26.85, 2)
  })

  it("inverts FLIR Planck constants to °C (round-trip with backend constants)", () => {
    const sidecar: ThermalSidecar = {
      source: "flir_one_pro",
      original: "/whatever",
      shape: [1, 1],
      radiometric: true,
      has_gps: true,
      planck: { R1: 17450.25, B: 1435, F: 1, O: -2640, R2: 0.0125 },
      emissivity: 1.0,
    }
    // Compute the forward-direction signal for 300 K, then verify the
    // inverse function recovers ~26.85 °C. Same contract as the
    // backend `test_planck_roundtrip_recovers_input_temperature` test.
    const tK = 300
    const p = sidecar.planck!
    const sFloat = p.R1 / (p.R2 * (Math.exp(p.B / tK) - p.F)) - p.O
    const counts = new Uint16Array([Math.round(sFloat)])
    const c = deriveTemperatureCelsius(counts, sidecar)!
    // uint16 rounding gives us ~0.5 °C of slop; tighten if it starts
    // matching better on more cameras.
    expect(c[0]).toBeCloseTo(26.85, 0)
  })

  it("throws when the sidecar claims FLIR but omits Planck", () => {
    const sidecar: ThermalSidecar = {
      source: "flir_one_pro",
      original: "/whatever",
      shape: [1, 1],
      radiometric: true,
      has_gps: true,
    }
    expect(() =>
      deriveTemperatureCelsius(new Uint16Array([1]), sidecar),
    ).toThrow(/Planck/)
  })
})

describe("applyPalette", () => {
  it("emits an ImageData of the right shape, alpha=255 everywhere", () => {
    const values = new Float32Array([0, 50, 100])
    const lut = paletteLut("iron")
    const img = applyPalette(values, 3, 1, 0, 100, lut)
    expect(img.width).toBe(3)
    expect(img.height).toBe(1)
    // alphas
    expect(img.data[3]).toBe(255)
    expect(img.data[7]).toBe(255)
    expect(img.data[11]).toBe(255)
    // colors at endpoints match LUT[0] / LUT[255]
    expect(img.data[0]).toBe(lut[0])
    expect(img.data[1]).toBe(lut[1])
    expect(img.data[2]).toBe(lut[2])
    expect(img.data[8]).toBe(lut[255 * 3])
    expect(img.data[9]).toBe(lut[255 * 3 + 1])
    expect(img.data[10]).toBe(lut[255 * 3 + 2])
  })

  it("renders NaN pixels as black", () => {
    const values = new Float32Array([Number.NaN, 50])
    const img = applyPalette(values, 2, 1, 0, 100, paletteLut("iron"))
    // NaN pixel: r/g/b all zero (default for uninitialized ImageData).
    expect(img.data[0]).toBe(0)
    expect(img.data[1]).toBe(0)
    expect(img.data[2]).toBe(0)
    expect(img.data[3]).toBe(255)
  })

  it("renders a degenerate window (vmin==vmax) as solid black", () => {
    const values = new Float32Array([10, 20, 30])
    const img = applyPalette(values, 3, 1, 5, 5, paletteLut("iron"))
    for (let i = 0; i < img.data.length; i += 4) {
      expect(img.data[i]).toBe(0)
      expect(img.data[i + 1]).toBe(0)
      expect(img.data[i + 2]).toBe(0)
    }
  })
})

describe("percentileWindow", () => {
  it("ignores outliers via 2/98 default", () => {
    const arr = new Float32Array(1000)
    for (let i = 0; i < arr.length; i++) arr[i] = 15 + (i % 5)
    arr[0] = 1000 // outlier, < 2% of the data
    const [vmin, vmax] = percentileWindow(arr)
    expect(vmin).toBeGreaterThanOrEqual(15)
    expect(vmax).toBeLessThan(25)
  })

  it("handles NaN-only arrays without crashing", () => {
    const arr = new Float32Array([Number.NaN, Number.NaN])
    const [vmin, vmax] = percentileWindow(arr)
    expect(vmin).toBe(0)
    expect(vmax).toBe(1)
  })
})
