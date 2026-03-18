import {
  CheckCircle2,
  Clock,
  Loader2,
  MinusCircle,
  XCircle,
} from "lucide-react"
import type { ProcessItem } from "@/types/process"

const statusConfig = {
  pending: {
    icon: Clock,
    className: "text-muted-foreground",
    label: "Pending",
  },
  running: {
    icon: Loader2,
    className: "text-blue-500 animate-spin",
    label: "Uploading",
  },
  completed: {
    icon: CheckCircle2,
    className: "text-green-500",
    label: "Done",
  },
  error: {
    icon: XCircle,
    className: "text-destructive",
    label: "Error",
  },
  skipped: {
    icon: MinusCircle,
    className: "text-yellow-500",
    label: "Skipped",
  },
} as const

export function ProcessItemRow({ item }: { item: ProcessItem }) {
  const config = statusConfig[item.status]
  const Icon = config.icon

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-sm">
      <Icon className={`h-4 w-4 shrink-0 ${config.className}`} />
      <span className="text-foreground min-w-0 flex-1 truncate">
        {item.name}
      </span>
      <span className="text-muted-foreground shrink-0 text-xs">
        {item.error || item.label || config.label}
      </span>
    </div>
  )
}
