import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Aggregation } from "../lib/multivariate"

interface Props {
  value: Aggregation | null
  onChange: (value: Aggregation) => void
  date: string | null
  onDateChange: (date: string | null) => void
}

const LABELS: Record<Aggregation, string> = {
  mean: "Mean across timestamps",
  latest: "Latest timestamp",
  max: "Maximum value",
  min: "Minimum value",
  first: "First timestamp",
  date: "Specific collection date…",
}

export function AggregationControl({
  value,
  onChange,
  date,
  onDateChange,
}: Props) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <label
          htmlFor="mv-aggregation"
          className="text-xs text-muted-foreground"
        >
          Per-plot aggregation
        </label>
        <Select
          value={value ?? undefined}
          onValueChange={(v) => onChange(v as Aggregation)}
        >
          <SelectTrigger
            id="mv-aggregation"
            className="w-64"
            data-testid="mv-aggregation"
          >
            <SelectValue placeholder="Pick how to combine multiple measurements" />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(LABELS) as Aggregation[]).map((k) => (
              <SelectItem key={k} value={k}>
                {LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {value === "date" && (
        <div className="space-y-1">
          <label
            htmlFor="mv-aggregation-date"
            className="text-xs text-muted-foreground"
          >
            Collection date
          </label>
          <input
            id="mv-aggregation-date"
            type="date"
            data-testid="mv-aggregation-date"
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={date ?? ""}
            onChange={(e) => onDateChange(e.target.value || null)}
          />
        </div>
      )}
    </div>
  )
}
