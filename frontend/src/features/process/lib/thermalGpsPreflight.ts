/**
 * Thermal GPS preflight for RUN_ODM submission.
 *
 * ODM needs per-image GPS to align flight imagery. Boson-class thermal
 * TIFFs carry no GPS in EXIF, so a RUN_ODM job submitted against a
 * Boson dataset fails ~10 minutes in with "Not enough features". The
 * THERMAL_EXTRACT worker (Phase B) writes a per-dataset summary at
 * `RawThermal/thermal_dataset.json` with a `has_gps` flag — the
 * frontend reads that to short-circuit the obviously-doomed
 * submission.
 *
 * Non-thermal datasets have no sidecar (404). That is *not* an error;
 * we simply don't block — RUN_ODM proceeds as it did pre-thermal.
 *
 * See `backend/gemini/workers/thermal/worker.py:_thermal_extract_job`
 * for the writer side of this contract.
 */
import { OpenAPI } from "@/client"
import type { AerialScope } from "@/features/process/lib/paths"
import { rawImagesPrefix } from "@/features/process/lib/paths"
import { getToken } from "@/lib/auth"

const DEFAULT_BUCKET = "gemini"

export type ThermalGpsPreflightResult =
  | { kind: "ok"; thermal: boolean; hasGps: boolean }
  | { kind: "missing_gps"; mode: string; totalFiles: number }
  | { kind: "sidecar_unreadable"; reason: string }

/**
 * Typed error so the RunDetail handler can route this specific
 * failure to a modal dialog (per memory feedback_error_dialogs)
 * rather than the generic toast. Carries the calibration mode + file
 * count so the dialog can quote them back to the user.
 */
export class ThermalGpsRequiredError extends Error {
  readonly kind = "thermal_gps_required"
  readonly mode: string
  readonly totalFiles: number

  constructor(mode: string, totalFiles: number) {
    super(
      `This thermal dataset (${mode}) has no per-image GPS. ` +
        "ODM needs per-image GPS to mosaic — upload a GPS log alongside " +
        "the images or use a co-captured RGB stream.",
    )
    this.name = "ThermalGpsRequiredError"
    this.mode = mode
    this.totalFiles = totalFiles
  }
}

export function isThermalGpsRequiredError(
  err: unknown,
): err is ThermalGpsRequiredError {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { kind?: string }).kind === "thermal_gps_required"
  )
}

interface ThermalDatasetJson {
  mode?: string
  has_gps?: boolean
  total_files?: number
  radiometric?: boolean
}

function apiUrl(path: string): string {
  return `${(OpenAPI.BASE ?? "").replace(/\/$/, "")}${path}`
}

/**
 * Build the MinIO key the worker writes its per-dataset summary to.
 * Mirrors the `RawThermal/` sibling of `Images/` inside the per-dataset
 * subdir (post Option-A migration):
 *
 *   Raw/.../{sensor}/{shortId}/Images/          ← ODM input
 *   Raw/.../{sensor}/{shortId}/RawThermal/      ← worker outputs
 *   Raw/.../{sensor}/{shortId}/RawThermal/thermal_dataset.json
 */
function thermalSummaryPath(
  scope: AerialScope,
  datasetShortId: string,
): string {
  const prefix = rawImagesPrefix(scope, datasetShortId) // ends with "Images/"
  if (!prefix.endsWith("/Images/")) {
    // Defensive: a future tweak to rawImagesPrefix could break the
    // sibling assumption. Surface that loudly.
    throw new Error(
      `thermalSummaryPath: expected '/Images/' suffix, got ${prefix}`,
    )
  }
  return `${prefix.slice(0, -"/Images/".length)}/RawThermal/thermal_dataset.json`
}

/**
 * Check whether the dataset for `scope` + `datasetShortId` is a
 * thermal dataset with no GPS. Resolves to a discriminated union so
 * callers can branch without inspecting HTTP details.
 */
export async function checkThermalGpsPreflight(
  scope: AerialScope,
  datasetShortId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ThermalGpsPreflightResult> {
  const key = thermalSummaryPath(scope, datasetShortId)
  const url = apiUrl(`/api/files/download/${DEFAULT_BUCKET}/${key}`)
  let resp: Response
  try {
    resp = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
  } catch (err) {
    // Network blip — don't block ODM on transport noise; the worker
    // will report its own failure later if there really is no data.
    return {
      kind: "sidecar_unreadable",
      reason: err instanceof Error ? err.message : String(err),
    }
  }
  if (resp.status === 404) {
    // Not a thermal dataset (or THERMAL_EXTRACT hasn't run yet). The
    // RUN_ODM flow proceeds normally.
    return { kind: "ok", thermal: false, hasGps: false }
  }
  if (!resp.ok) {
    return {
      kind: "sidecar_unreadable",
      reason: `HTTP ${resp.status}`,
    }
  }
  let summary: ThermalDatasetJson
  try {
    summary = (await resp.json()) as ThermalDatasetJson
  } catch (err) {
    return {
      kind: "sidecar_unreadable",
      reason: err instanceof Error ? err.message : "invalid JSON",
    }
  }
  const hasGps = summary.has_gps === true
  if (!hasGps) {
    return {
      kind: "missing_gps",
      mode: summary.mode ?? "unknown",
      totalFiles: summary.total_files ?? 0,
    }
  }
  return { kind: "ok", thermal: true, hasGps: true }
}
