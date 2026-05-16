/**
 * Unit tests for the shared thermal-data probes.
 *
 * Pins three contracts:
 *   - FLIR-JPEG probe fires on the "FLIR Systems" ASCII bytes that
 *     real FLIR One Pro JPEGs put in their EXIF Make field.
 *   - Boson-TIFF probe fires on 16-bit single-channel BlackIsZero
 *     TIFFs even when the SamplesPerPixel tag is omitted (Pillow
 *     writes this shape).
 *   - probeFilesForThermal walks a mixed batch and returns the right
 *     hint, choosing FLIR-JPEG when both kinds are present.
 */
import { describe, expect, it } from "vitest"

import {
  jpegLooksLikeFlir,
  probeFilesForThermal,
  tiffLooksLikeThermal,
} from "./thermalProbe"

function asFile(bytes: Uint8Array, name: string): File {
  // Strip the SharedArrayBuffer possibility from the underlying
  // buffer so the TS-strict Blob constructor accepts it.
  const ab = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
  return new File([ab], name)
}

function flirJpegBytes(): Uint8Array {
  const marker = "FLIR Systems"
  const buf = new Uint8Array(64)
  buf[0] = 0xff
  buf[1] = 0xd8 // SOI
  for (let i = 0; i < marker.length; i++) buf[10 + i] = marker.charCodeAt(i)
  return buf
}

function rgbJpegBytes(): Uint8Array {
  const buf = new Uint8Array(64)
  buf[0] = 0xff
  buf[1] = 0xd8
  const jfif = "JFIF\0"
  for (let i = 0; i < jfif.length; i++) buf[2 + i] = jfif.charCodeAt(i)
  return buf
}

/** Build a TIFF whose IFD0 entries the caller controls. */
function makeTiff(
  entries: { tag: number; type: number; count: number; value: number }[],
): Uint8Array {
  const headerLen = 8
  const ifdLen = 2 + entries.length * 12 + 4
  const buf = new ArrayBuffer(headerLen + ifdLen + 16)
  const v = new DataView(buf)
  v.setUint8(0, 0x49)
  v.setUint8(1, 0x49)
  v.setUint16(2, 42, true)
  v.setUint32(4, headerLen, true)
  v.setUint16(headerLen, entries.length, true)
  let off = headerLen + 2
  for (const e of entries) {
    v.setUint16(off, e.tag, true)
    v.setUint16(off + 2, e.type, true)
    v.setUint32(off + 4, e.count, true)
    if (e.type === 3) v.setUint16(off + 8, e.value, true)
    else v.setUint32(off + 8, e.value, true)
    off += 12
  }
  v.setUint32(off, 0, true)
  return new Uint8Array(buf)
}

function bosonTiffBytes(): Uint8Array {
  return makeTiff([
    { tag: 0x0100, type: 4, count: 1, value: 640 }, // ImageWidth
    { tag: 0x0101, type: 4, count: 1, value: 512 }, // ImageLength
    { tag: 0x0102, type: 3, count: 1, value: 16 }, // BitsPerSample
    { tag: 0x0106, type: 3, count: 1, value: 1 }, // BlackIsZero
    { tag: 0x0115, type: 3, count: 1, value: 1 }, // SamplesPerPixel
  ])
}

function bosonTiffNoSamplesPerPixel(): Uint8Array {
  // What Pillow's I;16 writer actually emits — no SamplesPerPixel
  // tag. The probe must accept this and treat it as `=1` per TIFF
  // 6.0's default rules.
  return makeTiff([
    { tag: 0x0100, type: 4, count: 1, value: 640 },
    { tag: 0x0101, type: 4, count: 1, value: 512 },
    { tag: 0x0102, type: 3, count: 1, value: 16 },
    { tag: 0x0106, type: 3, count: 1, value: 1 },
  ])
}

function rgbTiffBytes(): Uint8Array {
  // 8-bit, 3 samples per pixel, RGB photometric (2). The probe must
  // reject these — otherwise every drone TIFF would mis-route.
  return makeTiff([
    { tag: 0x0100, type: 4, count: 1, value: 640 },
    { tag: 0x0101, type: 4, count: 1, value: 512 },
    { tag: 0x0102, type: 3, count: 1, value: 8 },
    { tag: 0x0106, type: 3, count: 1, value: 2 }, // RGB
    { tag: 0x0115, type: 3, count: 1, value: 3 },
  ])
}

