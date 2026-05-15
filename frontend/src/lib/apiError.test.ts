import { describe, expect, it } from "vitest"

import { extractApiErrorMessage } from "./apiError"

describe("extractApiErrorMessage", () => {
  it("prefers body.error_description from a structured 422", () => {
    const err = Object.assign(new Error("Unprocessable Content"), {
      body: {
        error: "database_validation_failed",
        error_description: "No accession found with name CV-001",
      },
    })
    expect(extractApiErrorMessage(err)).toBe(
      "No accession found with name CV-001",
    )
  })

  it("falls back to body.detail when error_description is absent", () => {
    const err = Object.assign(new Error("Bad Request"), {
      body: { detail: "season_name is required" },
    })
    expect(extractApiErrorMessage(err)).toBe("season_name is required")
  })

  it("falls back to body.error when description/detail are absent", () => {
    const err = Object.assign(new Error("Conflict"), {
      body: { error: "duplicate_key" },
    })
    expect(extractApiErrorMessage(err)).toBe("duplicate_key")
  })

  it("uses err.message when body has no useful strings", () => {
    const err = Object.assign(new Error("Network down"), { body: {} })
    expect(extractApiErrorMessage(err)).toBe("Network down")
  })

  it("handles a plain Error with no body", () => {
    expect(extractApiErrorMessage(new Error("boom"))).toBe("boom")
  })

  it("stringifies a non-Error value", () => {
    expect(extractApiErrorMessage("oops")).toBe("oops")
  })

  it("ignores empty/whitespace strings in the body", () => {
    const err = Object.assign(new Error("fallback message"), {
      body: { error_description: "   ", error: "" },
    })
    expect(extractApiErrorMessage(err)).toBe("fallback message")
  })

  it("accepts a plain string body", () => {
    const err = Object.assign(new Error("Bad Gateway"), {
      body: "upstream timeout",
    })
    expect(extractApiErrorMessage(err)).toBe("upstream timeout")
  })
})
