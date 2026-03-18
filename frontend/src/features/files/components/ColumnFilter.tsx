import type { Column } from "@tanstack/react-table"
import { ListFilter } from "lucide-react"
import { useMemo } from "react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface ColumnFilterProps<TData> {
  column: Column<TData, unknown>
  title: string
}

export function ColumnFilter<TData>({ column, title }: ColumnFilterProps<TData>) {
  const selectedValues = (column.getFilterValue() as string[] | undefined) ?? []
  const isActive = selectedValues.length > 0

  const uniqueValues = useMemo(() => {
    const values = new Set<string>()
    column.getFacetedRowModel().rows.forEach((row) => {
      const value = row.getValue<string>(column.id)
      if (value != null && value !== "") {
        values.add(String(value))
      }
    })
    return Array.from(values).sort()
  }, [column])

  function toggleValue(value: string) {
    const next = selectedValues.includes(value)
      ? selectedValues.filter((v) => v !== value)
      : [...selectedValues, value]
    column.setFilterValue(next.length > 0 ? next : undefined)
  }

  return (
    <div className="flex items-center gap-1">
      <span>{title}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={`h-6 w-6 p-0 ${isActive ? "text-primary" : "text-muted-foreground"}`}
          >
            <ListFilter className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Filter {title}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {isActive && (
            <>
              <DropdownMenuItem onClick={() => column.setFilterValue(undefined)}>
                Clear filter
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {uniqueValues.map((value) => (
            <DropdownMenuCheckboxItem
              key={value}
              checked={selectedValues.includes(value)}
              onCheckedChange={() => toggleValue(value)}
              onSelect={(e) => e.preventDefault()}
            >
              {value}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
