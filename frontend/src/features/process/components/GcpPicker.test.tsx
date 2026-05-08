import { describe, expect, it } from "vitest"

import {
  computeDotColors,
  cullDistantGcps,
  type GcpCatalogEntry,
  type GcpMark,
  imageBboxFromGpsMap,
  mergeCatalog,
  parseGcpImageGroups,
  parseGcpLocationsCsv,
  serializeGcpImageGroups,
  serializeGcpList,
  serializeGcpLocationsCsv,
  serializeGeoTxt,
  validateGcpEntry,
} from "./GcpPicker"

const catalog: GcpCatalogEntry[] = [
  { label: "GCP1", lon: -121.7501, lat: 38.5402, alt: 24.5 },
  { label: "GCP2", lon: -121.7515, lat: 38.541, alt: 25.1 },
]

describe("serializeGcpList", () => {
  it("produces a header-only file when there are no marks", () => {
    expect(serializeGcpList(catalog, [])).toBe("EPSG:4326\n")
  })

  it("serializes one row per mark using the matching catalog entry", () => {
    const marks: GcpMark[] = [
      { label: "GCP1", image: "DJI_0001.JPG", pixel_x: 1234.4, pixel_y: 567.7 },
      { label: "GCP2", image: "DJI_0002.JPG", pixel_x: 100.2, pixel_y: 200.8 },
    ]
    const lines = serializeGcpList(catalog, marks).trim().split("\n")
    expect(lines[0]).toBe("EPSG:4326")
    expect(lines[1]).toBe("-121.7501 38.5402 24.5 1234 568 DJI_0001.JPG GCP1")
    expect(lines[2]).toBe("-121.7515 38.541 25.1 100 201 DJI_0002.JPG GCP2")
  })

  it("drops marks that don't reference a known catalog entry", () => {
    const marks: GcpMark[] = [
      { label: "ghost", image: "x.JPG", pixel_x: 0, pixel_y: 0 },
      { label: "GCP1", image: "DJI_0001.JPG", pixel_x: 10, pixel_y: 20 },
    ]
    const lines = serializeGcpList(catalog, marks).trim().split("\n")
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain("DJI_0001.JPG")
    expect(lines[1]).not.toContain("ghost")
  })
})

describe("serializeGeoTxt", () => {
  it("emits header only when no images have GPS", () => {
    expect(
      serializeGeoTxt(["a.jpg", "b.jpg"], { "a.jpg": null, "b.jpg": null }),
    ).toBe("EPSG:4326\n")
  })

  it("emits one row per image with valid GPS, in input order", () => {
    const out = serializeGeoTxt(["a.jpg", "b.jpg", "c.jpg"], {
      "a.jpg": { lat: 38.54, lon: -121.75, alt: 24.5 },
      "b.jpg": null,
      "c.jpg": { lat: 38.55, lon: -121.76, alt: 25.0 },
    })
    const lines = out.trim().split("\n")
    expect(lines[0]).toBe("EPSG:4326")
    expect(lines[1]).toBe("a.jpg -121.75 38.54 24.5")
    expect(lines[2]).toBe("c.jpg -121.76 38.55 25")
  })
})

