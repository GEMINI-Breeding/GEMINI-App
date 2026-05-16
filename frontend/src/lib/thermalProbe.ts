/**
 * Reliable thermal-data byte-peek probes shared across the upload UI.
 *
 * Two consumers:
 *   - `features/import/lib/detection-engine.ts` (wizard auto-detect
 *     for Trait/Genomic-adjacent file groups).
 *   - `features/files/components/UploadList.tsx` (auto-render the
 *     thermal-calibration block on the Image Data form when the
 *     dropped batch actually contains thermal data).
 *
 * Why a shared module: the probe contract is subtle (e.g. Pillow's
 * I;16 writer omits the `SamplesPerPixel` TIFF tag, so a strict
 * check must treat absence as `=1`). Duplicating it invites drift —
 * the kind of drift the Pillow-SamplesPerPixel bug already burned us
 * on, on the worker output side.
 */

type FileLike = Blob & { name: string }

const FLIR_MARKER = "FLIR Systems"

const TIFF_TAGS = {
  bitsPerSample: 0x0102,
  photometricInterpretation: 0x0106,
  samplesPerPixel: 0x0115,
} as const

async function readBoundedBuffer(
  file: FileLike,
  bytes: number,
): Promise<Uint8Array> {
  return readRange(file, 0, bytes)
}

async function readRange(
  file: FileLike,
  start: number,
  length: number,
): Promise<Uint8Array> {
  // FileReader is the lowest-common-denominator reader that works in
  // both real browsers and jsdom (Blob.arrayBuffer() is missing on
  // jsdom 22's polyfill, which silently returns an empty buffer and
  // makes every probe false-negative under Vitest).
  const slice = file.slice(start, start + length)
  const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error("read failed"))
    reader.readAsArrayBuffer(slice as Blob)
  })
  return new Uint8Array(buf)
}

function findAscii(bytes: Uint8Array, needle: string): number {
  if (needle.length === 0) return 0
  const first = needle.charCodeAt(0)
  outer: for (let i = 0; i <= bytes.length - needle.length; i++) {
    if (bytes[i] !== first) continue
    for (let j = 1; j < needle.length; j++) {
      if (bytes[i + j] !== needle.charCodeAt(j)) continue outer
    }
    return i
  }
  return -1
}

/**
 * Detects a FLIR-One-Pro–class radiometric JPEG by scanning the first
 * 64 KB for the ASCII bytes "FLIR Systems" (the EXIF `Make` tag). A
 * regular RGB JPEG never carries that substring. Single-byte-scan,
 * no EXIF parsing dependency.
 */
export async function jpegLooksLikeFlir(file: FileLike): Promise<boolean> {
  try {
    const bytes = await readBoundedBuffer(file, 65536)
    return findAscii(bytes, FLIR_MARKER) >= 0
  } catch {
    return false
  }
}

/**
 * Detects a 16-bit single-channel `BlackIsZero` TIFF — the byte
 * shape every Boson-class radiometric raw emits (TLinear high/low
 * and even Boson AGC non-radiometric land here; they're all the
 * same on-disk shape). Parses just enough of the TIFF IFD0 to read
 * three structural tags.
 *
 * Pillow's I;16 writer omits SamplesPerPixel because the TIFF 6.0
 * spec defaults it to 1; absence is therefore treated as 1, not as
 * "missing → reject". The viewer's decoder (thermal.ts) follows
 * the same rule — that contract is the one that bit us during
 * Phase C live verification.
 */
