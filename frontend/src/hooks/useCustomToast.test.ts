import { renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const successMock = vi.fn()
const errorMock = vi.fn()

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => successMock(...args),
    error: (...args: unknown[]) => errorMock(...args),
  },
}))

import useCustomToast from "./useCustomToast"

describe("useCustomToast", () => {
  beforeEach(() => {
    successMock.mockReset()
    errorMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("showSuccessToast forwards the description under the 'Success!' title", () => {
    const { result } = renderHook(() => useCustomToast())
    result.current.showSuccessToast("Saved.")
    expect(successMock).toHaveBeenCalledWith("Success!", { description: "Saved." })
  })

  it("showErrorToast forwards the description under the generic error title", () => {
    const { result } = renderHook(() => useCustomToast())
    result.current.showErrorToast("boom")
    expect(errorMock).toHaveBeenCalledWith("Something went wrong!", {
      description: "boom",
    })
  })

  it("showErrorToastWithCopy sets duration Infinity and a Copy action that writes to clipboard", () => {
    const writeText = vi.fn()
    vi.stubGlobal("navigator", { clipboard: { writeText } })

    const { result } = renderHook(() => useCustomToast())
    result.current.showErrorToastWithCopy("stack trace here")

    expect(errorMock).toHaveBeenCalledTimes(1)
    const [title, opts] = errorMock.mock.calls[0] as [
      string,
      {
        description: string
        duration: number
        action: { label: string; onClick: () => void }
      },
    ]
    expect(title).toBe("Something went wrong!")
    expect(opts.description).toBe("stack trace here")
    expect(opts.duration).toBe(Infinity)
    expect(opts.action.label).toBe("Copy")

    opts.action.onClick()
    expect(writeText).toHaveBeenCalledWith("stack trace here")
  })
})
