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
}

export function DataTypes({ onChange }: DataTypesProps) {
  const fileTypes = Object.keys(dataTypes)
  const [selectedFileType, setSelectedFileType] = useState<string | null>(null)
  const dropdownWidth: string = "w-50"

  const handleSelect = (type: string) => {
    setSelectedFileType(type)
    onChange?.(type)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={`${dropdownWidth} justify-between`}
        >
          {selectedFileType ?? "Select File Type"}
          <ChevronDown className="ml-2 h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className={dropdownWidth}>
        {fileTypes.map((type) => (
          <DropdownMenuItem key={type} onClick={() => handleSelect(type)}>
            {type}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
