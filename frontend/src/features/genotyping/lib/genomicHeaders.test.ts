import { describe, expect, it } from "vitest"

import {
  GenomicHeaderError,
  readHapmapSampleHeaders,
  readMatrixSampleHeaders,
  readVcfSampleHeaders,
} from "./genomicHeaders"

function fileFromText(name: string, text: string): File {
  return new File([text], name, { type: "text/plain" })
}

describe("readMatrixSampleHeaders", () => {
  it("returns CSV sample columns minus known metadata", () => {
    const csv = [
      "variant_name,chromosome,position,LINE_A,LINE_B,LINE_C",
      "SNP_001,1,100,A/A,A/G,G/G",
    ].join("\n")
    return readMatrixSampleHeaders(fileFromText("m.csv", csv)).then((cols) => {
      expect(cols).toEqual(["LINE_A", "LINE_B", "LINE_C"])
    })
  })

  it("auto-detects TSV delimiter", () => {
    const tsv = "variant_name\tchromosome\tposition\tA\tB"
    return readMatrixSampleHeaders(fileFromText("m.tsv", tsv)).then((cols) => {
      expect(cols).toEqual(["A", "B"])
    })
  })

  it("throws on empty header", async () => {
    await expect(
      readMatrixSampleHeaders(fileFromText("m.csv", "")),
    ).rejects.toThrow(GenomicHeaderError)
  })
})

describe("readHapmapSampleHeaders", () => {
  it("returns columns 12+ after the rs# header", async () => {
    const hmp = [
      "rs#\talleles\tchrom\tpos\tstrand\tassembly#\tcenter\tprotLSID\tassayLSID\tpanel\tQCcode\tLINE_A\tLINE_B",
      "SNP_1\tA/G\t1\t100\t+\tNA\tNA\tNA\tNA\tNA\tNA\tA/A\tA/G",
    ].join("\n")
    expect(await readHapmapSampleHeaders(fileFromText("g.hmp", hmp))).toEqual([
      "LINE_A",
      "LINE_B",
    ])
  })

  it("throws when the header has fewer than 12 columns", async () => {
    const hmp = "rs#\talleles\tchrom\tpos"
    await expect(
      readHapmapSampleHeaders(fileFromText("g.hmp", hmp)),
    ).rejects.toThrow(/HapMap header/)
  })
})

describe("readVcfSampleHeaders", () => {
  it("skips ## meta lines and returns columns 10+", async () => {
    const vcf = [
      "##fileformat=VCFv4.2",
      "##source=test",
      "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tLINE_A\tLINE_B",
      "1\t100\tSNP_1\tA\tG\t.\t.\t.\tGT\t0/0\t0/1",
    ].join("\n")
    expect(await readVcfSampleHeaders(fileFromText("g.vcf", vcf))).toEqual([
      "LINE_A",
      "LINE_B",
    ])
  })

  it("throws when no #CHROM line is present in the prefix", async () => {
    const vcf = "##fileformat=VCFv4.2\n"
    await expect(
      readVcfSampleHeaders(fileFromText("g.vcf", vcf)),
    ).rejects.toThrow(/No header line/)
  })
})