describe("jpegLooksLikeFlir", () => {
  it("flags a JPEG that contains the 'FLIR Systems' EXIF Make string", async () => {
    expect(
      await jpegLooksLikeFlir(asFile(flirJpegBytes(), "flir.jpg")),
    ).toBe(true)
  })

  it("rejects a plain RGB JPEG", async () => {
    expect(
      await jpegLooksLikeFlir(asFile(rgbJpegBytes(), "rgb.jpg")),
    ).toBe(false)
  })
})

describe("tiffLooksLikeThermal", () => {
  it("flags a real Amiga Boson TIFF whose IFD0 lives past the first KB", async () => {
    // Regression guard: farm-ng's Amiga thermal rig writes a TIFF
    // where IFD0 sits ~470 KB into the file (after the image
    // strips). An earlier version of this probe only read the first
    // 1 KB of the file and false-negatived these — the upload form
    // then never showed the calibration picker and the worker
    // silently no-op'd. The fix was a two-slice read (header +
    // ifd-at-offset).
    const { readFileSync } = await import("fs")
    const path = require("path") as typeof import("path")
    const fixturePath = path.resolve(
      __dirname,
      "../../tests/fixtures/thermal/boson_amiga_001.tiff",
    )
    const bytes = readFileSync(fixturePath)
    const ab = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer
    const file = new File([ab], "boson_amiga_001.tiff")
    expect(await tiffLooksLikeThermal(file)).toBe(true)
  })

  it("flags a 16-bit single-channel BlackIsZero TIFF with explicit SamplesPerPixel", async () => {
    expect(
      await tiffLooksLikeThermal(asFile(bosonTiffBytes(), "boson.tif")),
    ).toBe(true)
  })

  it("flags the same shape when SamplesPerPixel is omitted (Pillow's I;16 output)", async () => {
    expect(
      await tiffLooksLikeThermal(
        asFile(bosonTiffNoSamplesPerPixel(), "boson.tif"),
      ),
    ).toBe(true)
  })

  it("rejects a plain 8-bit RGB TIFF", async () => {
    expect(
      await tiffLooksLikeThermal(asFile(rgbTiffBytes(), "rgb.tif")),
    ).toBe(false)
  })

  it("rejects malformed / non-TIFF bytes", async () => {
    expect(
      await tiffLooksLikeThermal(
        asFile(new Uint8Array([1, 2, 3, 4]), "noise.tif"),
      ),
    ).toBe(false)
  })
})

describe("probeFilesForThermal", () => {
  it("returns hasThermal:false for a plain RGB batch", async () => {
    const files = [
      asFile(rgbJpegBytes(), "DJI_0001.jpg"),
      asFile(rgbJpegBytes(), "DJI_0002.jpg"),
    ]
    const res = await probeFilesForThermal(files)
    expect(res).toEqual({ hasThermal: false, hint: null })
  })

  it("returns flir_jpeg hint for a FLIR JPEG mixed with plain RGB", async () => {
    const files = [
      asFile(rgbJpegBytes(), "DJI_0001.jpg"),
      asFile(flirJpegBytes(), "240725_IMG_00385.jpg"),
    ]
    const res = await probeFilesForThermal(files)
    expect(res).toEqual({ hasThermal: true, hint: "flir_jpeg" })
  })

  it("returns boson_tiff hint for a Boson TIFF batch", async () => {
    const files = [
      asFile(bosonTiffBytes(), "camT-001.tif"),
      asFile(bosonTiffBytes(), "camT-002.tif"),
    ]
    const res = await probeFilesForThermal(files)
    expect(res).toEqual({ hasThermal: true, hint: "boson_tiff" })
  })

  it("prefers flir_jpeg when both are present (JPEG path is fully automatic)", async () => {
    // FLIR JPEGs carry Planck constants — calibration is automatic
    // and the worker doesn't need the user to pick a mode. Boson
    // TIFFs need a mode pick. When both kinds are in the batch the
    // probe should bias toward the easier path so the upload form's
    // default applies cleanly.
    const files = [
      asFile(bosonTiffBytes(), "camT-001.tif"),
      asFile(flirJpegBytes(), "flir.jpg"),
    ]
    const res = await probeFilesForThermal(files)
    expect(res.hint).toBe("flir_jpeg")
  })

  it("returns hasThermal:false for non-image files", async () => {
    const files = [asFile(new Uint8Array([0, 0, 0]), "notes.txt")]
    const res = await probeFilesForThermal(files)
    expect(res).toEqual({ hasThermal: false, hint: null })
  })
})
