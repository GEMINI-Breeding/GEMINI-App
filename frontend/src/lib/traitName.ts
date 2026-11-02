/**
 * Readable names for traits whose stored name is a code. The stored name
 * stays as it is (records, CSV files and the API keep using it); only what
 * people read changes. The unit is shown beside the name, so it is left out.
 */
const LABELS: Record<string, string> = {
  Temp_veg_avg_C: "Canopy temperature",
  Height_95p_meters: "Canopy height (95th pct)",
}

export function traitLabel(name: string | null | undefined): string {
  if (!name) return ""
  return LABELS[name] ?? name
}