describe("parseGcpLocationsCsv", () => {
  it("parses a 4-column CSV with header (Label,Lat,Lon,Alt)", () => {
    const text =
      "Label,Lat_dec,Lon_dec,Altitude\n" +
      "1,33.4512,-111.9876,380.5\n" +
      "2,33.4498,-111.9845,381.0\n"
    expect(parseGcpLocationsCsv(text)).toEqual([
      { label: "1", lat: 33.4512, lon: -111.9876, alt: 380.5 },
      { label: "2", lat: 33.4498, lon: -111.9845, alt: 381 },
    ])
  })

  it("parses a 3-column CSV without altitude (alt defaults to 0)", () => {
    const text =
      "Label,Lat_dec,Lon_dec\n" +
      "1,38.53369654,-121.7824844\n" +
      "2,38.53368975,-121.7820818\n"
    expect(parseGcpLocationsCsv(text)).toEqual([
      { label: "1", lat: 38.53369654, lon: -121.7824844, alt: 0 },
      { label: "2", lat: 38.53368975, lon: -121.7820818, alt: 0 },
    ])
  })

  it("treats a header row as optional", () => {
    const text = "1,33.4512,-111.9876,380.5\n"
    expect(parseGcpLocationsCsv(text)).toEqual([
      { label: "1", lat: 33.4512, lon: -111.9876, alt: 380.5 },
    ])
  })

  it("ignores blank lines and comment rows", () => {
    const text =
      "# survey 2025-04-12\n" +
      "Label,Lat_dec,Lon_dec,Altitude\n" +
      "\n" +
      "1,33.4512,-111.9876,380.5\n"
    expect(parseGcpLocationsCsv(text)).toHaveLength(1)
  })

  it("throws on a row with fewer than 3 columns", () => {
    expect(() => parseGcpLocationsCsv("1,33.45")).toThrow()
  })

  it("throws when lat/lon don't parse as numbers", () => {
    // A header line skips the first row, so put the bad numerics on a real
    // data row.
    const text = "Label,Lat_dec,Lon_dec,Altitude\n1,abc,xyz,0\n"
    expect(() => parseGcpLocationsCsv(text)).toThrow()
  })

  it("throws with a column-order hint when lat is out of [-90, 90]", () => {
    // CSV authored as Label,Lon,Lat (the OpenDroneMap convention) instead
    // of the expected Label,Lat,Lon. We catch the swap loudly so the user
    // doesn't waste time hunting "no images near GCP" later.
    const text = "Label,Lat_dec,Lon_dec,Altitude\n1,-121.78,38.53,0\n"
    expect(() => parseGcpLocationsCsv(text)).toThrow(
      /latitude .* outside \[-90, 90\]/,
    )
  })

  it("throws when longitude is out of [-180, 180]", () => {
    const text = "Label,Lat_dec,Lon_dec,Altitude\n1,38.53,361,0\n"
    expect(() => parseGcpLocationsCsv(text)).toThrow(
      /longitude .* outside \[-180, 180\]/,
    )
  })
})

describe("serializeGcpList with coord-less entries", () => {
  it("drops marks whose catalog entry has no coordinates", () => {
    const mixed: GcpCatalogEntry[] = [
      { label: "FULL", lat: 38.5, lon: -121.7, alt: 10 },
      { label: "PARTIAL", images: ["a.jpg"] }, // no lat/lon
    ]
    const marks: GcpMark[] = [
      { label: "FULL", image: "a.JPG", pixel_x: 1, pixel_y: 2 },
      { label: "PARTIAL", image: "a.JPG", pixel_x: 3, pixel_y: 4 },
    ]
    const lines = serializeGcpList(mixed, marks).trim().split("\n")
    expect(lines).toHaveLength(2) // header + 1 row only
    expect(lines[1]).toContain("FULL")
    expect(lines[1]).not.toContain("PARTIAL")
  })

  it("treats null coordinates the same as undefined", () => {
    const mixed: GcpCatalogEntry[] = [
      { label: "NULLED", lat: null, lon: null, alt: null },
    ]
    const marks: GcpMark[] = [
      { label: "NULLED", image: "a.JPG", pixel_x: 1, pixel_y: 2 },
    ]
    expect(serializeGcpList(mixed, marks)).toBe("EPSG:4326\n")
  })
})

