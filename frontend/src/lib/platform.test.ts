import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { downloadFile, isTauri, openUrl, pickFiles } from "./platform"

describe("pickFiles — browser branch", () => {
  beforeEach(() => {
    ;(window as unknown as { __E2E_PICK_FILES__?: string[] }).__E2E_PICK_FILES__ =
      undefined
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns the E2E-injected paths and clears the hook afterwards", async () => {
    ;(window as unknown as { __E2E_PICK_FILES__?: string[] }).__E2E_PICK_FILES__ = [
      "/tmp/a.jpg",
      "/tmp/b.jpg",
    ]
    const out = await pickFiles({ multiple: true })
    expect(out).toEqual(["/tmp/a.jpg", "/tmp/b.jpg"])
    // Hook is consumed so a second call goes through the normal path.
    expect(
      (window as unknown as { __E2E_PICK_FILES__?: string[] }).__E2E_PICK_FILES__,
    ).toBeUndefined()
  })

  it("ignores an empty injected array and falls through to the browser picker", async () => {
    ;(window as unknown as { __E2E_PICK_FILES__?: string[] }).__E2E_PICK_FILES__ = []
    // Intercept the dynamically-created <input> so we can resolve synchronously.
    const origCreate = document.createElement.bind(document)
    let createdInput: HTMLInputElement | null = null
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = origCreate(tag) as HTMLElement
      if (tag === "input") {
        createdInput = el as HTMLInputElement
        // Simulate cancellation so pickFiles resolves with null.
        queueMicrotask(() => {
          const e = new Event("cancel")
          createdInput?.oncancel?.(e)
        })
      }
      return el
    })

    const out = await pickFiles({ multiple: false })
    expect(out).toBeNull()
    expect(createdInput).not.toBeNull()
  })

  it("resolves with null when the hidden input is cancelled with no files", async () => {
    const origCreate = document.createElement.bind(document)
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = origCreate(tag) as HTMLElement
      if (tag === "input") {
        queueMicrotask(() => {
          ;(el as HTMLInputElement).oncancel?.(new Event("cancel"))
        })
      }
      return el
    })
    const out = await pickFiles()
    expect(out).toBeNull()
  })

  it("resolves with the selected File[] when the input's onchange fires", async () => {
    const file = new File(["hello"], "hello.txt", { type: "text/plain" })
    const origCreate = document.createElement.bind(document)
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = origCreate(tag) as HTMLElement
      if (tag === "input") {
        const input = el as HTMLInputElement
        queueMicrotask(() => {
          Object.defineProperty(input, "files", {
            configurable: true,
            value: [file] as unknown as FileList,
          })
          input.onchange?.(new Event("change"))
        })
      }
      return el
    })

    const out = await pickFiles({ multiple: false })
    expect(Array.isArray(out)).toBe(true)
    expect((out as File[])[0].name).toBe("hello.txt")
  })
})

describe("isTauri", () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  })

  it("returns false in a plain jsdom browser", () => {
    expect(isTauri()).toBe(false)
  })

  it("returns true when window.__TAURI_INTERNALS__ is present", () => {
    ;(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {}
    expect(isTauri()).toBe(true)
  })
})

describe("downloadFile — browser branch", () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:fake"),
      revokeObjectURL: vi.fn(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("fetches, clicks an anchor, and returns true on success", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(new Blob(["x"], { type: "text/plain" })),
    } as unknown as Response)

    const clicks: HTMLAnchorElement[] = []
    const origCreate = document.createElement.bind(document)
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = origCreate(tag)
      if (tag === "a") {
        vi.spyOn(el as HTMLAnchorElement, "click").mockImplementation(() => {
          clicks.push(el as HTMLAnchorElement)
        })
      }
      return el
    })

    const result = await downloadFile("/api/file", "out.txt")
    expect(result).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith("/api/file", { method: "GET" })
    expect(clicks).toHaveLength(1)
    expect(clicks[0].download).toBe("out.txt")
    expect(clicks[0].href).toContain("blob:fake")
  })

  it("throws when the response is not ok", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      blob: () => Promise.resolve(new Blob()),
    } as unknown as Response)

    await expect(downloadFile("/api/missing", "x.bin")).rejects.toThrow(
      "Download failed: 404",
    )
  })

  it("forwards an explicit POST method to fetch", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(new Blob()),
    } as unknown as Response)

    const origCreate = document.createElement.bind(document)
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = origCreate(tag)
      if (tag === "a") {
        vi.spyOn(el as HTMLAnchorElement, "click").mockImplementation(() => {})
      }
      return el
    })

    await downloadFile("/api/file", "out.txt", "POST")
    expect(fetchMock).toHaveBeenLastCalledWith("/api/file", { method: "POST" })
  })
})

describe("openUrl — browser branch", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("calls window.open with _blank + noopener when not in Tauri", async () => {
    const openMock = vi.fn()
    vi.stubGlobal("open", openMock)

    await openUrl("https://example.com")
    expect(openMock).toHaveBeenCalledWith(
      "https://example.com",
      "_blank",
      "noopener,noreferrer",
    )
  })
})
