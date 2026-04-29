import { describe, expect, it, vi } from "vitest"

import { SensorPlatformsService, type SensorPlatformInput } from "@/client"

import { sensorPlatformsConfig } from "./sensorPlatforms"

describe("sensorPlatformsConfig", () => {
  it("exposes a sensible config", () => {
    expect(sensorPlatformsConfig.slug).toBe("sensor-platforms")
    expect(sensorPlatformsConfig.singular).toBe("Sensor platform")
    expect(sensorPlatformsConfig.fields.map((f) => f.key)).toEqual([
      "sensor_platform_name",
      "experiment_name",
      "sensor_platform_info",
    ])
    expect(sensorPlatformsConfig.fields[0].required).toBe(true)
    expect(sensorPlatformsConfig.fields[2].tableHidden).toBe(true)
  })

  it("emptyInput is the minimal create payload", () => {
    expect(sensorPlatformsConfig.emptyInput()).toEqual({ sensor_platform_name: "" })
  })

  it("toInput drops write-only experiment_name + preserves info", () => {
    expect(
      sensorPlatformsConfig.toInput({
        id: "sp-1",
        sensor_platform_name: "Drone",
        sensor_platform_info: { vendor: "DJI" },
      } as never),
    ).toEqual({
      sensor_platform_name: "Drone",
      sensor_platform_info: { vendor: "DJI" },
    })
  })

  it("create parses a JSON-string info field", async () => {
    const spy = vi
      .spyOn(SensorPlatformsService, "apiSensorPlatformsCreateSensorPlatform")
      .mockResolvedValue({ id: "x", sensor_platform_name: "X" } as never)
    const input: SensorPlatformInput = {
      sensor_platform_name: "X",
      sensor_platform_info: '{"foo":42}' as unknown as SensorPlatformInput["sensor_platform_info"],
    }
    await sensorPlatformsConfig.create(input)
    expect(spy).toHaveBeenCalledWith({
      requestBody: { sensor_platform_name: "X", sensor_platform_info: { foo: 42 } },
    })
    spy.mockRestore()
  })

  it("delete passes the id as a string for the SDK", async () => {
    const spy = vi
      .spyOn(SensorPlatformsService, "apiSensorPlatformsIdSensorPlatformIdDeleteSensorPlatform")
      .mockResolvedValue({} as never)
    await sensorPlatformsConfig.delete({
      id: "sp-1",
      sensor_platform_name: "Y",
    } as never)
    expect(spy).toHaveBeenCalledWith({ sensorPlatformId: "sp-1" })
    spy.mockRestore()
  })
})