describe("serializeGcpLocationsCsv", () => {
  it("emits header only for an empty catalog", () => {
    expect(serializeGcpLocationsCsv([])).toBe(
      "Label,Lat_dec,Lon_dec,Altitude\n",
    )
  })

  it("round-trips with parseGcpLocationsCsv on coord-full rows", () => {
    const original: GcpCatalogEntry[] = [
      { label: "GCP1", lat: 38.5402, lon: -121.7501, alt: 24.5 },
      { label: "GCP2", lat: 38.541, lon: -121.7515, alt: 0 },
    ]
    expect(parseGcpLocationsCsv(serializeGcpLocationsCsv(original))).toEqual(
      original,
    )
  })

  it("filters out coord-less entries", () => {
    const mixed: GcpCatalogEntry[] = [
      { label: "GCP1", lat: 38.5, lon: -121.7, alt: 10 },
      { label: "DISC1", images: ["a.jpg"] },
      { label: "GCP2", lat: null, lon: -121.7, alt: 10 },
    ]
    const text = serializeGcpLocationsCsv(mixed)
    const lines = text.trim().split("\n")
    expect(lines).toHaveLength(2) // header + GCP1 only
    expect(lines[1]).toBe("GCP1,38.5,-121.7,10")
  })

  it("preserves alt=0 explicitly", () => {
    const text = serializeGcpLocationsCsv([
      { label: "GCP1", lat: 38.5, lon: -121.7, alt: 0 },
    ])
    expect(text).toContain(",0\n")
  })
})

describe("parseGcpImageGroups / serializeGcpImageGroups", () => {
  it("returns an empty map for empty input", () => {
    expect(parseGcpImageGroups("")).toEqual({})
    expect(parseGcpImageGroups("   \n   ")).toEqual({})
  })

  it("returns empty when groups is missing", () => {
    expect(parseGcpImageGroups(JSON.stringify({ version: 1 }))).toEqual({})
  })

  it("parses a v1 file into label → basenames", () => {
    const text = JSON.stringify({
      version: 1,
      groups: {
        DISC1: { images: ["b.JPG", "a.JPG"] },
        DISC2: { images: ["c.JPG"] },
      },
    })
    expect(parseGcpImageGroups(text)).toEqual({
      DISC1: ["b.JPG", "a.JPG"],
      DISC2: ["c.JPG"],
    })
  })

  it("ignores entries without an images array", () => {
    const text = JSON.stringify({
      version: 1,
      groups: { DISC1: { foo: "bar" }, DISC2: { images: ["a.JPG"] } },
    })
    expect(parseGcpImageGroups(text)).toEqual({ DISC2: ["a.JPG"] })
  })

  it("rejects malformed JSON with a useful message", () => {
    expect(() => parseGcpImageGroups("not json")).toThrow(/not valid JSON/)
  })

  it("rejects non-object root", () => {
    expect(() => parseGcpImageGroups("[]")).toThrow(/must be a JSON object/)
  })

  it("round-trips through serialize → parse", () => {
    const groups = {
      DISC2: ["b.JPG", "a.JPG"],
      DISC1: ["c.JPG"],
    }
    const round = parseGcpImageGroups(serializeGcpImageGroups(groups))
    // Serializer sorts inside each list for diff stability.
    expect(round).toEqual({
      DISC1: ["c.JPG"],
      DISC2: ["a.JPG", "b.JPG"],
    })
  })

  it("sorts labels in the serialized output for stable diffs", () => {
    const out = serializeGcpImageGroups({ Z: ["1"], A: ["2"] })
    const idxA = out.indexOf('"A"')
    const idxZ = out.indexOf('"Z"')
    expect(idxA).toBeGreaterThan(0)
    expect(idxZ).toBeGreaterThan(idxA)
  })

  it("preserves labels with empty image lists (coord-less GCPs)", () => {
    // Empty arrays are intentional — they represent coord-less GCPs
    // added via "+ Add new GCP" before any images are attached.
    const out = serializeGcpImageGroups({ EMPTY: [], FULL: ["a"] })
    expect(out).toContain("EMPTY")
    expect(out).toContain("FULL")
    // Round-trip preserves both.
    expect(parseGcpImageGroups(out)).toEqual({ EMPTY: [], FULL: ["a"] })
  })
})

