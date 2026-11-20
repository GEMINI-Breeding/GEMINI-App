import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { GermplasmService, type ResolveResultOutput } from "@/client"
import { isResolved, resolveGermplasmNames } from "./germplasmResolve"

describe("isResolved", () => {
  it("rejects unresolved match_kind regardless of canonical_name", () => {
    expect(
      isResolved({
        input_name: "X",
        match_kind: "unresolved",
        canonical_name: "X",
      }),
    ).toBe(false)
  })

  it("rejects missing canonical_name", () => {
    expect(isResolved({ input_name: "X", match_kind: "exact" })).toBe(false)
  })

  it("accepts a name with non-unresolved match_kind", () => {
    expect(
      isResolved({
        input_name: "X",
        match_kind: "exact",
        canonical_name: "Canonical",
      }),
    ).toBe(true)
  })
})

describe("resolveGermplasmNames", () => {
  // biome-ignore lint/suspicious/noExplicitAny: vitest spy generic clashes with SDK request typing
  let resolveSpy: any

  beforeEach(() => {
    resolveSpy = vi
      .spyOn(GermplasmService, "apiGermplasmResolveResolve")
      .mockImplementation(({ requestBody }) => {
        const results: ResolveResultOutput[] = (requestBody.names ?? []).map(
          (n) => ({
            input_name: n,
            match_kind: "exact",
            canonical_name: n,
          }),
        )
        // Cancellable shape — but the only field our code reads is .results.
        return Promise.resolve({ results }) as never
      })
  })

  afterEach(() => {
    resolveSpy.mockRestore()
  })

  it("short-circuits for an empty list", async () => {
    const out = await resolveGermplasmNames([])
    expect(out).toEqual([])
    expect(resolveSpy).not.toHaveBeenCalled()
  })

  it("issues a single request when names fit in one chunk", async () => {
    const out = await resolveGermplasmNames(["a", "b", "c"], { chunkSize: 200 })
    expect(out.map((r) => r.input_name)).toEqual(["a", "b", "c"])
    expect(resolveSpy).toHaveBeenCalledTimes(1)
  })

  it("chunks at the configured size and preserves input order", async () => {
    const names = Array.from({ length: 5 }, (_, i) => `n${i}`)
    const out = await resolveGermplasmNames(names, { chunkSize: 2 })
    expect(out.map((r) => r.input_name)).toEqual(names)
    expect(resolveSpy).toHaveBeenCalledTimes(3)
  })

  it("forwards experimentId to the request body", async () => {
    await resolveGermplasmNames(["a"], { experimentId: "exp-1" })
    expect(resolveSpy).toHaveBeenCalledWith({
      requestBody: { names: ["a"], experiment_id: "exp-1" },
    })
  })
})
