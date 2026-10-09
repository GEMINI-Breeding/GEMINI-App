import { describe, expect, it } from "vitest"

import {
  emptyModel,
  modelDisplayName,
  modelJobParams,
  modelKey,
  modelProblem,
  normalizeModel,
  tasksFor,
  weightsObjectPath,
} from "./inferenceModels"

describe("normalizeModel", () => {
  it("reads a Roboflow-only entry saved before other sources existed", () => {
    const m = normalizeModel({
      label: "Stand counter",
      roboflow_api_key: "k",
      roboflow_model_id: "ws/m/1",
      task_type: "segmentation",
    })
    expect(m.source).toBe("roboflow")
    expect(m.task_type).toBe("segmentation")
    expect(modelKey(m)).toBe("ws/m/1")
  })

  it("drops a task the source can't run", () => {
    const m = normalizeModel({
      source: "roboflow",
      roboflow_model_id: "ws/m/1",
      task_type: "classification",
    })
    expect(m.task_type).toBe("detection")
  })
})

describe("tasksFor", () => {
  it("has no zero-shot segmentation", () => {
    expect(
      tasksFor({ source: "huggingface", hf_zero_shot: true }),
    ).not.toContain("segmentation")
  })
})

describe("modelProblem", () => {
  it("needs a token for Hugging Face cloud but not locally", () => {
    const local = { ...emptyModel("huggingface"), hf_model_id: "a/b" }
    expect(modelProblem(local)).toBeNull()
    expect(modelProblem({ ...local, hf_mode: "cloud" })).toMatch(/token/)
  })

  it("needs labels for zero-shot models", () => {
    const m = {
      ...emptyModel("huggingface"),
      hf_model_id: "google/owlvit-base-patch32",
      hf_zero_shot: true,
    }
    expect(modelProblem(m)).toMatch(/labels/)
    expect(modelProblem({ ...m, hf_prompt: "weed, crop" })).toBeNull()
  })

  it("needs an uploaded file for local weights", () => {
    expect(modelProblem(emptyModel("local_weights"))).toMatch(/Upload/)
  })
})

describe("modelJobParams", () => {
  it("sends the Roboflow server URL only for Roboflow models", () => {
    const rf = {
      ...emptyModel("roboflow"),
      roboflow_api_key: "k",
      roboflow_model_id: "ws/m/1",
    }
    expect(
      modelJobParams(rf, { localServerUrl: "http://localhost:9002" }),
    ).toEqual({
      source: "roboflow",
      task_type: "detection",
      api_key: "k",
      model_id: "ws/m/1",
      api_url: "http://localhost:9002",
    })
    const lw = { ...emptyModel("local_weights"), weights_path: "Models/w.pt" }
    expect(
      modelJobParams(lw, { localServerUrl: "http://localhost:9002" }),
    ).toEqual({
      source: "local_weights",
      task_type: "detection",
      weights_path: "Models/w.pt",
    })
  })

  it("uses a per-run prompt override for zero-shot models", () => {
    const m = {
      ...emptyModel("huggingface"),
      hf_model_id: "openai/clip-vit-base-patch32",
      task_type: "classification" as const,
      hf_zero_shot: true,
      hf_prompt: "healthy, diseased",
    }
    expect(modelJobParams(m, { prompt: "rust, blight" })).toMatchObject({
      hf_zero_shot: true,
      hf_prompt: "rust, blight",
    })
    expect(modelJobParams(m)).not.toHaveProperty("hf_token")
  })
})

describe("display and storage names", () => {
  it("shows the uploaded file name for unlabeled local weights", () => {
    const m = {
      ...emptyModel("local_weights"),
      weights_path: "Models/weights/1-best.pt",
      weights_name: "best.pt",
    }
    expect(modelDisplayName(m)).toBe("best.pt")
  })

  it("makes a safe, unique object path for uploads", () => {
    expect(weightsObjectPath("my model (v2).pt", 123)).toBe(
      "Models/weights/123-my_model_v2_.pt",
    )
  })
})
