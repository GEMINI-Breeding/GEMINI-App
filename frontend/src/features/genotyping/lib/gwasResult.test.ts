import { describe, expect, it } from "vitest"

import {
  displayStage,
  parseGwasResult,
  parseProgressDetail,
  s3UrlToDownload,
  statusVariant,
} from "./gwasResult"

describe("s3UrlToDownload", () => {
  it("converts a well-formed s3:// URL into the /api/files/download path", () => {
    expect(
      s3UrlToDownload("s3://gemini/gwas/abc-123/manhattan.png"),
    ).toBe("/api/files/download/gemini/gwas/abc-123/manhattan.png")
  })

  it("preserves nested keys with multiple slashes", () => {
    expect(
      s3UrlToDownload("s3://gemini/gwas/job/sub/path/file.txt"),
    ).toBe("/api/files/download/gemini/gwas/job/sub/path/file.txt")
  })

  it("returns null when not an s3:// URL", () => {
    expect(s3UrlToDownload("https://example.com/a.png")).toBeNull()
    expect(s3UrlToDownload(undefined)).toBeNull()
    expect(s3UrlToDownload(null)).toBeNull()
    expect(s3UrlToDownload(42)).toBeNull()
  })
})

describe("statusVariant", () => {
  it("maps status strings to badge variants", () => {
    expect(statusVariant("COMPLETED")).toBe("default")
    expect(statusVariant("completed")).toBe("default")
    expect(statusVariant("FAILED")).toBe("destructive")
    expect(statusVariant("CANCELLED")).toBe("destructive")
    expect(statusVariant("RUNNING")).toBe("secondary")
    expect(statusVariant("PENDING")).toBe("outline")
    expect(statusVariant(null)).toBe("outline")
  })
})

describe("displayStage", () => {
  it("overrides the last-seen stage on terminal statuses", () => {
    // The worker's last checkpoint before COMPLETED is "upload"; we
    // don't want that text leaking next to a finished badge.
    expect(displayStage("COMPLETED", "upload")).toBe("Finished")
    expect(displayStage("completed", "plot")).toBe("Finished")
    expect(displayStage("FAILED", "qc")).toBe("Failed")
    expect(displayStage("CANCELLED", "pca")).toBe("Cancelled")
  })

  it("passes through the in-flight stage while the job is live", () => {
    expect(displayStage("RUNNING", "kinship")).toBe("kinship")
    expect(displayStage("PENDING", "")).toBe("—")
    expect(displayStage("RUNNING", null)).toBe("—")
  })

  it("falls back to an em-dash when given no stage and no terminal hint", () => {
    expect(displayStage(undefined, undefined)).toBe("—")
    expect(displayStage("", "")).toBe("—")
  })
})

describe("parseGwasResult", () => {
  it("returns null when job is null/undefined", () => {
    expect(parseGwasResult(null)).toBeNull()
    expect(parseGwasResult(undefined)).toBeNull()
  })

  it("returns null when result is missing or not an object", () => {
    expect(
      parseGwasResult({ job_type: "RUN_GWAS", result: null }),
    ).toBeNull()
    // The OpenAPI type says result is `Record<string, unknown> | null`, but
    // at runtime a backend that wrote a string would still flow through.
    expect(
      parseGwasResult({
        job_type: "RUN_GWAS",
        result: "string" as unknown as Record<string, unknown>,
      }),
    ).toBeNull()
  })

  it("casts a present result blob to the typed shape", () => {
    const result = parseGwasResult({
      job_type: "RUN_GWAS",
      result: {
        study_name: "Maize 2024",
        model: "lmm",
        genomic_inflation_lambda: 1.02,
        top_hits: [{ rs: "rs1", p: 1e-9 }],
      },
    })
    expect(result?.study_name).toBe("Maize 2024")
    expect(result?.top_hits?.[0].rs).toBe("rs1")
  })
})

describe("parseProgressDetail", () => {
  it("returns null when missing or not an object", () => {
    expect(parseProgressDetail(null)).toBeNull()
    expect(
      parseProgressDetail({ job_type: "RUN_GWAS", progress_detail: null }),
    ).toBeNull()
    expect(
      parseProgressDetail({
        job_type: "RUN_GWAS",
        progress_detail: "stage 1" as unknown as Record<string, unknown>,
      }),
    ).toBeNull()
  })

  it("returns the object when present", () => {
    expect(
      parseProgressDetail({
        job_type: "RUN_GWAS",
        progress_detail: { stage: "qc", pct: 0.4 },
      }),
    ).toEqual({ stage: "qc", pct: 0.4 })
  })
})
