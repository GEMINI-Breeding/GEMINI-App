/**
 * Browser port of the ML worker's vegetation mask
 * (gemini/workers/ml/trait_extraction.py `compute_exg_mask`), for the
 * Trait Extraction preview.
 *
 * ExG = 2g − r − b on channel-normalised values; > threshold is
 * vegetation; a 5×5 morphological close fills small gaps, as cv2 does.
 * Fully transparent pixels (outside the ortho) read as black, as the
 * worker's zero fill does — not vegetation, but still in the denominator
 * of the vegetation fraction, exactly like the worker.
 */

/** 1 = vegetation, 0 = not. */
export function exgMask(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  threshold: number,
): Uint8Array {
  const n = width * height
  const raw = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3]
    const r = a === 0 ? 0 : rgba[i * 4]
    const g = a === 0 ? 0 : rgba[i * 4 + 1]
    const b = a === 0 ? 0 : rgba[i * 4 + 2]
    const total = r + g + b || 1
    const exg = (2 * g - r - b) / total
    raw[i] = exg > threshold ? 1 : 0
  }
  return erode(dilate(raw, width, height), width, height)
}

// 5×5 square structuring element. Out-of-image neighbours are ignored,
// matching cv2's default border behaviour for dilate/erode.
const R = 2

function dilate(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(src.length)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0
      for (let dy = -R; dy <= R && !v; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx
          if (xx >= 0 && xx < w && src[yy * w + xx]) {
            v = 1
            break
          }
        }
      }
      out[y * w + x] = v
    }
  return out
}

function erode(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(src.length)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 1
      for (let dy = -R; dy <= R && v; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx
          if (xx >= 0 && xx < w && !src[yy * w + xx]) {
            v = 0
            break
          }
        }
      }
      out[y * w + x] = v
    }
  return out
}

/** Share of the crop classed as vegetation, rounded like the worker (4 dp). */
export function vegetationFraction(mask: Uint8Array): number {
  if (mask.length === 0) return 0
  let v = 0
  for (const m of mask) v += m
  return Math.round((v / mask.length) * 10_000) / 10_000
}

/** RGBA overlay: vegetation tinted green (as main's preview), rest as-is. */
export function tintVegetation(
  rgba: Uint8ClampedArray,
  mask: Uint8Array,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba)
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    out[i * 4] = rgba[i * 4] * 0.4
    out[i * 4 + 1] = Math.min(255, rgba[i * 4 + 1] * 0.4 + 150)
    out[i * 4 + 2] = rgba[i * 4 + 2] * 0.4
  }
  return out
}
