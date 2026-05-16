/**
 * Browser-side helpers for the Thermal Viewer.
 *
 * The backend `THERMAL_EXTRACT` worker writes two artifacts per
 * thermal image — an uncompressed 16-bit single-channel TIFF holding
 * the raw signal, plus a JSON sidecar with the calibration constants.
 * This module decodes both and renders palette-mapped previews on a
 * `<canvas>` plus temperature readouts on hover.
 *
 * Why a hand-rolled TIFF decoder rather than `geotiff` or `utif`:
 * the worker emits *uncompressed* uint16 strips so we can read them
 * with a ~80-line parser instead of pulling in a 150 KB+ LZW codec.
 * The format contract — uncompressed, BlackIsZero, single SamplesPerPixel,
 * 16 BitsPerSample — is enforced by `backend/gemini/workers/thermal/worker.py`
 * (`_process_flir_jpeg` / `_process_boson_tiff`).
 */

// ---------------------------------------------------------------------------
// Sidecar schema (mirrors what the worker writes — see worker.py)
// ---------------------------------------------------------------------------

export interface ThermalSidecarPlanck {
  R1: number
  B: number
  F: number
  O: number
  R2: number
}

export interface ThermalSidecar {
  source: string
  original: string
  shape: [number, number]
  radiometric: boolean
  has_gps: boolean
  // FLIR One Pro path
  planck?: ThermalSidecarPlanck
  emissivity?: number
  scene_min_c?: number | null
  scene_max_c?: number | null
  preview_vmin_c?: number
  preview_vmax_c?: number
  // Linear (Boson TLinear / user-defined) path
  scale?: number
  offset?: number
  // Non-radiometric path
  preview_vmin_counts?: number
  preview_vmax_counts?: number
}

// ---------------------------------------------------------------------------
// TIFF decoder — uncompressed, uint16, single channel, BlackIsZero only
// ---------------------------------------------------------------------------

export interface DecodedRawThermal {
  width: number
  height: number
  /** Length = width * height. */
  counts: Uint16Array
}

/**
 * Parse a single-strip uncompressed uint16 TIFF the worker emits.
 *
 * Throws on anything outside the contract (LZW, multi-strip, multi-
 * channel, 8-bit, big-endian uint16 — Pillow on the worker side always
 * writes little-endian II for compression="raw"). This is intentional:
 * silently rendering the wrong bytes would corrupt the temperature HUD.
 */
