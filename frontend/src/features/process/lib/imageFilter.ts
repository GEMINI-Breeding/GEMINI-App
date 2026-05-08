/**
 * `image_filter.txt` — sidecar listing image basenames the user has
 * excluded from ODM. Lives at `Raw/{scope}/Images/image_filter.txt`
 * alongside `gcp_list.txt` and `geo.txt`.
 *
 * Format: one basename per line. Lines beginning with `#` are comments.
 * Blank lines are ignored. The ODM worker honors this list when
 * staging images for NodeODM and when forwarding `geo.txt`.
 */

const HEADER =
  "# Excluded images for ODM. One filename per line. Lines starting with # are ignored.\n"

export function parseImageFilter(text: string): Set<string> {
  const out = new Set<string>()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    out.add(line)
  }
  return out
}

export function serializeImageFilter(excluded: Iterable<string>): string {
  const sorted = Array.from(new Set(excluded))
    .filter((s) => s.length > 0)
    .sort()
  if (sorted.length === 0) return HEADER
  return `${HEADER}${sorted.join("\n")}\n`
}
