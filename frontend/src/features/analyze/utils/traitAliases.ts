/**
 * Shared alias utilities for trait GeoJSON property lookup.
 *
 * Used by AnalyzeDashboard (Table + Query tabs) and TraitMap so that column
 * naming variations ("col", "COLUMN", "bed"; "row", "ROW", "tier") are handled
 * consistently everywhere in the Analyze feature.
 */

/** Keys that represent the "column" spatial position. */
export const COL_KEY_SET = new Set(["col", "column", "bed"]);
/** Keys that represent the "row" spatial position. */
export const ROW_KEY_SET = new Set(["row", "tier"]);

/**
 * Union of all positional keys (col + row aliases).
 * Useful for excluding position columns from metric display.
 */
export const POSITION_KEY_SET = new Set([...COL_KEY_SET, ...ROW_KEY_SET]);

/**
 * Deduplicate column keys:
 * - case-insensitively (keeps first occurrence of "Col"/"col"/"COL")
 * - alias-aware: all COL_KEY_SET members ("col", "column", "bed") are treated
 *   as the same column, and all ROW_KEY_SET members ("row", "tier") likewise.
 *   The first alias encountered wins.
 */
export function deduplicateKeys(keys: string[]): string[] {
  const seen = new Set<string>();
  const aliasGroupSeen = new Set<string>(); // "col" | "row" — one per alias group

  return keys.filter((k) => {
    const lower = k.toLowerCase();
    // Collapse alias groups first
    const group = COL_KEY_SET.has(lower) ? "col" : ROW_KEY_SET.has(lower) ? "row" : null;
    if (group) {
      if (aliasGroupSeen.has(group)) return false;
      aliasGroupSeen.add(group);
    }
    if (seen.has(lower)) return false;
    seen.add(lower);
    return true;
  });
}

/**
 * Order columns so COL/ROW come first, then other metadata, then numeric traits.
 * Also deduplicates case-insensitively AND treats all COL_KEY_SET / ROW_KEY_SET
 * members as the same column (so "col" and "COLUMN" won't both appear).
 */
export function orderColumns(
  allKeys: string[],
  metaCols: string[],
  numCols: string[]
): string[] {
  const deduped = deduplicateKeys(allKeys);
  const colKey = deduped.find((k) => COL_KEY_SET.has(k.toLowerCase()));
  const rowKey = deduped.find((k) => ROW_KEY_SET.has(k.toLowerCase()));
  const priority = [colKey, rowKey].filter(Boolean) as string[];

  const remainingMeta = metaCols.filter(
    (k) =>
      !priority.includes(k) &&
      !COL_KEY_SET.has(k.toLowerCase()) &&
      !ROW_KEY_SET.has(k.toLowerCase()) &&
      deduped.includes(k)
  );
  const remainingNum = numCols.filter(
    (k) =>
      deduped.includes(k) &&
      !priority.includes(k) &&
      !COL_KEY_SET.has(k.toLowerCase()) &&
      !ROW_KEY_SET.has(k.toLowerCase())
  );

  return [...priority, ...remainingMeta, ...remainingNum].filter((c) => c !== "");
}

/**
 * Look up a property value by key, falling back to all case variants and
 * semantic aliases for COL_KEY_SET / ROW_KEY_SET columns.
 */
export function lookupProperty(
  properties: Record<string, unknown>,
  colKey: string
): unknown {
  if (colKey in properties) return properties[colKey];
  const lower = colKey.toLowerCase();
  const keySet = COL_KEY_SET.has(lower)
    ? COL_KEY_SET
    : ROW_KEY_SET.has(lower)
    ? ROW_KEY_SET
    : null;
  if (keySet) {
    for (const alias of keySet) {
      const variants = [
        alias,
        alias.toUpperCase(),
        alias.charAt(0).toUpperCase() + alias.slice(1),
      ];
      for (const variant of variants) {
        if (variant in properties) return properties[variant];
      }
    }
  }
  return undefined;
}

export const PLOT_FILTER_FIELDS = [
  "col",
  "row",
  "plot",
  "accession",
  "location",
  "crop",
  "rep",
] as const;
export type PlotFilterKey = (typeof PLOT_FILTER_FIELDS)[number];

/**
 * Check whether a feature's property matches a text filter value.
 * Handles COL/ROW aliases so filtering by "col" also matches "COLUMN", "bed", etc.
 */
export function matchesTextFilter(
  properties: Record<string, unknown>,
  key: PlotFilterKey,
  val: string
): boolean {
  if (!val.trim()) return true;
  const v = val.toLowerCase();
  const titleKey = key.charAt(0).toUpperCase() + key.slice(1);
  const candidates: unknown[] = [
    properties[key],
    properties[key.toUpperCase()],
    properties[titleKey],
    key === "plot" ? properties.plot_id ?? properties.plot : null,
  ];
  const lower = key.toLowerCase();
  const aliasSet = COL_KEY_SET.has(lower)
    ? COL_KEY_SET
    : ROW_KEY_SET.has(lower)
    ? ROW_KEY_SET
    : null;
  if (aliasSet) {
    for (const alias of aliasSet) {
      candidates.push(
        properties[alias],
        properties[alias.toUpperCase()],
        properties[alias.charAt(0).toUpperCase() + alias.slice(1)]
      );
    }
  }
  return candidates.some(
    (c) => c != null && String(c).toLowerCase().includes(v)
  );
}
