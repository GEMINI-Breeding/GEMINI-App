import { describe, expect, it } from "vitest"

import { humanizeImportError } from "./importErrorHints"

describe("humanizeImportError", () => {
  it("recognizes the accession-mismatch trigger error and explains it", () => {
    const raw =
      "Accession mismatch on trait_records: plot 9a8c2983-da21-4e4f-98e2-7723c56093ce is associated with accession 41 but record supplied accession 220"
    const hint = humanizeImportError(raw)
    expect(hint).not.toBeNull()
    // Names the two conflicting germplasm values so the user can spot them.
    expect(hint?.summary).toContain('"41"')
    expect(hint?.summary).toContain('"220"')
    // Points at the real fix: Season/Site from column, not fixed.
    expect(hint?.action).toMatch(/from column/i)
    expect(hint?.action).toMatch(/season and site/i)
    // Preserves the raw message for support.
    expect(hint?.detail).toBe(raw)
  })

  it("handles accession names with spaces and punctuation", () => {
    const raw =
      "Accession mismatch on trait_records: plot abc is associated with accession NE-80-21-41 but record supplied accession USDA Cody"
    const hint = humanizeImportError(raw)
    expect(hint).not.toBeNull()
    expect(hint?.summary).toContain('"NE-80-21-41"')
    expect(hint?.summary).toContain('"USDA Cody"')
  })

  it("still matches when a rollback note is appended to the message", () => {
    const raw =
      "Accession mismatch on trait_records: plot abc is associated with accession 163 but record supplied accession Check2\n\nThe 12 plots created during this attempt were rolled back, so you can fix the mapping and retry cleanly."
    const hint = humanizeImportError(raw)
    expect(hint).not.toBeNull()
    expect(hint?.summary).toContain('"163"')
    expect(hint?.summary).toContain('"Check2"')
  })

  it("returns null for unrelated errors so the raw message is shown", () => {
    expect(humanizeImportError("No accession found with name foo")).toBeNull()
    expect(humanizeImportError("Invalid trait combination")).toBeNull()
    expect(humanizeImportError("")).toBeNull()
  })
})
