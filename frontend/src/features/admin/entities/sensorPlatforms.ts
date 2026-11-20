import {
  type SensorPlatformInput,
  type SensorPlatformOutput,
  SensorPlatformsService,
} from "@/client"
import { idAsString, parseInfoField } from "@/features/admin/lib/ids"
import type { EntityConfig } from "@/features/admin/lib/types"

function normalize(input: SensorPlatformInput): SensorPlatformInput {
  return {
    ...input,
    sensor_platform_info: parseInfoField(
      input.sensor_platform_info,
    ) as SensorPlatformInput["sensor_platform_info"],
  }
}

export const sensorPlatformsConfig: EntityConfig<
  SensorPlatformOutput,
  SensorPlatformInput
> = {
  slug: "sensor-platforms",
  singular: "Sensor platform",
  plural: "Sensor platforms",
  queryKey: ["admin", "sensor_platforms"],
  rowId: (r) => String(r.id ?? ""),
  list: async () =>
    (await SensorPlatformsService.apiSensorPlatformsAllGetAllSensorPlatforms({
      limit: 500,
      offset: 0,
    })) as SensorPlatformOutput[],
  create: async (input) =>
    (await SensorPlatformsService.apiSensorPlatformsCreateSensorPlatform({
      requestBody: normalize(input),
    })) as SensorPlatformOutput,
  update: async (row, input) =>
    (await SensorPlatformsService.apiSensorPlatformsIdSensorPlatformIdUpdateSensorPlatform(
      {
        sensorPlatformId: idAsString(row.id),
        requestBody: normalize(input),
      },
    )) as SensorPlatformOutput,
  delete: async (row) =>
    SensorPlatformsService.apiSensorPlatformsIdSensorPlatformIdDeleteSensorPlatform(
      {
        sensorPlatformId: idAsString(row.id),
      },
    ),
  fields: [
    {
      key: "sensor_platform_name",
      label: "Name",
      type: "text",
      required: true,
    },
    {
      key: "experiment_name",
      label: "Experiment",
      type: "text",
      placeholder: "(experiment name)",
    },
    {
      key: "sensor_platform_info",
      label: "Info (JSON)",
      type: "json",
      tableHidden: true,
    },
  ],
  emptyInput: () => ({ sensor_platform_name: "" }),
  toInput: (row) => ({
    sensor_platform_name: row.sensor_platform_name ?? "",
    // experiment_name is write-only — SensorPlatformOutput doesn't echo it back.
    sensor_platform_info: row.sensor_platform_info ?? undefined,
  }),
}
