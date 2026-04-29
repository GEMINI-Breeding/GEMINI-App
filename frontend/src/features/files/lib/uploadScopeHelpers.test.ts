/**
 * resolveOrCreateEntity factory — covers the four code paths once so the
 * thin wrappers in useUploadScope.ts don't each need their own copy.
 */
import { describe, expect, it, vi } from "vitest"

import { resolveOrCreateEntity, type EntityResolver } from "./uploadScopeHelpers"

interface Row {
  id: string | number | null
  name: string
}

function makeResolver(overrides: Partial<EntityResolver<Row>> = {}): EntityResolver<Row> {
  return {
    entityLabel: "site",
    search: vi.fn().mockResolvedValue([]),
    getName: (r) => r.name,
    getId: (r) => r.id,
    create: vi.fn().mockResolvedValue({ id: "new-id", name: "" }),
    onResolved: vi.fn(),
    ...overrides,
  }
}

describe("resolveOrCreateEntity", () => {
  it("passes existing choices through without hitting the SDK", async () => {
    const r = makeResolver()
    const out = await resolveOrCreateEntity(
      { kind: "existing", id: "abc", name: "Davis" },
      r,
    )
    expect(out).toEqual({ id: "abc", name: "Davis" })
    expect(r.search).not.toHaveBeenCalled()
    expect(r.create).not.toHaveBeenCalled()
    expect(r.onResolved).not.toHaveBeenCalled()
  })

  it("reuses a search-hit by name without creating", async () => {
    const r = makeResolver({
      search: vi.fn().mockResolvedValue([{ id: 7, name: "Davis" }]),
    })
    const out = await resolveOrCreateEntity({ kind: "new", name: "Davis" }, r)
    expect(out).toEqual({ id: "7", name: "Davis" })
    expect(r.search).toHaveBeenCalledWith("Davis")
    expect(r.create).not.toHaveBeenCalled()
    expect(r.onResolved).toHaveBeenCalledOnce()
  })

  it("ignores partial-name search hits that aren't an exact match", async () => {
    const r = makeResolver({
      // The backend's name search may match prefixes; the factory must
      // require an exact name equality before reusing a row.
      search: vi.fn().mockResolvedValue([{ id: 7, name: "Davis Annex" }]),
      create: vi.fn().mockResolvedValue({ id: "fresh-id", name: "Davis" }),
    })
    const out = await resolveOrCreateEntity({ kind: "new", name: "Davis" }, r)
    expect(r.create).toHaveBeenCalledWith("Davis")
    expect(out).toEqual({ id: "fresh-id", name: "Davis" })
  })

  it("trims whitespace and creates on search miss", async () => {
    const r = makeResolver({
      search: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 99, name: "TomatoMAGIC" }),
    })
    const out = await resolveOrCreateEntity(
      { kind: "new", name: "  TomatoMAGIC  " },
      r,
    )
    expect(r.search).toHaveBeenCalledWith("TomatoMAGIC")
    expect(r.create).toHaveBeenCalledWith("TomatoMAGIC")
    expect(out).toEqual({ id: "99", name: "TomatoMAGIC" })
    expect(r.onResolved).toHaveBeenCalledOnce()
  })

  it("rejects a new choice with an empty / whitespace name", async () => {
    const r = makeResolver()
    await expect(
      resolveOrCreateEntity({ kind: "new", name: "   " }, r),
    ).rejects.toThrow(/site name is empty/i)
    expect(r.search).not.toHaveBeenCalled()
    expect(r.create).not.toHaveBeenCalled()
  })

  it("rejects 'none' with a label-aware error", async () => {
    const r = makeResolver({ entityLabel: "experiment" })
    await expect(
      resolveOrCreateEntity({ kind: "none" }, r),
    ).rejects.toThrow(/experiment is required/i)
    expect(r.search).not.toHaveBeenCalled()
    expect(r.create).not.toHaveBeenCalled()
  })

  it("propagates a creation failure to the caller", async () => {
    const r = makeResolver({
      search: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockRejectedValue(new Error("network down")),
    })
    await expect(
      resolveOrCreateEntity({ kind: "new", name: "X" }, r),
    ).rejects.toThrow("network down")
    expect(r.onResolved).not.toHaveBeenCalled()
  })

  it("treats a created row with a null id as id=''", async () => {
    const r = makeResolver({
      search: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: null, name: "X" }),
    })
    const out = await resolveOrCreateEntity({ kind: "new", name: "X" }, r)
    expect(out).toEqual({ id: "", name: "X" })
  })
})
