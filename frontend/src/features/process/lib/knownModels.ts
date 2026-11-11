/**
 * Models set up before, to pick again in any pipeline (aerial or ground):
 * every pipeline's configured models, plus weights files already uploaded
 * into storage (`Models/weights/`) that no pipeline uses yet.
 */
import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { type FileMetadata, FilesService } from "@/client"
import {
  emptyModel,
  type InferenceModel,
  modelKey,
  normalizeModel,
  sameModel,
  WEIGHTS_EXTENSIONS,
} from "./inferenceModels"
import { type Pipeline, useAllPipelines } from "./runStore"

export const WEIGHTS_PREFIX = "Models/weights/"
/** Agricultural checkpoints the app provides to train from (and run). */
export const BASE_MODELS_PREFIX = "Models/base/"

export interface KnownModel {
  model: InferenceModel
  /** Names of the pipelines that use it (none: an uploaded file only). */
  usedIn: string[]
}

/** A weights file's name as uploaded (without the upload's timestamp). */
export function weightsName(objectName: string): string {
  const base = objectName.split("/").pop() ?? objectName
  return base.replace(/^\d{10,}-/, "")
}

export function isWeightsFile(objectName: string): boolean {
  const lower = objectName.toLowerCase()
  // sam3.pt there is SAM 3's own weights (for "Describe it"), not a detector.
  if (lower.endsWith("/sam3.pt")) return false
  return WEIGHTS_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function weightsModel(objectName: string): InferenceModel {
  return {
    ...emptyModel("local_weights"),
    weights_path: objectName,
    weights_name: weightsName(objectName),
  }
}

export function collectKnownModels(
  pipelines: Pick<Pipeline, "name" | "params">[],
  weightFiles: string[],
): KnownModel[] {
  const out: KnownModel[] = []
  const add = (model: InferenceModel, usedIn?: string) => {
    if (!modelKey(model)) return
    const seen = out.find((k) => sameModel(k.model, model))
    if (!seen) out.push({ model, usedIn: usedIn ? [usedIn] : [] })
    else if (usedIn && !seen.usedIn.includes(usedIn)) seen.usedIn.push(usedIn)
  }
  for (const p of pipelines) {
    const saved = p.params?.roboflow_models
    if (Array.isArray(saved))
      for (const raw of saved) add(normalizeModel(raw), p.name)
  }
  for (const f of weightFiles) if (isWeightsFile(f)) add(weightsModel(f))
  return out
}

/** The weights files in storage (uploaded or trained here), newest first. */
export function useUploadedWeights(prefix: string = WEIGHTS_PREFIX) {
  return useQuery({
    queryKey: ["files", "list", prefix],
    queryFn: async () => {
      const files =
        ((await FilesService.apiFilesListFilePathListFiles({
          filePath: `gemini/${prefix}`,
        }).catch(() => [])) as FileMetadata[] | null) ?? []
      return files
        .filter((f) => f.object_name && isWeightsFile(f.object_name))
        .sort((a, b) =>
          String(b.last_modified ?? "").localeCompare(
            String(a.last_modified ?? ""),
          ),
        )
    },
    staleTime: 60_000,
  })
}

export function useKnownModels(): KnownModel[] {
  const pipelines = useAllPipelines()
  const weights = useUploadedWeights()
  return useMemo(
    () =>
      collectKnownModels(
        pipelines,
        (weights.data ?? []).map((f) => f.object_name ?? ""),
      ),
    [pipelines, weights.data],
  )
}
