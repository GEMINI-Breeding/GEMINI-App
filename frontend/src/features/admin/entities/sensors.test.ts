import { describe, expect, it, vi } from "vitest"

import { type SensorInput, SensorsService } from "@/client"

import { sensorsConfig } from "./sensors"

describe("sensorsConfig", () => {
  it("exposes a sensible config", () => {
    expect(sensorsConfig.slug).toBe("sensors")
    expect(sensorsConfig.singular).toBe("Sensor")
    expect(sensorsConfig.fields.map((f) => f.key)).toEqual([
      "sensor_name",
      "sensor_type_id",
      "sensor_data_type_id",
      "sensor_data_format_id",
      "sensor_info",
    ])
    expect(sensorsConfig.fields[0].required).toBe(true)
    // The three FK select fields should each carry an optionsHook.
    expect(sensorsConfig.fields[1].type).toBe("select")
    expect(typeof sensorsConfig.fields[1].optionsHook).toBe("function")
    expect(sensorsConfig.fields[2].type).toBe("select")
    expect(sensorsConfig.fields[3].type).toBe("select")
    expect(sensorsConfig.fields[4].tableHidden).toBe(true)
  })

  it("emptyInput is the minimal create payload", () => {
    expect(sensorsConfig.emptyInput()).toEqual({ sensor_name: "" })
  })

  it("toInput coerces FK ids to numbers + preserves info", () => {
    expect(
      sensorsConfig.toInput({
        id: "snr-1",
        sensor_name: "RGB",
        sensor_type_id: "3",
        sensor_data_type_id: 7,
        sensor_data_format_id: "11",
        sensor_info: { resolution: "20MP" },
      } as never),
    ).toEqual({
      sensor_name: "RGB",
      sensor_type_id: 3,
      sensor_data_type_id: 7,
      sensor_data_format_id: 11,
      sensor_info: { resolution: "20MP" },
    })
  })

  it("toInput leaves missing FK ids as undefined", () => {
    expect(
      sensorsConfig.toInput({
        id: "snr-2",
        sensor_name: "RGB",
      } as never),
    ).toEqual({
      sensor_name: "RGB",
      sensor_type_id: undefined,
      sensor_data_type_id: undefined,
      sensor_data_format_id: undefined,
      sensor_info: undefined,
    })
  })

  it("create parses a JSON-string info field", async () => {
    const spy = vi
      .spyOn(SensorsService, "apiSensorsCreateSensor")
      .mockResolvedValue({ id: "x", sensor_name: "X" } as never)
    const input: SensorInput = {
      sensor_name: "X",
      sensor_info: '{"k":1}' as unknown as SensorInput["sensor_info"],
    }
    await sensorsConfig.create(input)
    expect(spy).toHaveBeenCalledWith({
      requestBody: { sensor_name: "X", sensor_info: { k: 1 } },
    })
    spy.mockRestore()
  })

  it("delete passes the id as a string for the SDK", async () => {
    const spy = vi
      .spyOn(SensorsService, "apiSensorsIdSensorIdDeleteSensor")
      .mockResolvedValue({} as never)
    await sensorsConfig.delete({ id: "snr-1", sensor_name: "Y" } as never)
    expect(spy).toHaveBeenCalledWith({ sensorId: "snr-1" })
    spy.mockRestore()
  })
})