export function decodeRawThermalTiff(buf: ArrayBuffer): DecodedRawThermal {
  const view = new DataView(buf)
  if (buf.byteLength < 8) {
    throw new Error("thermal TIFF: header too short")
  }
  // Byte order: "II" = little-endian (only LE supported — Pillow writes LE).
  const byteOrder = String.fromCharCode(view.getUint8(0), view.getUint8(1))
  if (byteOrder !== "II") {
    throw new Error(`thermal TIFF: expected little-endian, got ${byteOrder}`)
  }
  if (view.getUint16(2, true) !== 42) {
    throw new Error("thermal TIFF: bad magic")
  }
  const ifd0Offset = view.getUint32(4, true)
  const numEntries = view.getUint16(ifd0Offset, true)

  let width = 0
  let height = 0
  let bitsPerSample = 0
  // TIFF spec default for SamplesPerPixel is 1; Pillow's I;16 writer
  // omits the tag entirely for single-channel images, so absence must
  // be treated as 1 rather than rejected.
  let samplesPerPixel = 1
  let compression = 0
  let photometric = -1
  let stripOffsets: number[] = []
  let stripByteCounts: number[] = []
  let rowsPerStrip = 0xffffffff
  let sampleFormat = 1 // 1 = uint (TIFF default)
  let predictor = 1 // 1 = no predictor (default)

  for (let i = 0; i < numEntries; i++) {
    const entry = ifd0Offset + 2 + i * 12
    const tag = view.getUint16(entry, true)
    const type = view.getUint16(entry + 2, true)
    const count = view.getUint32(entry + 4, true)
    const valueOff = entry + 8
    // SHORT (type=3) values <=2 fit inline. LONG (type=4) values <=1
    // fit inline. Otherwise the 4 bytes are an offset into the file.
    const readShort = () => view.getUint16(valueOff, true)
    const readLong = () => view.getUint32(valueOff, true)
    const readArr = (): number[] => {
      const arr: number[] = []
      if (type === 3) {
        // SHORT
        if (count <= 2) {
          for (let j = 0; j < count; j++)
            arr.push(view.getUint16(valueOff + j * 2, true))
        } else {
          const off = readLong()
          for (let j = 0; j < count; j++)
            arr.push(view.getUint16(off + j * 2, true))
        }
      } else if (type === 4) {
        // LONG
        if (count === 1) {
          arr.push(readLong())
        } else {
          const off = readLong()
          for (let j = 0; j < count; j++)
            arr.push(view.getUint32(off + j * 4, true))
        }
      }
      return arr
    }

    switch (tag) {
      case 0x0100: // ImageWidth
        width = type === 3 ? readShort() : readLong()
        break
      case 0x0101: // ImageLength
        height = type === 3 ? readShort() : readLong()
        break
      case 0x0102: // BitsPerSample
        bitsPerSample = readShort()
        break
      case 0x0103: // Compression
        compression = readShort()
        break
      case 0x0106: // PhotometricInterpretation
        photometric = readShort()
        break
      case 0x0111: // StripOffsets
        stripOffsets = readArr()
        break
      case 0x0115: // SamplesPerPixel
        samplesPerPixel = readShort()
        break
      case 0x0116: // RowsPerStrip
        rowsPerStrip = type === 3 ? readShort() : readLong()
        break
      case 0x0117: // StripByteCounts
        stripByteCounts = readArr()
        break
      case 0x011c: // PlanarConfiguration (1 = chunky, default)
        break
      case 0x013d: // Predictor
        predictor = readShort()
        break
      case 0x0153: // SampleFormat
        sampleFormat = readShort()
        break
      default:
        break
    }
  }

  if (compression !== 1) {
    throw new Error(
      `thermal TIFF: only uncompressed supported (got compression=${compression})`,
    )
  }
  if (predictor !== 1) {
    throw new Error(
      `thermal TIFF: predictor=${predictor} not supported — worker should emit raw`,
    )
  }
  if (bitsPerSample !== 16) {
    throw new Error(`thermal TIFF: expected 16-bit, got ${bitsPerSample}`)
  }
  if (samplesPerPixel !== 1) {
    throw new Error(
      `thermal TIFF: expected single channel, got SamplesPerPixel=${samplesPerPixel}`,
    )
  }
  if (sampleFormat !== 1) {
    // 1 = unsigned. 2 (signed) would be a worker-side bug.
    throw new Error(`thermal TIFF: SampleFormat=${sampleFormat} unsupported`)
  }
  if (!width || !height) {
    throw new Error("thermal TIFF: missing dimensions")
  }
  if (stripOffsets.length === 0) {
    throw new Error("thermal TIFF: no strips")
  }

  // Concatenate every strip into one uint16 array. RowsPerStrip can
  // make this multi-strip even for small images — Pillow writes
  // 6-rows-per-strip by default on uncompressed output.
  const counts = new Uint16Array(width * height)
  let dest = 0
  for (let s = 0; s < stripOffsets.length; s++) {
    const off = stripOffsets[s]
    const bytes = stripByteCounts[s] ?? 0
    if (bytes <= 0) continue
    // Per-strip safety: never read past the file. Misformed TIFFs would
    // otherwise throw "RangeError" from the underlying DataView.
    if (off + bytes > buf.byteLength) {
      throw new Error("thermal TIFF: strip extends past end of file")
    }
    const elems = bytes >> 1
    for (let j = 0; j < elems; j++) {
      counts[dest++] = view.getUint16(off + j * 2, true)
    }
  }
  if (dest !== counts.length) {
    // Most-likely cause: rowsPerStrip * stripCount doesn't cover the
    // image. Surface the discrepancy rather than render partial bytes.
    throw new Error(
      `thermal TIFF: decoded ${dest} pixels, expected ${counts.length}`,
    )
  }

  // Silence linter: rowsPerStrip parsed for documentation only; not
  // needed once strips are sized via stripByteCounts.
  void rowsPerStrip
  void photometric

  return { width, height, counts }
}

// ---------------------------------------------------------------------------
// Calibration: counts → °C
// ---------------------------------------------------------------------------

const KELVIN_TO_CELSIUS = 273.15

/**
 * Map raw uint16 counts to °C using the sidecar's calibration mode.
 *
 * Returns `null` for non-radiometric sources — caller falls back to
 * raw counts in the HUD. Throws when the sidecar is internally
 * inconsistent (e.g. claims FLIR One Pro but lacks Planck constants),
 * so the viewer surfaces the bug rather than rendering nonsense.
 */
export function deriveTemperatureCelsius(
  counts: Uint16Array,
  sidecar: ThermalSidecar,
): Float32Array | null {
  if (!sidecar.radiometric) return null
  if (sidecar.source === "flir_one_pro") {
    if (!sidecar.planck) {
      throw new Error("FLIR sidecar missing Planck constants")
    }
    return planckSignalToCelsius(counts, sidecar.planck, sidecar.emissivity ?? 1)
  }
  // Linear modes carry scale/offset on the sidecar (worker.py writes
  // them for boson_tlinear_high|low + user_defined).
  if (typeof sidecar.scale !== "number") {
    throw new Error(`Linear sidecar (${sidecar.source}) missing scale`)
  }
  return linearToCelsius(counts, sidecar.scale, sidecar.offset ?? 0)
}

function linearToCelsius(
  counts: Uint16Array,
  scale: number,
  offset: number,
): Float32Array {
  const out = new Float32Array(counts.length)
  for (let i = 0; i < counts.length; i++) {
    out[i] = counts[i] * scale + offset - KELVIN_TO_CELSIUS
  }
  return out
}

