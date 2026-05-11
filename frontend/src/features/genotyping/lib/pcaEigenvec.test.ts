import { describe, expect, it } from "vitest"

import { parsePcaEigenvec } from "./pcaEigenvec"

describe("parsePcaEigenvec", () => {
  it("parses a well-formed PLINK2 pca.eigenvec", () => {
    const text = [
      "#FID\tIID\tPC1\tPC2\tPC3",
      "0\tLINE_A\t0.10\t-0.03\t0.07",
      "0\tLINE_B\t0.02\t-0.04\t-0.11",
      "0\tLINE_C\t0.02\t0.04\t-0.13",
    ].join("\n")
    const { points, nPcs } = parsePcaEigenvec(text)
    expect(nPcs).toBe(3)
    expect(points).toHaveLength(3)
    expect(points[0]).toEqual({
      sample: "LINE_A",
      pcs: [0.1, -0.03, 0.07],
    })
    expect(points[2].sample).toBe("LINE_C")
  })

  it("tolerates mixed-whitespace separators", () => {
    const text = "#FID IID PC1 PC2\n0 LINE_A 0.5  -0.1\n0  LINE_B   0.2 0.3"
    const { points, nPcs } = parsePcaEigenvec(text)
    expect(nPcs).toBe(2)
    expect(points.map((p) => p.sample)).toEqual(["LINE_A", "LINE_B"])
    expect(points[1].pcs).toEqual([0.2, 0.3])
  })

  it("returns an empty table when the file is empty or malformed", () => {
    expect(parsePcaEigenvec("").points).toEqual([])
    expect(parsePcaEigenvec("\n\n").points).toEqual([])
    // No IID column → can't locate samples.
    expect(parsePcaEigenvec("FID\tFOO\tBAR\n0\t1\t2").points).toEqual([])
  })

  it("skips rows that are too short", () => {
    const text = ["#FID\tIID\tPC1\tPC2", "0\tLINE_A\t0.1", "0\tLINE_B\t0.2\t0.3"].join(
      "\n",
    )
    const { points } = parsePcaEigenvec(text)
    expect(points).toHaveLength(1)
    expect(points[0].sample).toBe("LINE_B")
  })

  it("coerces non-numeric PC cells to 0", () => {
    const text = "#FID\tIID\tPC1\tPC2\n0\tLINE_A\tNA\t-0.5"
    const { points } = parsePcaEigenvec(text)
    expect(points[0].pcs).toEqual([0, -0.5])
  })
})
