import {
  DataFormatsService,
  DataTypesService,
  SensorTypesService,
  SensorsService,
  type DataFormatOutput,
  type DataTypeOutput,
  type SensorInput,
  type SensorOutput,
  type SensorTypeOutput,
} from "@/client"
import type { EntityConfig, EntityField } from "@/features/admin/lib/types"
import { idAsNumber, idAsString, parseInfoField } from "@/features/admin/lib/ids"
import { useQuery } from "@tanstack/react-query"

function normalize(input: SensorInput): SensorInput {
  return {
    ...input,
    sensor_info: parseInfoField(input.sensor_info) as SensorInput["sensor_info"],
  }
}

function useSensorTypeOptions() {
  const { data } = useQuery<SensorTypeOutput[], Error>({
    queryKey: ["admin", "sensor_types", "options"],
    queryFn: async () =>
      (await SensorTypesService.apiSensorTypesAllGetAllSensorTypes({
        limit: 500,
        offset: 0,
      })) as SensorTypeOutput[],
  })
  return (data ?? [])
    .filter((st) => st.id != null)
    .map((st) => ({
      value: idAsNumber(st.id),
      label: st.sensor_type_name ?? `#${st.id}`,
    }))
}

function useDataTypeOptions() {
  const { data } = useQuery<DataTypeOutput[], Error>({
    queryKey: ["admin", "data_types", "options"],
    queryFn: async () =>
      (await DataTypesService.apiDataTypesAllGetAllDataTypes({
        limit: 500,
        offset: 0,
      })) as DataTypeOutput[],
  })
  return (data ?? [])
    .filter((dt) => dt.id != null)
    .map((dt) => ({
      value: idAsNumber(dt.id),
      label: dt.data_type_name ?? `#${dt.id}`,
    }))
}

function useDataFormatOptions() {
  const { data } = useQuery<DataFormatOutput[], Error>({
    queryKey: ["admin", "data_formats", "options"],
    queryFn: async () =>
      (await DataFormatsService.apiDataFormatsAllGetAllDataFormats({
        limit: 500,
        offset: 0,
      })) as DataFormatOutput[],
  })
  return (data ?? [])
    .filter((df) => df.id != null)
    .map((df) => ({
      value: idAsNumber(df.id),
      label: df.data_format_name ?? `#${df.id}`,
    }))
}

const fields: EntityField<SensorInput>[] = [
  { key: "sensor_name", label: "Name", type: "text", required: true },
  {
    key: "sensor_type_id",
    label: "Sensor type",
    type: "select",
    optionsHook: useSensorTypeOptions,
  },
  {
    key: "sensor_data_type_id",
    label: "Data type",
    type: "select",
    optionsHook: useDataTypeOptions,
  },
  {
    key: "sensor_data_format_id",
    label: "Data format",
    type: "select",
    optionsHook: useDataFormatOptions,
  },
  { key: "sensor_info", label: "Info (JSON)", type: "json", tableHidden: true },
]

export const sensorsConfig: EntityConfig<SensorOutput, SensorInput> = {
  slug: "sensors",
  singular: "Sensor",
  plural: "Sensors",
  queryKey: ["admin", "sensors"],
  rowId: (r) => String(r.id ?? ""),
  list: async () =>
    (await SensorsService.apiSensorsAllGetAllSensors({
      limit: 500,
      offset: 0,
    })) as SensorOutput[],
  create: async (input) =>
    (await SensorsService.apiSensorsCreateSensor({
      requestBody: normalize(input),
    })) as SensorOutput,
  update: async (row, input) =>
    (await SensorsService.apiSensorsIdSensorIdUpdateSensor({
      sensorId: idAsString(row.id),
      requestBody: normalize(input),
    })) as SensorOutput,
  delete: async (row) =>
    SensorsService.apiSensorsIdSensorIdDeleteSensor({ sensorId: idAsString(row.id) }),
  fields,
  emptyInput: () => ({ sensor_name: "" }) as SensorInput,
  toInput: (row) =>
    ({
      sensor_name: row.sensor_name ?? "",
      sensor_type_id:
        row.sensor_type_id != null ? idAsNumber(row.sensor_type_id) : undefined,
      sensor_data_type_id:
        row.sensor_data_type_id != null ? idAsNumber(row.sensor_data_type_id) : undefined,
      sensor_data_format_id:
        row.sensor_data_format_id != null
          ? idAsNumber(row.sensor_data_format_id)
          : undefined,
      sensor_info: row.sensor_info ?? undefined,
    }) as SensorInput,
}
