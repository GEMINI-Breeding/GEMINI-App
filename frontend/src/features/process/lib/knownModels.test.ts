import { describe, expect, it } from "vitest"

import { collectKnownModels, weightsName } from "./knownModels"

describe("knownModels", () => {
  it("strips the upload timestamp from a weights name", () => {
    expect(
      weightsName("Models/weights/1793500271001-best-cowpea-flower.pt"),
    ).toBe("best-cowpea-flower.pt")
    expect(weightsName("Models/weights/sorghum-grain-counter.pt")).toBe(
      "sorghum-grain-counter.pt",
    )
  })

  it("joins pipelines' models with uploaded weights, once each", () => {
    const flower = {
      label: "Cowpea flowers",
      source: "local_weights",
      weights_path: "Models/weights/1793500271001-best-cowpea-flower.pt",
      weights_name: "best-cowpea-flower.pt",
    }
    const known = collectKnownModels(
      [
        { name: "Aerial A", params: { roboflow_models: [flower] } },
        {
          name: "Ground B",
          params: {
            roboflow_models: [
              flower,
              { source: "huggingface", hf_model_id: "org/detr" },
              { source: "roboflow" },
            ],
          },
        },
      ],
      [
        "Models/weights/1793500271001-best-cowpea-flower.pt",
        "Models/weights/1793574547387-sorghum_panicle.pt",
        "Models/weights/notes.txt",
      ],
    )
    expect(known.map((k) => k.usedIn)).toEqual([
      ["Aerial A", "Ground B"],
      ["Ground B"],
      [],
    ])
    expect(known[0].model.label).toBe("Cowpea flowers")
    expect(known[2].model.weights_name).toBe("sorghum_panicle.pt")
  })
})
