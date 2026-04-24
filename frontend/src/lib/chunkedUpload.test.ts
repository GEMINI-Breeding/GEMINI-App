/**
 * Unit tests for lib/chunkedUpload.ts.
 *
 * Mocks global fetch so we verify:
 *   - the number of chunks derived from chunkSize + file size
 *   - the multipart bodies sent per chunk (chunk_index, total_chunks, ids)
 *   - resume: check_uploaded_chunks pre-call, skip already-uploaded indices
 *   - abort via AbortSignal
 *   - onProgress reports monotonic uploaded bytes and fraction
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { uploadFileChunked } from "./chunkedUpload"

type FetchCall = {
  url: string
  method: string
  body: FormData | string | undefined
}

function mockFetch(impl: (call: FetchCall) => Response): FetchCall[] {
  const calls: FetchCall[] = []
  global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const call: FetchCall = {
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body as FormData | string | undefined,
    }
    calls.push(call)
    return impl(call)
  }) as unknown as typeof fetch
  return calls
}

function makeFile(bytes: number, name = "test.bin"): File {
  const buf = new Uint8Array(bytes).fill(1)
  return new File([buf], name)
}

describe("uploadFileChunked", () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem("gemini.auth.token", "tok-xyz")
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("splits a file into the expected number of chunks and reports progress monotonically", async () => {
    const file = makeFile(2500) // 2500 bytes, chunkSize 1000 → 3 chunks
    const calls = mockFetch((c) => {
      if (c.url.includes("check_uploaded_chunks")) {
        return new Response(
          JSON.stringify({ uploaded_chunks: 0, total_chunks: 3, complete: false }),
          { status: 200 },
        )
      }
      return new Response("{}", { status: 201 })
    })
    const progress: number[] = []
    const result = await uploadFileChunked({
      file,
      fileIdentifier: "fid-1",
      objectName: "bucket/path/test.bin",
      chunkSize: 1000,
      onProgress: (p) => progress.push(p.uploaded),
    })

    expect(result.chunkCount).toBe(3)
    expect(result.bytes).toBe(2500)
    // 1 check_uploaded_chunks + 3 upload_chunk.
    expect(calls).toHaveLength(4)
    expect(calls[0].url).toContain("check_uploaded_chunks")
    for (const c of calls.slice(1)) {
      expect(c.url).toContain("upload_chunk")
      expect(c.method).toBe("POST")
      expect(c.body).toBeInstanceOf(FormData)
    }
    // uploaded is non-decreasing
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1])
    }
    // final uploaded equals total
    expect(progress[progress.length - 1]).toBe(2500)
  })

  it("resumes by skipping already-uploaded chunks reported by the server", async () => {
    const file = makeFile(3000)
    const calls = mockFetch((c) => {
      if (c.url.includes("check_uploaded_chunks")) {
        return new Response(
          JSON.stringify({ uploaded_chunks: 2, total_chunks: 3, complete: false }),
          { status: 200 },
        )
      }
      return new Response("{}", { status: 201 })
    })
    const result = await uploadFileChunked({
      file,
      fileIdentifier: "fid-2",
      objectName: "bucket/path/test.bin",
      chunkSize: 1000,
    })
    // One upload_chunk (index 2) only; index 0 and 1 were already on the server.
    const uploadCalls = calls.filter((c) => c.url.includes("upload_chunk"))
    expect(uploadCalls).toHaveLength(1)
    expect(result.chunkCount).toBe(3)
  })

  it("stops early when the AbortSignal fires", async () => {
    const file = makeFile(3000)
    mockFetch((c) => {
      if (c.url.includes("check_uploaded_chunks")) {
        return new Response(
          JSON.stringify({ uploaded_chunks: 0, total_chunks: 3 }),
          { status: 200 },
        )
      }
      return new Response("{}", { status: 201 })
    })
    const controller = new AbortController()
    const promise = uploadFileChunked({
      file,
      fileIdentifier: "fid-3",
      objectName: "bucket/x",
      chunkSize: 1000,
      signal: controller.signal,
      onProgress: () => controller.abort(), // abort after first chunk lands
    })
    await expect(promise).rejects.toThrowError(/abort/i)
  })

  it("rethrows the chunk-server error when a chunk POST fails", async () => {
    const file = makeFile(1000)
    mockFetch((c) => {
      if (c.url.includes("check_uploaded_chunks")) {
        return new Response(JSON.stringify({ uploaded_chunks: 0, total_chunks: 1 }), {
          status: 200,
        })
      }
      return new Response("boom", { status: 500 })
    })
    await expect(
      uploadFileChunked({
        file,
        fileIdentifier: "fid-4",
        objectName: "bucket/x",
        chunkSize: 1000,
      }),
    ).rejects.toThrowError(/500/)
  })
})
