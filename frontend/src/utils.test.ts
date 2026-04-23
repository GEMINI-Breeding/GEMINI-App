import { AxiosError } from "axios"
import { describe, expect, it, vi } from "vitest"
import { getInitials, handleError } from "./utils"
import type { ApiError } from "./client"

describe("getInitials", () => {
  it("returns the uppercase first letters of the first two words", () => {
    expect(getInitials("jane doe")).toBe("JD")
    expect(getInitials("Ada Lovelace")).toBe("AL")
  })

  it("only considers the first two words, ignoring the rest", () => {
    expect(getInitials("alan mathison turing")).toBe("AM")
  })

  it("returns a single letter when only one word is provided", () => {
    expect(getInitials("cher")).toBe("C")
  })

  it("returns an empty string for an empty input", () => {
    expect(getInitials("")).toBe("")
  })
})

describe("handleError", () => {
  it("surfaces the first FastAPI validation msg when body.detail is an array", () => {
    const cb = vi.fn()
    const err = {
      body: {
        detail: [{ msg: "field required", type: "missing", loc: ["q"] }],
      },
    } as unknown as ApiError

    handleError.call(cb, err)
    expect(cb).toHaveBeenCalledWith("field required")
  })

  it("surfaces body.detail when it is a plain string", () => {
    const cb = vi.fn()
    const err = { body: { detail: "not found" } } as unknown as ApiError
    handleError.call(cb, err)
    expect(cb).toHaveBeenCalledWith("not found")
  })

  it("falls back to a generic message when there is no detail", () => {
    const cb = vi.fn()
    const err = { body: {} } as unknown as ApiError
    handleError.call(cb, err)
    expect(cb).toHaveBeenCalledWith("Something went wrong.")
  })

  it("uses the AxiosError message when the error is an AxiosError instance", () => {
    const cb = vi.fn()
    const axiosErr = new AxiosError("timeout of 5000ms exceeded")
    handleError.call(cb, axiosErr as unknown as ApiError)
    expect(cb).toHaveBeenCalledWith("timeout of 5000ms exceeded")
  })
})
