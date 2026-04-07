import { ChevronDown, Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface MetricSelectorProps {
  columns: string[]
  value: string | null
  onChange: (col: string) => void
  /** Reference trait columns — shown under a "Reference Data" divider at the bottom */
  referenceColumns?: string[]
}

function formatLabel(col: string): string {
  return col.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function MetricSelector({ columns, value, onChange, referenceColumns = [] }: MetricSelectorProps) {
  const displayLabel = value ? formatLabel(value) : "Select metric…"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-between text-xs">
          <span className="truncate">{displayLabel}</span>
          <ChevronDown className="w-3 h-3 ml-1 flex-shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-64 overflow-y-auto w-56">
        {columns.map((col) => (
          <DropdownMenuItem
            key={col}
            onClick={() => onChange(col)}
            className={col === value ? "font-medium" : ""}
          >
            {formatLabel(col)}
          </DropdownMenuItem>
        ))}

        {referenceColumns.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center gap-1 text-xs font-medium text-muted-foreground py-1">
              Reference Data
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="w-3 h-3 cursor-default" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-48 text-xs">
                  These traits come from uploaded Reference Data, not extracted by a pipeline.
                </TooltipContent>
              </Tooltip>
            </DropdownMenuLabel>
            {referenceColumns.map((col) => (
              <DropdownMenuItem
                key={`ref:${col}`}
                onClick={() => onChange(`ref:${col}`)}
                className={value === `ref:${col}` ? "font-medium" : ""}
              >
                {formatLabel(col)}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
