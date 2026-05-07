/**
 * Spot-check that one entity config wires the SDK calls correctly + that
 * the form/table fields look sane. The other entities follow the same
 * shape; we don't bother re-testing each one.
 */
import { describe, expect, it, vi } from "vitest"

import { type SensorTypeInput, SensorTypesService } from "@/client"

import { sensorTypesConfig } from "./sensorTypes"

describe("sensorTypesConfig", () => {
  it("exposes a sensible config", () => {
    expect(sensorTypesConfig.slug).toBe("sensor-types")
    expect(sensorTypesConfig.singular).toBe("Sensor type")
    expect(sensorTypesConfig.plural).toBe("Sensor types")
    expect(sensorTypesConfig.fields.map((f) => f.key)).toEqual([
      "sensor_type_name",
      "sensor_type_info",
    ])
    expect(sensorTypesConfig.fields[0].required).toBe(true)
    // Info column hidden in the table view (still in the form).
    expect(sensorTypesConfig.fields[1].tableHidden).toBe(true)
  })

  it("emptyInput is the minimal create payload", () => {
    expect(sensorTypesConfig.emptyInput()).toEqual({ sensor_type_name: "" })
  })

  it("toInput rebuilds the form value from a row", () => {
    expect(
      sensorTypesConfig.toInput({
        id: 1,
        sensor_type_name: "RGB Camera",
        sensor_type_info: { wavelength: "400-700nm" },
      }),
    ).toEqual({
      sensor_type_name: "RGB Camera",
      sensor_type_info: { wavelength: "400-700nm" },
    })
  })

  it("create parses a JSON-string info field", async () => {
    const spy = vi
      .spyOn(SensorTypesService, "apiSensorTypesCreateSensorType")
      .mockResolvedValue({ id: 1, sensor_type_name: "X" } as never)
    const input: SensorTypeInput = {
      sensor_type_name: "X",
      sensor_type_info:
        '{"foo":42}' as unknown as SensorTypeInput["sensor_type_info"],
    }
    await sensorTypesConfig.create(input)
    expect(spy).toHaveBeenCalledWith({
      requestBody: { sensor_type_name: "X", sensor_type_info: { foo: 42 } },
    })
    spy.mockRestore()
  })

  it("delete coerces id to a number for the SDK", async () => {
    const spy = vi
      .spyOn(SensorTypesService, "apiSensorTypesIdSensorTypeIdDeleteSensorType")
      .mockResolvedValue({} as never)
    await sensorTypesConfig.delete({ id: "7", sensor_type_name: "Y" })
    expect(spy).toHaveBeenCalledWith({ sensorTypeId: 7 })
    spy.mockRestore()
  })
})
