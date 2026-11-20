/**
 * What to change before re-stitching plots that failed, from the failure
 * messages and the settings the failed run used (its manifest's `config`).
 *
 * Mirrors the agent's ground-stitching skill: change one thing at a time,
 * starting with the likeliest cause. The knobs:
 *  - forward_limit: how many frames ahead AgRowStitch jumps when matching.
 *    Lower = more overlap between matched frames (helps "no match").
 *  - min_inliers: matched points needed to accept a pair. Lower accepts
 *    weaker matches (bare soil, little texture).
 *  - max_reprojection_error: pixel error allowed for a match. Higher accepts
 *    more pairs, at some cost to seams.
 *  - batch_size: frames stitched together before batches are joined.
 *    Smaller = less memory and less drift.
 */

export type StitchKnob =
  | "forward_limit"
  | "min_inliers"
  | "max_reprojection_error"
  | "batch_size"

/** AgRowStitch's defaults on the Amiga, used when a manifest lacks a value. */
export const STITCH_DEFAULTS: Record<StitchKnob, number> = {
  forward_limit: 4,
  min_inliers: 20,
  max_reprojection_error: 1.0,
  batch_size: 10,
}

export interface StitchAdvice {
  /** The likely cause, in words. */
  cause: string
  /** What to try, in words. */
  advice: string
  /** The suggested settings for the re-run (only the changed knobs). */
  settings: Partial<Record<StitchKnob, number>>
  /** If this does not fix it, the next things to try. */
  thenTry: string[]
}

function num(config: Record<string, unknown>, k: StitchKnob): number {
  const v = config[k]
  return typeof v === "number" && Number.isFinite(v) ? v : STITCH_DEFAULTS[k]
}

export function adviseRestitch(
  errors: string[],
  config: Record<string, unknown> = {},
): StitchAdvice {
  const text = errors.join("\n").toLowerCase()
  const fl = num(config, "forward_limit")
  const inl = num(config, "min_inliers")
  const err = num(config, "max_reprojection_error")
  const batch = num(config, "batch_size")

  if (/memory|killed|oom|bad_alloc/.test(text))
    return {
      cause: "The stitch ran out of memory.",
      advice: `Stitch fewer frames at once: batch size ${batch} → ${Math.max(2, Math.floor(batch / 2))}.`,
      settings: { batch_size: Math.max(2, Math.floor(batch / 2)) },
      thenTry: [
        'Add "camera: partial_affine" to the custom AgRowStitch options',
        "Tighten the plots' start and end frames so each uses fewer frames",
      ],
    }

  if (/direction|mirror|order/.test(text))
    return {
      cause: "The frames seem to be stitched in the wrong direction.",
      advice:
        "Check these plots' stitching direction in Plot Marking, then re-stitch with the same settings.",
      settings: {},
      thenTry: [],
    }

  // "wrote no mosaic", "no match", "not enough inliers", homography errors:
  // the frames did not match well enough to chain.
  if (fl > 1)
    return {
      cause:
        "AgRowStitch could not chain these plots' frames: too little overlap between the frames it tried to match, or too little texture (bare soil, hard shadows).",
      advice: `Match frames closer together: forward limit ${fl} → ${Math.max(1, Math.floor(fl / 2))}.`,
      settings: { forward_limit: Math.max(1, Math.floor(fl / 2)) },
      thenTry: [
        `Accept weaker matches: minimum inliers ${inl} → ${Math.max(8, Math.round(inl * 0.6))}`,
        `Allow more pixel error: max reprojection error ${err} → ${Math.min(3, err * 2)}`,
        "Tighten the plots' start and end frames in Plot Marking",
      ],
    }
  return {
    cause:
      "Frames already match one step apart and still fail: the frames have little texture to match.",
    advice: `Accept weaker matches: minimum inliers ${inl} → ${Math.max(8, Math.round(inl * 0.6))}, and allow more pixel error (${err} → ${Math.min(3, err * 2)}).`,
    settings: {
      min_inliers: Math.max(8, Math.round(inl * 0.6)),
      max_reprojection_error: Math.min(3, err * 2),
    },
    thenTry: ["Tighten the plots' start and end frames in Plot Marking"],
  }
}
