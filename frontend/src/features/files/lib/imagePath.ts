/**
 * Derive structured metadata from a MinIO object path that follows the
 * convention used by the upload pipeline:
 *
 *   Raw/{year}/{experiment}/{location}/{population}/{date}/{platform}/{sensor}/{dataset_short_id}/Images/{filename}
 *   Raw/{year}/{experiment}/{location}/{population}/{date}/{platform}/{sensor}/Images/{filename}   (legacy, pre-migration)
 *   Processed/{year}/{experiment}/{location}/{population}/{date}/.../{filename}
 *
 * The wizard's supplemental-data layout `Raw/{date}/{experiment}/{filename}`
 * has no positional metadata after the experiment name — those files
 * surface with empty derived fields. Files that don't match either
 * layout get all-empty fields and survive any filter that doesn't
 * actively reject them.
 */
export interface PathAttrs {
  location: string
  population: string
  date: string
  platform: string
  sensor: string
  /**
   * 8-char hex dataset prefix segment (post Option-A migration). Null
   * for legacy paths that predate the migration and for any path that
   * doesn't include an `Images/` segment.
   */
  datasetShortId: string | null
}

const EMPTY: PathAttrs = {
  location: "",
  population: "",
  date: "",
  platform: "",
  sensor: "",
  datasetShortId: null,
}

/** 8 lowercase hex chars — matches `extractDatasetShortId` output. */
const SHORT_ID_RE = /^[0-9a-f]{8}$/

export function deriveImagePathAttrs(
  objectName: string,
  experimentName: string,
): PathAttrs {
  if (!objectName || !experimentName) return { ...EMPTY }
  const segs = objectName.split("/")
  const expIdx = segs.indexOf(experimentName)
  if (expIdx < 0) return { ...EMPTY }

  // The filename is the last segment; positional metadata lives between
  // the experiment name and the filename.
  //
  // New layout (with dataset short-id): location, population, date,
  //   platform, sensor, {shortId}, Images
  // Legacy layout (no short-id):        location, population, date,
  //   platform, sensor, Images
  //
  // We look at what's immediately before the literal `Images` segment:
  // an 8-hex segment is the dataset short-id. Anything else is treated
  // as a legacy path with no short-id.
  const middle = segs.slice(expIdx + 1, -1)
  const imagesIdx = middle.indexOf("Images")
  let datasetShortId: string | null = null
  let positional = middle
  if (imagesIdx >= 0) {
    const beforeImages = middle[imagesIdx - 1]
    if (beforeImages && SHORT_ID_RE.test(beforeImages)) {
      datasetShortId = beforeImages
      positional = [
        ...middle.slice(0, imagesIdx - 1),
        ...middle.slice(imagesIdx + 1),
      ]
    } else {
      positional = middle.filter((s) => s !== "Images")
    }
  }
  return {
    location: positional[0] ?? "",
    population: positional[1] ?? "",
    date: positional[2] ?? "",
    platform: positional[3] ?? "",
    sensor: positional[4] ?? "",
    datasetShortId,
  }
}

export function fileBaseName(objectName: string): string {
  return objectName.split("/").pop() ?? objectName
}
