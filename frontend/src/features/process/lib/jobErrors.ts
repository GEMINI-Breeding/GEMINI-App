/**
 * humanizeJobError — translate a worker exception string into user-readable
 * copy. The raw error_message persisted on gemini.jobs.error_message is great
 * for debugging but unactionable for breeders / agronomists who run the
 * pipeline. Map known patterns to a short headline + suggested next step;
 * fall back to a generic copy when nothing matches. The raw text is always
 * returned in `details` so the wizard can surface it behind a disclosure.
 */

export type HumanizedJobError = {
  /** Short, plain-English description of what went wrong. */
  headline: string
  /** Optional one-sentence suggestion of what to do next. */
  hint?: string
  /** The raw worker error_message, unchanged. */
  details: string
}

const NOSUCHKEY = /NoSuchKey|Object does not exist/i

function fileNameFromMinioPath(raw: string): string | null {
  const m = raw.match(/object_name:\s*([^,]+)/i)
  if (m) return m[1].trim()
  // Fallback: the message often contains the key inline.
  const m2 = raw.match(/[A-Za-z0-9._%/-]+\.(geojson|tif|tiff|json|png|csv)/)
  return m2 ? m2[0] : null
}

export function humanizeJobError(
  stepKey: string,
  raw: string | null | undefined,
): HumanizedJobError {
  const details = (raw ?? "").trim()
  if (!details) {
    return {
      headline: "The job failed without a recorded reason.",
      hint: "Check the worker logs (docker logs geminibase-worker-*) for clues, then retry.",
      details: "",
    }
  }

  // ── Storage: missing object ────────────────────────────────────────────
  if (NOSUCHKEY.test(details)) {
    const obj = fileNameFromMinioPath(details) ?? ""
    if (/plot-boundaries\//i.test(obj) || /boundary/i.test(details)) {
      return {
        headline: "Plot-boundary file is missing from storage.",
        hint: "Open Plot Boundary Prep, draw or generate boundaries, save a new version, then retry trait extraction.",
        details,
      }
    }
    if (/odm_orthophoto\.tif|orthomosaic|ortho/i.test(obj)) {
      return {
        headline: "Orthomosaic file is missing from storage.",
        hint: "Re-run the Orthomosaic step (or import an existing ortho) for this scope, then retry.",
        details,
      }
    }
    if (/dem|elevation/i.test(obj)) {
      return {
        headline: "DEM (elevation) file is missing from storage.",
        hint: "Either remove the DEM input from this step (canopy height will be skipped) or upload the expected DEM file, then retry.",
        details,
      }
    }
    return {
      headline: `A required file is missing from storage${obj ? `: ${obj}` : ""}.`,
      hint: "Check the upload step for this scope — the input file may not have landed where the worker expects.",
      details,
    }
  }

  // ── ML: AgRowStitch vendor dir missing (RUN_STITCH) ───────────────────
  if (/AgRowStitch is not importable/i.test(details)) {
    return {
      headline: "Stitching is not available in this deployment.",
      hint: "AgRowStitch must be vendored into the worker image. See gemini/workers/stitch/README.md for the one-time setup.",
      details,
    }
  }

  // ── Orthomosaic: OpenMVS rejected every image during densification ─────
  // Fires when the worker's _diagnose_odm_failure attached the
  // "OpenMVS rejected every image during dense reconstruction" hint.
  // The actionable next step is in the UI: switch the Reconstruction
  // quality dropdown off Lowest. We surface that explicitly.
  if (/OpenMVS rejected every image/i.test(details)) {
    return {
      headline: "Orthomosaic failed: quality preset too aggressive for this dataset.",
      hint: "Re-run with Reconstruction quality set to Low or Medium (the Lowest preset uses depthmap-resolution=320 + pc-quality=lowest, which can reject every image on some flights).",
      details,
    }
  }

  // ── Orthomosaic: ODM ran out of memory during depth-map fusion ─────────
  if (/out-of-memory during depth-map fusion/i.test(details)) {
    return {
      headline: "Orthomosaic failed: not enough memory for depth-map fusion.",
      hint: "Raise Docker Desktop's memory limit to ≥16 GiB (Settings → Resources → Memory), or re-run with a lower Reconstruction quality (Low/Medium) to shrink the depth-map step's working set.",
      details,
    }
  }

  // ── Orthomosaic: NodeODM working volume out of disk ────────────────────
  if (/ran out of disk space/i.test(details) && /NodeODM/i.test(details)) {
    return {
      headline: "Orthomosaic failed: NodeODM is out of disk space.",
      hint: "Open the NodeODM admin UI and prune old tasks, or free space on the Docker volume, then retry.",
      details,
    }
  }

  // ── Orthomosaic: not enough overlap between images ─────────────────────
  if (
    /not enough overlapping features/i.test(details) ||
    /couldn't match any image pairs/i.test(details)
  ) {
    return {
      headline: "Orthomosaic failed: ODM couldn't reconstruct from these images.",
      hint: "ODM needs ~80% forward overlap and valid EXIF GPS. Verify the flight plan, remove blurry frames, and check that EXIF was preserved through any pre-processing.",
      details,
    }
  }

  // ── Orthomosaic: bad EXIF / camera metadata ────────────────────────────
  if (/couldn't establish a valid scene from the input EXIF/i.test(details)) {
    return {
      headline: "Orthomosaic failed: image metadata looks invalid.",
      hint: "ODM saw a flipped Z axis and an unbounded scene — usually an EXIF orientation or camera-model issue. Verify image orientation and GPS metadata, or strip and re-tag EXIF before re-uploading.",
      details,
    }
  }

  // ── Orthomosaic: unrecognized failure, but worker pointed at a log ─────
  // The worker now appends "Full ODM log: <path>" to every ODM failure;
  // surface it in the hint so the user (or support) can find the log
  // without docker-exec'ing into MinIO.
  if (/^ODM processing failed:/i.test(details)) {
    const logMatch = details.match(/Full ODM log:\s*(\S+)/i)
    return {
      headline: "Orthomosaic failed.",
      hint: logMatch
        ? `Underlying ODM error wasn't auto-diagnosed. Saved log: ${logMatch[1]}`
        : "Underlying ODM error wasn't auto-diagnosed. See the technical details below.",
      details,
    }
  }

  // ── ML: Roboflow inference (LOCATE_PLANTS) ─────────────────────────────
  if (/Roboflow.*401|401 Unauthorized/i.test(details)) {
    return {
      headline: "Roboflow rejected the API key.",
      hint: "Open the Inference page, paste a valid Roboflow API key, click Save, then retry.",
      details,
    }
  }
  if (/Roboflow.*404|model.*not found.*404|not found \(404\)/i.test(details)) {
    return {
      headline: "Roboflow could not find that model.",
      hint: "Check the Roboflow model id on the Models page (workspace/model or workspace/model/version), correct it, then retry.",
      details,
    }
  }
  if (/Roboflow/i.test(details)) {
    return {
      headline: "Roboflow inference failed.",
      hint: "Check the Models registry entry and the API key on your profile, then retry.",
      details,
    }
  }

  // ── Generic fallback ──────────────────────────────────────────────────
  const stepName =
    stepKey === "trait_extraction"
      ? "Trait extraction"
      : stepKey === "orthomosaic"
        ? "Orthomosaic"
        : stepKey === "stitching"
          ? "Stitching"
          : stepKey === "inference"
            ? "Inference"
            : "This step"
  return {
    headline: `${stepName} failed.`,
    hint: "See the technical details below. If the cause isn't obvious, retry — transient backend issues sometimes clear on a second attempt.",
    details,
  }
}
