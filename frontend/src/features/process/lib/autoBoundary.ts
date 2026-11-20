/**
 * Auto-boundary: an outer field rectangle from the orthomosaic's extent.
 *
 * Ported from main's aerial `auto-boundary`: the ortho's bounds inset by
 * 2.5% on every side, which trims the ragged, partly-empty edge a drone
 * ortho always has. The user then generates the grid inside it (rows and
 * columns come from the field design when one is loaded) and adjusts.
 */
export type LeafletBounds = [[number, number], [number, number]] // [[S, W], [N, E]]

export function outerFromOrthoBounds(
  bounds: LeafletBounds,
  inset = 0.025,
): GeoJSON.Feature<GeoJSON.Polygon> {
  const [[south, west], [north, east]] = bounds
  const dx = (east - west) * inset
  const dy = (north - south) * inset
  const w = west + dx
  const e = east - dx
  const s = south + dy
  const n = north - dy
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [w, s],
          [e, s],
          [e, n],
          [w, n],
          [w, s],
        ],
      ],
    },
  }
}
