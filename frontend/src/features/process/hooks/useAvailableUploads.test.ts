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

describe("groupUploads from folder counts", () => {
  // What the server's upload_folders register sends: a folder per
  // extension with its count, under a stand-in file name.
  const uploads = groupUploads([
    { object_name: `${DRONE}/Images/files.jpg`, count: 453 },
    {
      object_name: `${DRONE.replace("bbbb2222", "cccc3333")}/Images/files.jpg`,
      count: 451,
    },
    { object_name: `${AMIGA}/RGB/Images/top/files.jpg`, count: 900 },
    { object_name: `${AMIGA}/RGB/Metadata/files.csv`, count: 1 },
  ])

  it("adds the counts of a camera's parts into one dataset", () => {
    expect(uploads.find((u) => u.platform === "DJI")).toMatchObject({
      dataType: "Image Data",
      fileCount: 904,
      datasetShortIds: ["bbbb2222", "cccc3333"],
    })
  })

  it("still finds an extracted rover log", () => {
    expect(uploads.find((u) => u.platform === "Amiga")).toMatchObject({
      dataType: "Farm-ng Binary File",
      fileCount: 900,
    })
  })
})
