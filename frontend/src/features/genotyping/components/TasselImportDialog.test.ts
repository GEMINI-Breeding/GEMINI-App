import { describe, expect, it } from "vitest"

import { readTasselTraits } from "./TasselImportDialog"

const STATS =
  "Trait\tMarker\tChr\tPos\tdf\tF\tp\n" +
  "Ash\tNone\t\t\t0\tNaN\tNaN\n" +
  "Ash\tS01_15\t01\t15\t3\t0.6\t0.62\n" +
  "Fat\tS01_15\t01\t15\t1\t1\t0.5\n"

describe("TASSEL stats file", () => {
  it("lists the traits it holds, in file order", async () => {
    expect(await readTasselTraits(new Blob([STATS]))).toEqual(["Ash", "Fat"])
  })

  it("says so when the file is another TASSEL output", async () => {
    await expect(
      readTasselTraits(new Blob(["<Phenotype>\ntaxa\tdata\n"])),
    ).rejects.toThrow(/_2\.txt/)
  })
})
