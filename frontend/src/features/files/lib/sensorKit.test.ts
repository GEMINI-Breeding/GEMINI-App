import { describe, expect, it } from "vitest"

import {
  cameraSlug,
  parseSensorName,
  platformFromMaker,
  platformOf,
  sensorName,
} from "./sensorKit"

describe("platforms and sensors", () => {
  it("the onboard camera is the type alone; another camera is named after it", () => {
    expect(sensorName("RGB")).toBe("RGB")
    expect(sensorName("RGB", "  ")).toBe("RGB")
    expect(sensorName("RGB", "Sony A7R IV")).toBe("RGB-SonyA7RIV")
    expect(sensorName("Thermal", "FLIR vue-pro")).toBe("Thermal-FLIRVuePro")
    expect(cameraSlug("sony a7r")).toBe("SonyA7r")
  })
  it("reads a stored name back", () => {
    expect(parseSensorName("RGB-SonyA7RIV")).toEqual({
      type: "RGB",
      camera: "SonyA7RIV",
    })
    expect(parseSensorName("thermal")).toEqual({ type: "Thermal", camera: "" })
    expect(parseSensorName("FC6310")).toEqual({ type: null, camera: "" })
  })
  it("knows the platforms and which makers build drones", () => {
    expect(platformOf("drone")).toBe("Drone")
    expect(platformOf("Amiga")).toBeNull()
    expect(platformFromMaker("DJI")).toBe("Drone")
    expect(platformFromMaker("Canon")).toBeNull()
  })
})
