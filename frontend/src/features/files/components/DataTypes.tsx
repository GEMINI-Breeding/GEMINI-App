import { ChevronDown } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { dataTypes } from "@/config/dataTypes"

interface DataTypesProps {
  onChange?: (value: string) => void
  /** Set from outside (e.g. "continue a recent upload"); else self-managed. */
  value?: string | null
}

export function DataTypes({ onChange, value }: DataTypesProps) {
  const fileTypes = Object.entries(dataTypes)
    .filter(([, cfg]) => !cfg.hidden)
    .map(([key]) => key)
  const [picked, setSelectedFileType] = useState<string | null>(null)
  const selectedFileType = value !== undefined ? value : picked
  const dropdownWidth: string = "w-50"
  // The list is wider than the button: room for each type's hint.
  const listWidth = "w-[26rem]"

  const handleSelect = (type: string) => {
    setSelectedFileType(type)
    onChange?.(type)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          data-onboarding="files-data-type-selector"
          data-testid="files-data-type-selector"
          className={`${dropdownWidth} justify-between`}
        >
          {selectedFileType ?? "Select File Type"}
          <ChevronDown className="ml-2 h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className={listWidth} align="start">
        {fileTypes.map((type) => (
          <DropdownMenuItem
            key={type}
            onClick={() => handleSelect(type)}
            className="flex-col items-start gap-0"
          >
            <span>{type}</span>
            {dataTypes[type]?.hint && (
              <span className="text-muted-foreground text-xs">
                {dataTypes[type].hint}
              </span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
