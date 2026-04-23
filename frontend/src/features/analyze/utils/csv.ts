/**
 * Serialize an array of GeoJSON features into a CSV whose columns are the
 * union of every feature's property keys, in first-seen order. Values that
 * contain a comma are quoted; nulls and undefined become empty strings.
 */
export function featuresToCsv(features: GeoJSON.Feature[]): string {
  if (features.length === 0) return ""
  const cols = [
    ...new Set(features.flatMap((f) => Object.keys(f.properties ?? {}))),
  ]
  const header = cols.join(",")
  const lines = features.map((f) =>
    cols
      .map((c) => {
        const v = f.properties?.[c]
        return typeof v === "string" && v.includes(",") ? `"${v}"` : String(v ?? "")
      })
      .join(","),
  )
  return [header, ...lines].join("\n")
}
