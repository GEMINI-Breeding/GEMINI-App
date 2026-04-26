import {
  SensorTypesService,
  type SensorTypeInput,
  type SensorTypeOutput,
} from "@/client"
import type { EntityConfig } from "@/features/admin/lib/types"
import { idAsNumber, parseInfoField } from "@/features/admin/lib/ids"

function normalize(input: SensorTypeInput): SensorTypeInput {
  return {
    ...input,
    sensor_type_info: parseInfoField(input.sensor_type_info) as SensorTypeInput["sensor_type_info"],
  }
}

export const sensorTypesConfig: EntityConfig<SensorTypeOutput, SensorTypeInput> = {
  slug: "sensor-types",
  singular: "Sensor type",
  plural: "Sensor types",
  queryKey: ["admin", "sensor_types"],
  rowId: (r) => String(r.id ?? ""),
  list: async () =>
    (await SensorTypesService.apiSensorTypesAllGetAllSensorTypes({
      limit: 500,
      offset: 0,
    })) as SensorTypeOutput[],
  create: async (input) =>
    (await SensorTypesService.apiSensorTypesCreateSensorType({
      requestBody: normalize(input),
    })) as SensorTypeOutput,
  update: async (row, input) =>
    (await SensorTypesService.apiSensorTypesIdSensorTypeIdUpdateSensorType({
      sensorTypeId: idAsNumber(row.id),
      requestBody: normalize(input),
    })) as SensorTypeOutput,
  delete: async (row) =>
    SensorTypesService.apiSensorTypesIdSensorTypeIdDeleteSensorType({
      sensorTypeId: idAsNumber(row.id),
    }),
  fields: [
    { key: "sensor_type_name", label: "Name", type: "text", required: true },
    { key: "sensor_type_info", label: "Info (JSON)", type: "json", tableHidden: true },
  ],
  emptyInput: () => ({ sensor_type_name: "" }),
  toInput: (row) => ({
    sensor_type_name: row.sensor_type_name ?? "",
    sensor_type_info: row.sensor_type_info ?? undefined,
  }),
}
