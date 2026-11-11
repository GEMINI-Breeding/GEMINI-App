/**
 * Finding objects from a description ("zero-shot"): which models to suggest
 * and how to write the prompt. Kept short on purpose: the form shows it.
 *
 * The advice comes from the lab's prompt study on cowpea flowers and pods
 * (AgVFM, FINAL-CVPR): SAM 3 found by far the most (pods mAP50 0.37, flowers
 * 0.55), OWLv2 next on flowers (0.40), Grounding DINO least (≤ 0.05 on real
 * images). The best prompts named one object with its colour, crop and part,
 * and said what it is not.
 */

export interface ZeroShotPreset {
  id: string
  label: string
  hf_model_id: string
  /** One line on when to use it. */
  note: string
  /** Confidence to start from on the results. */
  threshold: number
  needsToken: boolean
  /** Can draw outlines (segmentation), not only boxes. */
  outlines: boolean
}

export const ZERO_SHOT_PRESETS: ZeroShotPreset[] = [
  {
    id: "sam3",
    label: "SAM 3 (recommended)",
    hf_model_id: "facebook/sam3",
    note: "Found the most cowpea pods and flowers in the lab's tests, with outlines. Needs a free Hugging Face token with access to facebook/sam3.",
    threshold: 0.3,
    needsToken: true,
    outlines: true,
  },
  {
    id: "owlv2",
    label: "OWLv2",
    hf_model_id: "google/owlv2-base-patch16-ensemble",
    note: "Boxes only, no token needed. Second best on flowers; weaker on pods.",
    threshold: 0.1,
    needsToken: false,
    outlines: false,
  },
]

export function presetFor(hfModelId: string): ZeroShotPreset | undefined {
  const id = hfModelId.trim().toLowerCase()
  return ZERO_SHOT_PRESETS.find((p) => p.hf_model_id.toLowerCase() === id)
}

export const PROMPT_PLACEHOLDER =
  "pod: one mottled cowpea pod, not a leaf, not a stem\nflower: a single yellow cowpea flower with open petals, not a bud"

/** The prompt tips, one line each. */
export const PROMPT_TIPS = [
  "One object per line, as name: description. The name becomes the class (and the trait).",
  "Describe a single object: “one / a single” + colour + crop + part, e.g. “a single yellow cowpea flower”.",
  "Say what it is not when it gets confused: “…, not a leaf, not a stem”.",
  "Check a few plots before running every date, and adjust the confidence on the results.",
]

/** (name, description) pairs from a prompt, as the worker reads it. */
export function promptClasses(
  prompt: string,
): { name: string; text: string }[] {
  const t = prompt.trim()
  if (!t) return []
  const parts =
    t.includes("\n") || t.includes(";") || t.includes(":")
      ? t.replace(/;/g, "\n").split("\n")
      : t.split(",")
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const i = p.indexOf(":")
      if (i > 0 && p.slice(i + 1).trim())
        return { name: p.slice(0, i).trim(), text: p.slice(i + 1).trim() }
      return { name: p, text: p }
    })
}
