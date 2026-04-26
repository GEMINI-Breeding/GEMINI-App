/**
 * React-Query hooks for Models CRUD on the new GEMINIbase backend.
 *
 * Models in GEMINIbase are registry rows: a name, optional URL, and a
 * free-form `model_info` JSON blob. The frontend stores Roboflow auth
 * details (workspace/version + api_key) inside `model_info` so an
 * inference call can resolve everything from a single Model row.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { ModelsService, type ModelInput, type ModelOutput, type ModelUpdate } from "@/client"
import { isLoggedIn } from "@/lib/auth"

export type ModelInfo = {
  /** Roboflow model id, e.g. "workspace/project/version" */
  roboflow_model_id?: string
  /** Roboflow inference task type, e.g. "object-detection" */
  task_type?: string
  /** Free-form description shown in the dashboard. */
  description?: string
  /** Marker set by `/api/model_management/best_model` runs. */
  best_model_path?: string
  /** Marker set by `/api/model_management/best_locate` runs. */
  best_locate_path?: string
  [key: string]: unknown
}

export function modelInfo(model: ModelOutput): ModelInfo {
  const raw = (model.model_info ?? {}) as unknown
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as ModelInfo
    } catch {
      return {}
    }
  }
  if (raw && typeof raw === "object") return raw as ModelInfo
  return {}
}

export function useModels() {
  return useQuery<ModelOutput[], Error>({
    queryKey: ["models"],
    queryFn: async () => {
      const list = (await ModelsService.apiModelsAllGetAllModels({
        limit: 200,
        offset: 0,
      })) as ModelOutput[] | null
      return list ?? []
    },
    enabled: isLoggedIn(),
  })
}

export function useCreateModel() {
  const qc = useQueryClient()
  return useMutation<ModelOutput, Error, ModelInput>({
    mutationFn: (requestBody) => ModelsService.apiModelsCreateModel({ requestBody }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["models"] }),
  })
}

export function useUpdateModel() {
  const qc = useQueryClient()
  return useMutation<ModelOutput, Error, { modelId: string; data: ModelUpdate }>({
    mutationFn: ({ modelId, data }) =>
      ModelsService.apiModelsIdModelIdUpdateModel({ modelId, requestBody: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["models"] }),
  })
}

export function useDeleteModel() {
  const qc = useQueryClient()
  return useMutation<unknown, Error, string>({
    mutationFn: (modelId) => ModelsService.apiModelsIdModelIdDeleteModel({ modelId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["models"] }),
  })
}
