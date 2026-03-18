export type ProcessType = "file_upload" | "export" | "processing"
export type ProcessStatus = "pending" | "running" | "completed" | "error"
export type ProcessItemStatus =
  | "pending"
  | "running"
  | "completed"
  | "error"
  | "skipped"

export interface ProcessItem {
  id: string
  name: string
  status: ProcessItemStatus
  error?: string
  /** Custom status label override (e.g. "Extracting…") */
  label?: string
}

export interface Process {
  id: string
  type: ProcessType
  status: ProcessStatus
  title: string
  items: ProcessItem[]
  createdAt: Date
  completedAt?: Date
  error?: string
  /** 0–100 progress override (used for compute steps without item-level granularity) */
  progress?: number
  /** Latest status message (e.g. current ODM stage) */
  message?: string
  /** TanStack Router path to navigate to when the user clicks "View" in the panel */
  link?: string
  /** Call to abort an in-progress upload */
  cancel?: () => void
  /** Pipeline run ID — if set, ProcessContext opens its own SSE to track progress */
  runId?: string
}