export async function tiffLooksLikeThermal(file: FileLike): Promise<boolean> {
  try {
    // Header is just 8 bytes: byte order (II/MM), magic 42, and the
    // offset to IFD0. The IFD itself may live anywhere in the file —
    // farm-ng's Amiga thermal rig writes a TIFF whose IFD0 sits
    // *after* the image strips (~470 KB into a 484 KB file), so the
    // probe can't assume the IFD is in the first 1 KB.
    const head = await readRange(file, 0, 8)
    if (head.length < 8) return false
    const littleEndian = head[0] === 0x49 && head[1] === 0x49
    const bigEndian = head[0] === 0x4d && head[1] === 0x4d
    if (!littleEndian && !bigEndian) return false
    const headView = new DataView(
      head.buffer,
      head.byteOffset,
      head.byteLength,
    )
    const le = littleEndian
    const magic = headView.getUint16(2, le)
    if (magic !== 42) return false
    const ifd0Offset = headView.getUint32(4, le)
    if (ifd0Offset < 8) return false

    // A maxed-out IFD with every public tag still fits in well under
    // 4 KB (2 bytes for the entry count + 12 per entry); 4 KB covers
    // ~340 entries which is far past anything real.
    const ifdBytes = await readRange(file, ifd0Offset, 4096)
    if (ifdBytes.length < 2) return false
    const ifdView = new DataView(
      ifdBytes.buffer,
      ifdBytes.byteOffset,
      ifdBytes.byteLength,
    )
    const numEntries = ifdView.getUint16(0, le)
    let bitsPerSample = 0
    let samplesPerPixel = 1 // TIFF 6.0 default; Pillow omits the tag
    let photometric = -1
    for (let i = 0; i < numEntries; i++) {
      const entry = 2 + i * 12
      if (entry + 12 > ifdBytes.length) break
      const tag = ifdView.getUint16(entry, le)
      const type = ifdView.getUint16(entry + 2, le)
      // SHORT (3) values <=2 entries fit in the 4-byte value field;
      // that's the case for all three tags we read here.
      const value = type === 3 ? ifdView.getUint16(entry + 8, le) : 0
      if (tag === TIFF_TAGS.bitsPerSample) bitsPerSample = value
      else if (tag === TIFF_TAGS.samplesPerPixel) samplesPerPixel = value
      else if (tag === TIFF_TAGS.photometricInterpretation) {
        photometric = value
      }
    }
    return (
      bitsPerSample === 16 && samplesPerPixel === 1 && photometric === 1
    )
  } catch {
    return false
  }
}

/**
 * Result of probing a batch of files for thermal content. `hint` lets
 * the caller pre-select a sensible calibration default (FLIR JPEGs
 * are self-describing → flir_one_pro; Boson TIFFs need a mode pick).
 */
export type ThermalProbeResult =
  | { hasThermal: false; hint: null }
  | { hasThermal: true; hint: "flir_jpeg" | "boson_tiff" }

const JPEG_EXTS = new Set(["jpg", "jpeg"])
const TIFF_EXTS = new Set(["tif", "tiff"])

function extension(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? ""
}

/**
 * Probe a batch of files and return whether any of them is thermal.
 *
 * Stops at the first match (a single thermal frame in the batch
 * means the user intends a thermal dataset). FLIR JPEGs are
 * preferred to TIFFs in the hint because FLIR's embedded Planck
 * constants make the JPEG branch fully automatic, whereas Boson
 * TIFFs need a user-confirmed mode pick.
 */
export async function probeFilesForThermal(
  files: readonly FileLike[],
): Promise<ThermalProbeResult> {
  // Two passes: JPEGs first (cheap byte-scan + always reliable),
  // then TIFFs (header parse). A single hit short-circuits.
  for (const f of files) {
    const ext = extension(f.name)
    if (!JPEG_EXTS.has(ext)) continue
    if (await jpegLooksLikeFlir(f)) {
      return { hasThermal: true, hint: "flir_jpeg" }
    }
  }
  for (const f of files) {
    const ext = extension(f.name)
    if (!TIFF_EXTS.has(ext)) continue
    if (await tiffLooksLikeThermal(f)) {
      return { hasThermal: true, hint: "boson_tiff" }
    }
  }
  return { hasThermal: false, hint: null }
}
