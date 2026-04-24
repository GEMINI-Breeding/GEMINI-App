/**
 * useChunkedUpload unit tests.
 *
 * Mocks `uploadFileChunked` so we verify the hook drives ProcessContext
 * correctly (progress string, item status) without doing real HTTP.
 */
import { act, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

// Must mock before the hook imports anything downstream.
vi.mock("@/lib/chunkedUpload", () => ({
  uploadFileChunked: vi.fn(),
}))
vi.mock("@/lib/wsManager", () => ({
  subscribe: vi.fn(() => () => {}),
  closeJob: vi.fn(),
}))

import { uploadFileChunked } from "@/lib/chunkedUpload"
import { ProcessProvider, useProcess } from "@/contexts/ProcessContext"
import { useChunkedUpload } from "./useChunkedUpload"

const mockedUpload = uploadFileChunked as unknown as ReturnType<typeof vi.fn>

const wrapper = ({ children }: { children: ReactNode }) => (
  <ProcessProvider>{children}</ProcessProvider>
)

function useHarness() {
  const upload = useChunkedUpload()
  const { addProcess, processes } = useProcess()
  return { upload, addProcess, processes }
}

describe("useChunkedUpload", () => {
  beforeEach(() => {
    mockedUpload.mockReset()
  })

  it("forwards file + identifier + object name to uploadFileChunked", async () => {
    mockedUpload.mockResolvedValue({
      objectName: "bucket/Raw/foo.bin",
      bytes: 100,
      chunkCount: 1,
    })
    const { result } = renderHook(() => useHarness(), { wrapper })

    let processId = ""
    act(() => {
      processId = result.current.addProcess({
        type: "file_upload",
        status: "running",
        title: "t",
        items: [{ id: "0", name: "foo.bin", status: "pending" }],
      })
    })

    const file = new File([new Uint8Array(100)], "foo.bin", {
      lastModified: 42,
    })

    await act(async () => {
      await result.current.upload.uploadOne(file, {
        objectPath: "bucket/Raw/foo.bin",
        processId,
        itemId: "0",
      })
    })

    expect(mockedUpload).toHaveBeenCalledTimes(1)
    const call = mockedUpload.mock.calls[0][0]
    expect(call.file).toBe(file)
    expect(call.objectName).toBe("bucket/Raw/foo.bin")
    // computeFileIdentifier must use name+size+mtime so the server can resume.
    expect(call.fileIdentifier).toBe("foo.bin:100:42")
  })

  it("marks the item completed and returns the object path on success", async () => {
    mockedUpload.mockResolvedValue({
      objectName: "bucket/Raw/bar.jpg",
      bytes: 200,
      chunkCount: 2,
    })
    const { result } = renderHook(() => useHarness(), { wrapper })

    let processId = ""
    act(() => {
      processId = result.current.addProcess({
        type: "file_upload",
        status: "running",
        title: "t",
        items: [{ id: "0", name: "bar.jpg", status: "pending" }],
      })
    })

    let out: { objectPath: string } | undefined
    await act(async () => {
      out = await result.current.upload.uploadOne(
        new File([new Uint8Array(200)], "bar.jpg"),
        { objectPath: "bucket/Raw/bar.jpg", processId, itemId: "0" },
      )
    })

    expect(out?.objectPath).toBe("bucket/Raw/bar.jpg")
    const item = result.current.processes[0].items[0]
    expect(item.status).toBe("completed")
    expect(item.label).toBeUndefined()
  })

  it("propagates upload errors so the caller can surface them", async () => {
    mockedUpload.mockRejectedValue(new Error("boom"))
    const { result } = renderHook(() => useHarness(), { wrapper })
    let processId = ""
    act(() => {
      processId = result.current.addProcess({
        type: "file_upload",
        status: "running",
        title: "t",
        items: [{ id: "0", name: "x", status: "pending" }],
      })
    })
    await expect(
      result.current.upload.uploadOne(new File([], "x"), {
        objectPath: "x",
        processId,
        itemId: "0",
      }),
    ).rejects.toThrow(/boom/)
  })
})