describe("computeDotColors", () => {
  // Catalog colors (from gcpColor): index 0 = "#ef4444" (red),
  // 1 = "#3b82f6" (blue), 2 = "#22c55e" (green).
  const RED = "#ef4444"
  const BLUE = "#3b82f6"
  const GREEN = "#22c55e"

  it("returns an empty map when catalog is empty", () => {
    const out = computeDotColors({
      catalog: [],
      gpsMap: { "a.JPG": { lat: 38.5, lon: -121.7, alt: 0 } },
      modes: {},
      radii: {},
      groups: {},
      defaultRadius: 50,
    })
    expect(out).toEqual({})
  })

  it("colors a dot inside a single GCP's radius with that GCP's color", () => {
    const out = computeDotColors({
      catalog: [{ label: "G1", lat: 38.5, lon: -121.7, alt: 0 }],
      gpsMap: { "a.JPG": { lat: 38.5, lon: -121.7, alt: 0 } }, // ~0 m away
      modes: { G1: "radius" },
      radii: { G1: 50 },
      groups: {},
      defaultRadius: 50,
    })
    expect(out).toEqual({ "a.JPG": RED })
  })

  it("leaves a dot outside the radius unclaimed", () => {
    const out = computeDotColors({
      catalog: [{ label: "G1", lat: 38.5, lon: -121.7, alt: 0 }],
      // ~150 m east of GCP
      gpsMap: { "far.JPG": { lat: 38.5, lon: -121.6983, alt: 0 } },
      modes: { G1: "radius" },
      radii: { G1: 50 },
      groups: {},
      defaultRadius: 50,
    })
    expect(out).toEqual({})
  })

  it("breaks ties by closer haversine distance", () => {
    const out = computeDotColors({
      catalog: [
        { label: "G1", lat: 38.5, lon: -121.7, alt: 0 },
        { label: "G2", lat: 38.5001, lon: -121.7, alt: 0 }, // 11 m north of G1
      ],
      // Dot is roughly 5 m north of G1 → closer to G1 than G2.
      gpsMap: { "a.JPG": { lat: 38.50005, lon: -121.7, alt: 0 } },
      modes: { G1: "radius", G2: "radius" },
      radii: { G1: 100, G2: 100 }, // both reach the dot
      groups: {},
      defaultRadius: 100,
    })
    expect(out["a.JPG"]).toBe(RED) // G1 wins (closer)
  })

  it("explicit map-mode group claims members regardless of any radius", () => {
    const out = computeDotColors({
      catalog: [
        // G1 (red) has radius reaching every dot
        { label: "G1", lat: 38.5, lon: -121.7, alt: 0 },
        // G2 (blue) has explicit map-mode group containing 'b.JPG'
        { label: "G2", lat: 38.6, lon: -121.6, alt: 0 },
      ],
      gpsMap: {
        "a.JPG": { lat: 38.5, lon: -121.7, alt: 0 },
        "b.JPG": { lat: 38.5001, lon: -121.7, alt: 0 },
      },
      modes: { G1: "radius", G2: "map" },
      radii: { G1: 1000, G2: 1000 },
      groups: { G2: ["b.JPG"] },
      defaultRadius: 1000,
    })
    expect(out["a.JPG"]).toBe(RED) // G1 by radius
    expect(out["b.JPG"]).toBe(BLUE) // G2 by explicit group, even though G1 covers it
  })

  it("ignores coord-less GCPs in radius mode", () => {
    const out = computeDotColors({
      catalog: [
        { label: "G1" }, // coord-less — radius mode is impossible
        { label: "G2", lat: 38.5, lon: -121.7, alt: 0 },
      ],
      gpsMap: { "a.JPG": { lat: 38.5, lon: -121.7, alt: 0 } },
      modes: { G1: "radius", G2: "radius" },
      radii: { G2: 50 },
      groups: {},
      defaultRadius: 50,
    })
    expect(out).toEqual({ "a.JPG": BLUE }) // G2 only, G1 skipped
  })

  it("falls back to defaultRadius when a label has no entry in radii", () => {
    const out = computeDotColors({
      catalog: [{ label: "G1", lat: 38.5, lon: -121.7, alt: 0 }],
      // ~33 m away — inside default 50 m, outside if defaultRadius were 10.
      gpsMap: { "a.JPG": { lat: 38.5003, lon: -121.7, alt: 0 } },
      modes: { G1: "radius" },
      radii: {}, // empty — uses defaultRadius
      groups: {},
      defaultRadius: 50,
    })
    expect(out["a.JPG"]).toBe(RED)

    const tighter = computeDotColors({
      catalog: [{ label: "G1", lat: 38.5, lon: -121.7, alt: 0 }],
      gpsMap: { "a.JPG": { lat: 38.5003, lon: -121.7, alt: 0 } },
      modes: { G1: "radius" },
      radii: {},
      groups: {},
      defaultRadius: 10,
    })
    expect(tighter).toEqual({})
  })

  it("first-in-catalog wins when two map-mode groups list the same image", () => {
    const out = computeDotColors({
      catalog: [{ label: "G1" }, { label: "G2" }, { label: "G3" }],
      gpsMap: { "a.JPG": { lat: 38.5, lon: -121.7, alt: 0 } },
      modes: { G1: "map", G2: "map", G3: "map" },
      radii: {},
      groups: { G1: ["a.JPG"], G2: ["a.JPG"], G3: ["a.JPG"] },
      defaultRadius: 50,
    })
    expect(out["a.JPG"]).toBe(RED) // catalog index 0 wins
    // Sanity: confirm we'd see different colors had we put them later.
    void GREEN
  })
})

