import { ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface MetricSelectorProps {
  columns: string[]
  value: string | null
  onChange: (col: string) => void
}

function formatLabel(col: string): string {
  return col.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function MetricSelector({ columns, value, onChange }: MetricSelectorProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-between text-xs">
          <span className="truncate">{value ? formatLabel(value) : "Select metric…"}</span>
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
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
