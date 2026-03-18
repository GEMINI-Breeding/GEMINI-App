import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import {
  type ColumnFiltersState,
  type SortingState,
  getCoreRowModel,
  getFacetedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { RefreshCw, Search, X } from "lucide-react"
import { Suspense, useMemo, useState } from "react"

import { FilesService } from "@/client"
import type { FileUploadPublic } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import PendingItems from "@/components/Pending/PendingItems"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { dataTypes } from "@/config/dataTypes"
import useCustomToast from "@/hooks/useCustomToast"
import { getColumnsForDataType } from "../components/columns"

const DATA_TYPE_OPTIONS = Object.keys(dataTypes)

function getFilesQueryOptions() {
  return {
    queryFn: () => FilesService.readFiles({ skip: 0, limit: 100 }),
    queryKey: ["files"],
  }
}

function ManageDataTableContent({ selectedDataType }: { selectedDataType: string | null }) {
  const { data: files } = useSuspenseQuery(getFilesQueryOptions())
  const [globalFilter, setGlobalFilter] = useState("")
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [sorting, setSorting] = useState<SortingState>([{ id: "date", desc: true }])

  const columns = useMemo(() => getColumnsForDataType(selectedDataType), [selectedDataType])

  const filteredData = useMemo(() => {
    if (!selectedDataType) return files.data
    return files.data.filter((f) => f.data_type === selectedDataType)
  }, [files.data, selectedDataType])

  const table = useReactTable<FileUploadPublic>({
    data: filteredData,
    columns,
    state: { globalFilter, columnFilters, sorting },
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const hasActiveFilters = globalFilter !== "" || columnFilters.length > 0

  function clearFilters() {
    setGlobalFilter("")
    setColumnFilters([])
  }

  if (filteredData.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-12">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Search className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">
          {selectedDataType ? `No ${selectedDataType} records` : "No upload records yet"}
        </h3>
        <p className="text-muted-foreground">
          {selectedDataType ? "Try a different data type or upload data first" : "Upload data first, then manage it here"}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="h-9 w-[200px] pl-8"
          />
        </div>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" className="h-9" onClick={clearFilters}>
            <X className="h-4 w-4 mr-1" />
            Clear filters
          </Button>
        )}
      </div>
      <DataTable table={table} />
    </div>
  )
}

function ManageDataTable({ selectedDataType }: { selectedDataType: string | null }) {
  return (
    <Suspense fallback={<PendingItems />}>
      <ManageDataTableContent selectedDataType={selectedDataType} />
    </Suspense>
  )
}

function RefreshButton() {
  const queryClient = useQueryClient()
  const { showSuccessToast } = useCustomToast()

  const mutation = useMutation({
    mutationFn: () => FilesService.syncFiles() as Promise<{ synced: number; removed: number }>,
    onSuccess: (data: { synced: number; removed: number }) => {
      showSuccessToast(
        `Refresh complete: ${data.synced} updated, ${data.removed} removed`,
      )
      queryClient.invalidateQueries({ queryKey: ["files"] })
    },
  })

  return (
    <LoadingButton
      variant="outline"
      loading={mutation.isPending}
      onClick={() => mutation.mutate()}
    >
      <RefreshCw className="h-4 w-4" />
      Refresh
    </LoadingButton>
  )
}

export function ManageData() {
  const [selectedDataType, setSelectedDataType] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Manage Data</h1>
          <p className="text-muted-foreground">
            View and manage your uploaded data
          </p>
        </div>
        <RefreshButton />
      </div>
      <div className="flex items-center gap-3">
        <Select
          value={selectedDataType ?? "__all__"}
          onValueChange={(v) => setSelectedDataType(v === "__all__" ? null : v)}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All data types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All data types</SelectItem>
            {DATA_TYPE_OPTIONS.map((dt) => (
              <SelectItem key={dt} value={dt}>{dt}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <ManageDataTable selectedDataType={selectedDataType} />
    </div>
  )
}
