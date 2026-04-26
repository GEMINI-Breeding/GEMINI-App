import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ModelsService, type ModelOutput } from "@/client"

import {
  modelInfo,
  useCreateModel,
  useDeleteModel,
  useModels,
  useUpdateModel,
} from "./useModels"

const allMock = vi.spyOn(ModelsService, "apiModelsAllGetAllModels")
const createMock = vi.spyOn(ModelsService, "apiModelsCreateModel")
const updateMock = vi.spyOn(ModelsService, "apiModelsIdModelIdUpdateModel")
const deleteMock = vi.spyOn(ModelsService, "apiModelsIdModelIdDeleteModel")

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  localStorage.setItem("gemini.auth.token", "fake-token")
})
afterEach(() => {
  localStorage.removeItem("gemini.auth.token")
  vi.clearAllMocks()
})

describe("modelInfo", () => {
  it("returns {} when model_info is null", () => {
    expect(modelInfo({ id: "1", model_name: "m" } as ModelOutput)).toEqual({})
  })
  it("parses string-encoded JSON model_info", () => {
    const row: ModelOutput = {
      id: "1",
      model_name: "m",
      model_info: '{"roboflow_model_id":"a/b/1"}',
    }
    expect(modelInfo(row).roboflow_model_id).toBe("a/b/1")
  })
  it("returns {} for unparseable string model_info", () => {
    const row = { id: "1", model_name: "m", model_info: "not-json" } as ModelOutput
    expect(modelInfo(row)).toEqual({})
  })
  it("returns object model_info as-is", () => {
    const row = {
      id: "1",
      model_name: "m",
      model_info: { roboflow_model_id: "a/b/2", task_type: "object-detection" },
    } as ModelOutput
    const info = modelInfo(row)
    expect(info.roboflow_model_id).toBe("a/b/2")
    expect(info.task_type).toBe("object-detection")
  })
})

describe("useModels", () => {
  it("fetches the models list and unwraps null", async () => {
    allMock.mockResolvedValue(null as never)
    const { result } = renderHook(() => useModels(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(allMock).toHaveBeenCalledWith({ limit: 200, offset: 0 })
    expect(result.current.data).toEqual([])
  })
})

describe("useCreateModel / useUpdateModel / useDeleteModel", () => {
  it("create forwards requestBody", async () => {
    createMock.mockResolvedValue({ id: "x", model_name: "x" } as never)
    const { result } = renderHook(() => useCreateModel(), { wrapper })
    await result.current.mutateAsync({ model_name: "Foo" })
    expect(createMock).toHaveBeenCalledWith({ requestBody: { model_name: "Foo" } })
  })
  it("update forwards modelId + requestBody", async () => {
    updateMock.mockResolvedValue({ id: "x", model_name: "y" } as never)
    const { result } = renderHook(() => useUpdateModel(), { wrapper })
    await result.current.mutateAsync({ modelId: "abc", data: { model_name: "y" } })
    expect(updateMock).toHaveBeenCalledWith({ modelId: "abc", requestBody: { model_name: "y" } })
  })
  it("delete forwards modelId", async () => {
    deleteMock.mockResolvedValue(undefined as never)
    const { result } = renderHook(() => useDeleteModel(), { wrapper })
    await result.current.mutateAsync("abc")
    expect(deleteMock).toHaveBeenCalledWith({ modelId: "abc" })
  })
})