describe("mergeCatalog", () => {
  it("preserves CSV order for coord-bearing labels", () => {
    const csvRows: GcpCatalogEntry[] = [
      { label: "GCP1", lat: 38.5, lon: -121.7, alt: 0 },
      { label: "GCP2", lat: 38.6, lon: -121.8, alt: 0 },
    ]
    const merged = mergeCatalog(csvRows, {})
    expect(merged.map((g) => g.label)).toEqual(["GCP1", "GCP2"])
  })

  it("attaches images to a label that exists in CSV", () => {
    const csvRows: GcpCatalogEntry[] = [
      { label: "GCP1", lat: 38.5, lon: -121.7, alt: 0 },
    ]
    const merged = mergeCatalog(csvRows, { GCP1: ["a.JPG", "b.JPG"] })
    expect(merged).toHaveLength(1)
    expect(merged[0].images).toEqual(["a.JPG", "b.JPG"])
    expect(merged[0].lat).toBe(38.5)
  })

  it("introduces coord-less entries from groups-only labels", () => {
    const csvRows: GcpCatalogEntry[] = [
      { label: "GCP1", lat: 38.5, lon: -121.7, alt: 0 },
    ]
    const merged = mergeCatalog(csvRows, { DISC1: ["x.JPG"] })
    expect(merged).toHaveLength(2)
    const disc1 = merged.find((g) => g.label === "DISC1")!
    expect(disc1.lat ?? null).toBeNull()
    expect(disc1.lon ?? null).toBeNull()
    expect(disc1.images).toEqual(["x.JPG"])
  })

  it("orders groups-only labels alphabetically after CSV-order labels", () => {
    const csvRows: GcpCatalogEntry[] = [
      { label: "GCP_Z", lat: 0, lon: 0, alt: 0 },
    ]
    const merged = mergeCatalog(csvRows, {
      DISC_C: ["c"],
      DISC_A: ["a"],
      DISC_B: ["b"],
    })
    expect(merged.map((g) => g.label)).toEqual([
      "GCP_Z",
      "DISC_A",
      "DISC_B",
      "DISC_C",
    ])
  })
})

