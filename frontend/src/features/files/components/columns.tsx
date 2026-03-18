import type { ColumnDef, FilterFn } from "@tanstack/react-table"

import type { FileUploadPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import { ColumnFilter } from "./ColumnFilter"
import { UploadActionsMenu } from "./UploadActionsMenu"

const arrayIncludesFilter: FilterFn<FileUploadPublic> = (
  row,
  columnId,
  filterValue: string[],
) => {
  const value = String(row.getValue(columnId) ?? "")
  return filterValue.includes(value)
}

// ── Individual column definitions ─────────────────────────────────────────────

const colDataType: ColumnDef<FileUploadPublic> = {
  accessorKey: "data_type",
  header: "Data Type",
  cell: ({ row }) => <span className="font-medium">{row.original.data_type}</span>,
}

const colExperiment: ColumnDef<FileUploadPublic> = {
  accessorKey: "experiment",
  header: ({ column }) => <ColumnFilter column={column} title="Experiment" />,
  filterFn: arrayIncludesFilter,
}

const colLocation: ColumnDef<FileUploadPublic> = {
  accessorKey: "location",
  header: ({ column }) => <ColumnFilter column={column} title="Location" />,
  filterFn: arrayIncludesFilter,
}

const colPopulation: ColumnDef<FileUploadPublic> = {
  accessorKey: "population",
  header: ({ column }) => <ColumnFilter column={column} title="Population" />,
  filterFn: arrayIncludesFilter,
}

const colDate: ColumnDef<FileUploadPublic> = {
  accessorKey: "date",
  header: ({ column }) => <ColumnFilter column={column} title="Date" />,
  filterFn: arrayIncludesFilter,
}

const colPlatform: ColumnDef<FileUploadPublic> = {
  accessorKey: "platform",
  header: ({ column }) => <ColumnFilter column={column} title="Platform" />,
  filterFn: arrayIncludesFilter,
  cell: ({ row }) => (
    <span className="text-muted-foreground">{row.original.platform || "—"}</span>
  ),
}

const colSensor: ColumnDef<FileUploadPublic> = {
  accessorKey: "sensor",
  header: ({ column }) => <ColumnFilter column={column} title="Sensor" />,
  filterFn: arrayIncludesFilter,
  cell: ({ row }) => (
    <span className="text-muted-foreground">{row.original.sensor || "—"}</span>
  ),
}

const colFiles: ColumnDef<FileUploadPublic> = {
  accessorKey: "file_count",
  header: "Files",
  cell: ({ row }) => <span className="tabular-nums">{row.original.file_count}</span>,
}

const colStatus: ColumnDef<FileUploadPublic> = {
  accessorKey: "status",
  header: ({ column }) => <ColumnFilter column={column} title="Status" />,
  filterFn: arrayIncludesFilter,
  cell: ({ row }) => {
    const status = row.original.status
    const variant =
      status === "completed" ? "default" : status === "missing" ? "destructive" : "secondary"
    return <Badge variant={variant}>{status}</Badge>
  },
}

const colUploaded: ColumnDef<FileUploadPublic> = {
  accessorKey: "created_at",
  header: "Uploaded",
  cell: ({ row }) => (
    <span className="text-muted-foreground">
      {new Date(row.original.created_at).toLocaleDateString()}
    </span>
  ),
}

const colActions: ColumnDef<FileUploadPublic> = {
  id: "actions",
  header: () => <span className="sr-only">Actions</span>,
  cell: ({ row }) => (
    <div className="flex justify-end">
      <UploadActionsMenu upload={row.original} />
    </div>
  ),
}

// ── Columns per data type ──────────────────────────────────────────────────────

// Fields that have platform + sensor
const WITH_PLATFORM_SENSOR = ["Image Data", "Orthomosaic", "Farm-ng Binary File"]
// Fields that have platform but not sensor
const WITH_PLATFORM_ONLY = ["Platform Logs"]
// Fields that have no date/platform/sensor (population-level data)
const POP_LEVEL_ONLY = ["Field Design"]

const TAIL = [colFiles, colStatus, colUploaded, colActions]

export function getColumnsForDataType(
  dataType: string | null,
): ColumnDef<FileUploadPublic>[] {
  if (!dataType) {
    // "All" — show data type column + all fields
    return [colDataType, colExperiment, colLocation, colPopulation, colDate, colPlatform, colSensor, ...TAIL]
  }
  if (POP_LEVEL_ONLY.includes(dataType)) {
    return [colExperiment, colLocation, colPopulation, ...TAIL]
  }
  if (WITH_PLATFORM_SENSOR.includes(dataType)) {
    return [colExperiment, colLocation, colPopulation, colDate, colPlatform, colSensor, ...TAIL]
  }
  if (WITH_PLATFORM_ONLY.includes(dataType)) {
    return [colExperiment, colLocation, colPopulation, colDate, colPlatform, ...TAIL]
  }
  // Farm-ng Binary File, Weather Data, and anything else: no platform/sensor
  return [colExperiment, colLocation, colPopulation, colDate, ...TAIL]
}
