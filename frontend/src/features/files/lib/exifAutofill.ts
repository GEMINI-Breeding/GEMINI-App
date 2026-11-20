/**
 * Pre-fill the upload form's date / platform / sensor from an image's EXIF.
 *
 * Main did this server-side (`POST /files/extract-metadata`). GEMINIbase has
 * no such route, and the call site was left pointing at a throwing shim
 * wrapped in a bare `catch` — so the field simply never populated and the
 * user re-typed what the file already knew. Reading EXIF in the browser is
 * both simpler and faster: the file is already local, so there is nothing to
 * upload before the form can be filled.
 *
 * `exifr` is already a dependency (see `features/process/lib/imageGps.ts`,
 * which parses GPS the same way for the GCP picker).
 */
import exifr from "exifr"

export interface ExifAutofill {
  /** yyyy-mm-dd, from DateTimeOriginal / CreateDate. */
  date?: string
  /** EXIF Make, e.g. "DJI". */
  platform?: string
  /** EXIF Model, e.g. "FC6310S". */
  sensor?: string
}

/** EXIF dates are "YYYY:MM:DD HH:MM:SS"; exifr usually hands back a Date. */
function toIsoDate(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // Local date parts, not toISOString() — a UTC shift can land the photo
    // on the wrong calendar day for anyone west of Greenwich.
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, "0")
    const d = String(value.getDate()).padStart(2, "0")
    return `${y}-${m}-${d}`
  }
  if (typeof value === "string") {
    const m = value.match(/^(\d{4})[:-](\d{2})[:-](\d{2})/)
    if (m) return `${m[1]}-${m[2]}-${m[3]}`
  }
  return undefined
}

function clean(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  // Strip NUL padding first: EXIF ASCII fields are NUL-terminated, so
  // trimming before stripping leaves the whitespace that preceded the NUL
  // (e.g. "  DJI \0" -> "DJI " rather than "DJI").
  const trimmed = value.replace(/\0/g, "").trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Best-effort: any failure yields `{}` so the user just fills the form in
 * by hand. Never throws, and never blocks the upload.
 */
export async function readExifAutofill(file: File): Promise<ExifAutofill> {
  try {
    const tags = (await exifr.parse(file, {
      pick: ["DateTimeOriginal", "CreateDate", "ModifyDate", "Make", "Model"],
    })) as Record<string, unknown> | undefined
    if (!tags) return {}
    return {
      date:
        toIsoDate(tags.DateTimeOriginal) ??
        toIsoDate(tags.CreateDate) ??
        toIsoDate(tags.ModifyDate),
      platform: clean(tags.Make),
      sensor: clean(tags.Model),
    }
  } catch {
    return {}
  }
}
