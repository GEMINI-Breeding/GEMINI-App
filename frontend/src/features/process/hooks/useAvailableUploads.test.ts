import { describe, expect, it } from "vitest"

import type { FileMetadata } from "@/client"
import { groupUploads, pipelineKindAccepts } from "./useAvailableUploads"

const file = (object_name: string): FileMetadata => ({
  bucket_name: "gemini",
  object_name,
  last_modified: "",
  etag: "",
  size: 1,
})

const AMIGA = "Raw/2024/E/Davis/Cowpea/2024-07-15/Amiga/RGB/aaaa1111"
const DRONE = "Raw/2024/E/Davis/Cowpea/2024-06-01/DJI/FC6310S/bbbb2222"

describe("groupUploads", () => {
  const uploads = groupUploads([
    file(`${AMIGA}/RGB/Images/top/rgb-1.jpg`),
    file(`${AMIGA}/RGB/Images/top/rgb-2.jpg`),
    file(`${AMIGA}/RGB/Images/left/rgb-1.jpg`),
    file(`${AMIGA}/RGB/Metadata/msgs_synced.csv`),
    file(`${AMIGA}/report.txt`),
    file(`${DRONE}/Images/DJI_0001.JPG`),
  ])

  it("lists an extracted Amiga log as a rover dataset (top camera only)", () => {
    const amiga = uploads.find((u) => u.platform === "Amiga")
    expect(amiga).toMatchObject({
      dataType: "Farm-ng Binary File",
      date: "2024-07-15",
      sensor: "RGB",
      fileCount: 2,
      datasetShortIds: ["aaaa1111"],
    })
  })

  it("still lists image uploads as Image Data", () => {
    expect(uploads.find((u) => u.platform === "DJI")?.dataType).toBe(
      "Image Data",
    )
    expect(uploads).toHaveLength(2)
  })
})

describe("pipelineKindAccepts", () => {
  it("offers rover logs to ground pipelines only", () => {
    expect(pipelineKindAccepts("ground", "Farm-ng Binary File")).toBe(true)
    expect(pipelineKindAccepts("aerial", "Farm-ng Binary File")).toBe(false)
    expect(pipelineKindAccepts("ground", "Image Data")).toBe(true)
    expect(pipelineKindAccepts("ground", "Orthomosaic")).toBe(false)
  })
})
