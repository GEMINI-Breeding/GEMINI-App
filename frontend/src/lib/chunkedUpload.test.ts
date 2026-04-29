/**
 * Unit tests for lib/chunkedUpload.ts.
 *
 * Mocks global fetch so we verify:
 *   - the number of chunks derived from chunkSize + file size
 *   - the multipart bodies sent per chunk (chunk_index, total_chunks, ids)
 *   - resume: check_uploaded_chunks pre-call, skip part numbers reported by the server
 *   - parallel chunk uploads when parallelParts > 1
 *   - abort via AbortSignal also POSTs /abort_upload
 *   - onProgress reports monotonic uploaded bytes
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { uploadFileChunked } from "./chunkedUpload"

type FetchCall = {
  url: string
  method: string
  body: FormData | string | undefined
}

function mockFetch(impl: (call: FetchCall) => Promise<Response> | Response): FetchCall[] {
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
          JSON.stringify({ uploaded_part_numbers: [], total_chunks: 3, complete: false }),
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
      parallelParts: 1,
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
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1])
    }
    expect(progress[progress.length - 1]).toBe(2500)
  })

  it("resumes by skipping the part numbers the server reports", async () => {
    const file = makeFile(3000)
    const calls = mockFetch((c) => {
      if (c.url.includes("check_uploaded_chunks")) {
        // Server already has parts 1 and 3 (1-indexed). Only part 2 (chunk_index 1) should be re-sent.
        return new Response(
          JSON.stringify({ uploaded_part_numbers: [1, 3], total_chunks: 3, complete: false }),
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
      parallelParts: 1,
    })
    const uploadCalls = calls.filter((c) => c.url.includes("upload_chunk"))
    expect(uploadCalls).toHaveLength(1)
    const form = uploadCalls[0].body as FormData
    expect(form.get("chunk_index")).toBe("1")
    expect(result.chunkCount).toBe(3)
  })

  it("uploads multiple chunks in parallel when parallelParts > 1", async () => {
    const file = makeFile(4000) // 4 chunks of 1000
    let inFlight = 0
    let maxInFlight = 0
    const calls = mockFetch(async (c) => {
      if (c.url.includes("check_uploaded_chunks")) {
        return new Response(
          JSON.stringify({ uploaded_part_numbers: [], total_chunks: 4, complete: false }),
          { status: 200 },
        )
      }
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      // Yield to the event loop so concurrent calls can pile up.
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return new Response("{}", { status: 201 })
    })
    await uploadFileChunked({
      file,
      fileIdentifier: "fid-par",
      objectName: "bucket/par.bin",
      chunkSize: 1000,
      parallelParts: 3,
    })
    expect(maxInFlight).toBeGreaterThanOrEqual(2)
    expect(calls.filter((c) => c.url.includes("upload_chunk"))).toHaveLength(4)
  })

  it("posts /abort_upload and rejects when the AbortSignal fires", async () => {
    const file = makeFile(3000)
    const controller = new AbortController()
    const calls = mockFetch(async (c) => {
      if (c.url.includes("check_uploaded_chunks")) {
        return new Response(
          JSON.stringify({ uploaded_part_numbers: [], total_chunks: 3 }),
          { status: 200 },
        )
      }
      if (c.url.includes("abort_upload")) {
        return new Response("{}", { status: 200 })
      }
      // Abort partway through the chunk uploads.
      controller.abort()
      // Mimic fetch's behaviour when the signal is aborted mid-flight.
      throw new DOMException("Aborted", "AbortError")
    })
    await expect(
      uploadFileChunked({
        file,
        fileIdentifier: "fid-3",
        objectName: "bucket/x",
        chunkSize: 1000,
        parallelParts: 1,
        signal: controller.signal,
      }),
    ).rejects.toThrow()
    // Wait a microtask so the best-effort abort_upload fetch is observed.
    await new Promise((r) => setTimeout(r, 0))
    expect(calls.some((c) => c.url.includes("abort_upload"))).toBe(true)
  })

  it("rethrows the chunk-server error when a chunk POST fails", async () => {
    const file = makeFile(1000)
    mockFetch((c) => {
      if (c.url.includes("check_uploaded_chunks")) {
        return new Response(
          JSON.stringify({ uploaded_part_numbers: [], total_chunks: 1 }),
          { status: 200 },
        )
      }
      if (c.url.includes("abort_upload")) {
        return new Response("{}", { status: 200 })
      }
      return new Response("boom", { status: 500 })
    })
    await expect(
      uploadFileChunked({
        file,
        fileIdentifier: "fid-4",
        objectName: "bucket/x",
        chunkSize: 1000,
        parallelParts: 1,
      }),
    ).rejects.toThrowError(/500/)
  })
})
