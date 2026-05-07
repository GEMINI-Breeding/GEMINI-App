/**
 * Derive structured metadata from a MinIO object path that follows the
 * convention used by the upload pipeline:
 *
 *   Raw/{year}/{experiment}/{location}/{population}/{date}/{platform}/{sensor}/Images/{filename}
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
}

const EMPTY: PathAttrs = {
  location: "",
  population: "",
  date: "",
  platform: "",
  sensor: "",
}

export function deriveImagePathAttrs(
  objectName: string,
  experimentName: string,
): PathAttrs {
  if (!objectName || !experimentName) return { ...EMPTY }
  const segs = objectName.split("/")
  const expIdx = segs.indexOf(experimentName)
  if (expIdx < 0) return { ...EMPTY }

  // The filename is the last segment; positional metadata lives between
  // the experiment name and the filename. The literal `Images/` (or any
  // other Images-style folder) sits between sensor and filename for
  // drone uploads — we drop it so it doesn't leak into derived values.
  const tail = segs.slice(expIdx + 1, -1).filter((s) => s !== "Images")
  return {
    location: tail[0] ?? "",
    population: tail[1] ?? "",
    date: tail[2] ?? "",
    platform: tail[3] ?? "",
    sensor: tail[4] ?? "",
  }
}

export function fileBaseName(objectName: string): string {
  return objectName.split("/").pop() ?? objectName
}