function planckSignalToCelsius(
  counts: Uint16Array,
  p: ThermalSidecarPlanck,
  emissivity: number,
): Float32Array {
  const out = new Float32Array(counts.length)
  const eps = emissivity > 0 && emissivity <= 1 ? emissivity : 1
  for (let i = 0; i < counts.length; i++) {
    const s = counts[i] / eps
    const denom = p.R2 * (s + p.O)
    const ratio = p.R1 / denom + p.F
    if (ratio > 0) {
      const tK = p.B / Math.log(ratio)
      out[i] = tK - KELVIN_TO_CELSIUS
    } else {
      out[i] = Number.NaN
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Palette + window
// ---------------------------------------------------------------------------

export type PaletteName = "iron" | "grayscale" | "viridis"

const PALETTES: Record<PaletteName, Uint8Array> = {
  iron: buildIronLut(),
  grayscale: buildGrayscaleLut(),
  viridis: buildViridisLut(),
}

export function paletteLut(name: PaletteName): Uint8Array {
  return PALETTES[name]
}

function buildIronLut(): Uint8Array {
  // Matches the iron LUT the worker uses for server-side previews
  // (`backend/gemini/workers/thermal/calibration.py:_build_iron_palette`)
  // so flipping between server preview and client render produces
  // visually consistent imagery.
  const stops: [number, number, number, number][] = [
    [0.0, 0, 0, 0],
    [0.2, 32, 0, 96],
    [0.4, 128, 0, 128],
    [0.55, 224, 32, 32],
    [0.75, 255, 160, 0],
    [0.9, 255, 240, 128],
    [1.0, 255, 255, 255],
  ]
  return rampLut(stops)
}

function buildGrayscaleLut(): Uint8Array {
  return rampLut([
    [0, 0, 0, 0],
    [1, 255, 255, 255],
  ])
}

function buildViridisLut(): Uint8Array {
  // A 6-stop approximation of matplotlib's viridis. Plenty for an
  // interactive viewer; we don't need scientific-paper accuracy.
  return rampLut([
    [0.0, 68, 1, 84],
    [0.2, 65, 68, 135],
    [0.4, 42, 120, 142],
    [0.6, 34, 168, 132],
    [0.8, 122, 209, 81],
    [1.0, 253, 231, 37],
  ])
}

function rampLut(stops: [number, number, number, number][]): Uint8Array {
  const lut = new Uint8Array(256 * 3)
  for (let i = 0; i < 256; i++) {
    const x = i / 255
    let a = stops[0]
    let b = stops[stops.length - 1]
    for (let j = 0; j < stops.length - 1; j++) {
      if (x >= stops[j][0] && x <= stops[j + 1][0]) {
        a = stops[j]
        b = stops[j + 1]
        break
      }
    }
    const span = b[0] - a[0]
    const t = span === 0 ? 0 : (x - a[0]) / span
    lut[i * 3] = Math.round(a[1] + (b[1] - a[1]) * t)
    lut[i * 3 + 1] = Math.round(a[2] + (b[2] - a[2]) * t)
    lut[i * 3 + 2] = Math.round(a[3] + (b[3] - a[3]) * t)
  }
  return lut
}

/**
 * Map per-pixel values into a 256-stop palette and write the result
 * into an `ImageData` buffer. NaN renders black.
 *
 * `values` can be uint16 (raw counts) or Float32Array (°C) — the
 * function is type-agnostic.
 */
export function applyPalette(
  values: Uint16Array | Float32Array,
  width: number,
  height: number,
  vmin: number,
  vmax: number,
  lut: Uint8Array,
): ImageData {
  const out = new ImageData(width, height)
  const data = out.data
  if (!isFinite(vmin) || !isFinite(vmax) || vmax <= vmin) {
    // Degenerate window: solid black.
    for (let i = 0; i < data.length; i += 4) {
      data[i + 3] = 255
    }
    return out
  }
  const span = vmax - vmin
  for (let i = 0, j = 0; i < values.length; i++, j += 4) {
    const v = values[i]
    if (!Number.isFinite(v)) {
      data[j + 3] = 255
      continue
    }
    let norm = (v - vmin) / span
    if (norm < 0) norm = 0
    else if (norm > 1) norm = 1
    const idx = (norm * 255) | 0
    data[j] = lut[idx * 3]
    data[j + 1] = lut[idx * 3 + 1]
    data[j + 2] = lut[idx * 3 + 2]
    data[j + 3] = 255
  }
  return out
}

/**
 * (lo, hi) percentile window over finite values. Same default as the
 * worker's `percentile_window` (2/98) for consistency between
 * server-side previews and the client canvas.
 */
export function percentileWindow(
  values: Uint16Array | Float32Array,
  lo = 2,
  hi = 98,
): [number, number] {
  const finite: number[] = []
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (Number.isFinite(v)) finite.push(v)
  }
  if (finite.length === 0) return [0, 1]
  finite.sort((a, b) => a - b)
  const pick = (p: number): number => {
    const idx = Math.min(
      finite.length - 1,
      Math.max(0, Math.floor((p / 100) * (finite.length - 1))),
    )
    return finite[idx]
  }
  const vmin = pick(lo)
  let vmax = pick(hi)
  if (vmax <= vmin) vmax = vmin + 1
  return [vmin, vmax]
}
