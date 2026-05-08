/**
 * Per-data-type field-fillness gate. Drives the Files-page dropzone
 * disabled state and the UploadList submit-time check.
 */
import { describe, expect, it } from "vitest"

import type { EntityChoice } from "@/features/files/components/EntitySelectField"
import {
  humanFieldLabel,
  isFieldFilled,
  missingFormFields,
  requiredFormFields,
} from "./uploadFieldRequirements"

describe("requiredFormFields", () => {
  it("returns empty for null/unknown data types", () => {
    expect(requiredFormFields(null)).toEqual([])
    expect(requiredFormFields(undefined)).toEqual([])
    expect(requiredFormFields("Not A Real Type")).toEqual([])
  })

  it("matches the dataTypes config for a multi-field type", () => {
    expect(requiredFormFields("Image Data")).toEqual([
      "experiment",
      "location",
      "population",
      "date",
      "platform",
      "sensor",
    ])
  })

  it("matches the dataTypes config for a single-field wizard type", () => {
    expect(requiredFormFields("Trait Data")).toEqual(["experiment"])
  })
})

describe("isFieldFilled", () => {
  const existing: EntityChoice = {
    kind: "existing",
    id: "id-1",
    name: "Demo",
  }
  const newWithName: EntityChoice = { kind: "new", name: "Fresh" }
  const newBlank: EntityChoice = { kind: "new", name: "   " }
  const none: EntityChoice = { kind: "none" }

  it("treats a non-empty plain value as filled", () => {
    expect(isFieldFilled("date", { date: "2024-06-01" }, {})).toBe(true)
  })

  it("treats whitespace-only plain values as empty", () => {
    expect(isFieldFilled("date", { date: "  " }, {})).toBe(false)
  })

  it("treats existing entity choices as filled", () => {
    expect(isFieldFilled("experiment", {}, { experiment: existing })).toBe(true)
  })

  it("treats new-with-name entity choices as filled", () => {
    expect(isFieldFilled("experiment", {}, { experiment: newWithName })).toBe(
      true,
    )
  })

  it("rejects new-blank and none choices", () => {
    expect(isFieldFilled("experiment", {}, { experiment: newBlank })).toBe(
      false,
    )
    expect(isFieldFilled("experiment", {}, { experiment: none })).toBe(false)
    expect(isFieldFilled("experiment", {}, undefined)).toBe(false)
  })
})

describe("missingFormFields", () => {
  it("returns every field for a fresh form", () => {
    expect(missingFormFields("Image Data", {}, {})).toEqual([
      "experiment",
      "location",
      "population",
      "date",
      "platform",
      "sensor",
    ])
  })

  it("only flags experiment when site/population are still empty (the bug)", () => {
    const scope: Record<string, EntityChoice> = {
      experiment: { kind: "existing", id: "exp-1", name: "Demo" },
    }
    const missing = missingFormFields("Image Data", {}, scope)
    expect(missing).not.toContain("experiment")
    expect(missing).toEqual([
      "location",
      "population",
      "date",
      "platform",
      "sensor",
    ])
  })

  it("returns empty when every field is filled", () => {
    const scope: Record<string, EntityChoice> = {
      experiment: { kind: "existing", id: "exp-1", name: "Demo" },
      location: { kind: "new", name: "Davis" },
      population: { kind: "existing", id: "pop-1", name: "P1" },
      platform: { kind: "existing", id: "plat-1", name: "Plat" },
      sensor: { kind: "existing", id: "sen-1", name: "Sen" },
    }
    const formValues = { date: "2024-06-01" }
    expect(missingFormFields("Image Data", formValues, scope)).toEqual([])
  })
})

describe("humanFieldLabel", () => {
  it("maps known field keys to friendly labels", () => {
    expect(humanFieldLabel("location")).toBe("site")
    expect(humanFieldLabel("platform")).toBe("sensor platform")
  })

  it("falls back to the raw key for unknown fields", () => {
    expect(humanFieldLabel("unknown")).toBe("unknown")
  })
})