describe("validateGcpEntry", () => {
  it("rejects an empty label", () => {
    expect(() =>
      validateGcpEntry({ label: "  ", lat: 38, lon: -121, alt: 0 }, [], true),
    ).toThrow(/Label is required/)
  })

  it("rejects a duplicate label", () => {
    expect(() =>
      validateGcpEntry(
        { label: "GCP1", lat: 38, lon: -121, alt: 0 },
        ["GCP1"],
        true,
      ),
    ).toThrow(/already exists/)
  })

  it("requires lat/lon when coordsRequired is true", () => {
    expect(() => validateGcpEntry({ label: "GCP1" }, [], true)).toThrow(
      /required/,
    )
  })

  it("allows missing coords when coordsRequired is false", () => {
    expect(() => validateGcpEntry({ label: "DISC1" }, [], false)).not.toThrow()
  })

  it("rejects out-of-range lat/lon", () => {
    expect(() =>
      validateGcpEntry({ label: "G", lat: 91, lon: 0 }, [], true),
    ).toThrow(/Latitude/)
    expect(() =>
      validateGcpEntry({ label: "G", lat: 0, lon: 181 }, [], true),
    ).toThrow(/Longitude/)
  })

  it("rejects providing only one of lat/lon", () => {
    expect(() =>
      validateGcpEntry({ label: "G", lat: 38, lon: null }, [], false),
    ).toThrow(/both Lat and Lon/)
  })
})

describe("imageBboxFromGpsMap", () => {
  it("returns null when no images have GPS", () => {
    expect(
      imageBboxFromGpsMap({ "a.jpg": null, "b.jpg": null }),
    ).toBeNull()
    expect(imageBboxFromGpsMap({})).toBeNull()
  })

  it("computes the lat/lon extents across non-null entries", () => {
    expect(
      imageBboxFromGpsMap({
        "a.jpg": { lat: 38.50, lon: -121.78, alt: 0 },
        "b.jpg": { lat: 38.55, lon: -121.74, alt: 0 },
        "c.jpg": null,
        "d.jpg": { lat: 38.52, lon: -121.76, alt: 0 },
      }),
    ).toEqual({
      minLat: 38.5,
      maxLat: 38.55,
      minLon: -121.78,
      maxLon: -121.74,
    })
  })
})

describe("cullDistantGcps", () => {
  const gpsMap = {
    "a.jpg": { lat: 38.533, lon: -121.782, alt: 0 },
    "b.jpg": { lat: 38.534, lon: -121.781, alt: 0 },
  }

  it("keeps every GCP when no images have GPS", () => {
    const cat: GcpCatalogEntry[] = [
      { label: "G1", lat: 0, lon: 0, alt: 0 },
    ]
    expect(cullDistantGcps(cat, {})).toEqual({ kept: cat, culled: [] })
  })

  it("keeps GCPs inside the image bbox", () => {
    const cat: GcpCatalogEntry[] = [
      { label: "G1", lat: 38.5335, lon: -121.7815, alt: 0 },
    ]
    const out = cullDistantGcps(cat, gpsMap, 100)
    expect(out.kept).toHaveLength(1)
    expect(out.culled).toHaveLength(0)
  })

  it("keeps GCPs just past the bbox but inside the buffer", () => {
    // ~50 m east of the eastern bbox edge; well inside the 100 m buffer.
    const cat: GcpCatalogEntry[] = [
      { label: "G1", lat: 38.534, lon: -121.7805, alt: 0 },
    ]
    const out = cullDistantGcps(cat, gpsMap, 100)
    expect(out.kept).toHaveLength(1)
    expect(out.culled).toHaveLength(0)
  })

  it("culls GCPs significantly outside the bbox", () => {
    // (38.5, -121) is the previously-seen typo coordinate — ~68 km off.
    const cat: GcpCatalogEntry[] = [
      { label: "BAD", lat: 38.5, lon: -121, alt: 10 },
      { label: "OK", lat: 38.534, lon: -121.781, alt: 0 },
    ]
    const out = cullDistantGcps(cat, gpsMap, 100)
    expect(out.kept.map((g) => g.label)).toEqual(["OK"])
    expect(out.culled.map((g) => g.label)).toEqual(["BAD"])
  })

  it("keeps coord-less entries regardless of bbox (nothing to compare)", () => {
    const cat: GcpCatalogEntry[] = [
      { label: "PENDING", lat: null, lon: null, alt: 0 },
    ]
    const out = cullDistantGcps(cat, gpsMap, 100)
    expect(out.kept).toEqual(cat)
    expect(out.culled).toEqual([])
  })
})
