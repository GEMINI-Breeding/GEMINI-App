/**
 * The traits one extraction measured, summarised from its traits GeoJSON
 * (one feature per plot): how many plots, the mean and the range of each.
 */

/** The traits EXTRACT_TRAITS writes, in the order to show them. */
export const EXTRACTED_TRAITS: { key: string; label: string; unit: string }[] =
  [
    { key: "Vegetation_Fraction", label: "Vegetation fraction", unit: "" },
    { key: "Height_95p_meters", label: "Canopy height (95th pct)", unit: "m" },
    { key: "Temp_veg_avg_C", label: "Canopy temperature", unit: "°C" },
  ]

export interface TraitSummary {
  key: string
  label: string
  unit: string
  plots: number
  mean: number
  min: number
  max: number
}

/**
 * `used`: the traits the run measured (the job's result lists them: canopy
 * height only with a DEM, canopy temperature only with a thermal map). A
 * trait it did not measure gets no card even if the file has a column for it.
 */
export function summariseTraits(
  geojson: unknown,
  used?: readonly string[],
): TraitSummary[] {
  const features =
    (geojson as { features?: { properties?: Record<string, unknown> }[] })
      ?.features ?? []
  const out: TraitSummary[] = []
  for (const t of EXTRACTED_TRAITS) {
    if (used && !used.includes(t.key)) continue
    const vs = features
      .map((f) => f.properties?.[t.key])
      // A plot without a reading (null) is not a zero.
      .filter((v) => v !== null && v !== undefined && v !== "")
      .map(Number)
      .filter((v) => Number.isFinite(v))
    if (!vs.length) continue
    out.push({
      ...t,
      plots: vs.length,
      mean: vs.reduce((a, b) => a + b, 0) / vs.length,
      min: Math.min(...vs),
      max: Math.max(...vs),
    })
  }
  return out
}
