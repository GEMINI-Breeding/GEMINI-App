/**
 * DateCheckDialog — before files of several dates go up as one upload per
 * date, the person sees each date, how many files it has, where the date was
 * read from (names, folders, photos, file dates) and a few of the names, and
 * can correct a date. Nothing is sent until they confirm.
 */
import { CalendarCheck } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { type DateSource, SOURCE_TEXT } from "@/features/files/lib/fileDates"

export interface DateCheckGroup {
  date: string
  source: DateSource
  count: number
  /** A few of the files' names. */
  samples: string[]
  /** What else tells the group apart (a folder, a run), if anything. */
  label?: string
}

export function DateCheckDialog({
  groups,
  onConfirm,
  onCancel,
}: {
  /** null: closed. */
  groups: DateCheckGroup[] | null
  /** The dates to use, in the groups' order. */
  onConfirm: (dates: string[]) => void
  onCancel: () => void
}) {
  const [dates, setDates] = useState<string[]>([])
  useEffect(() => {
    if (groups) setDates(groups.map((g) => g.date))
  }, [groups])
  const unsure = (groups ?? []).some(
    (g) => g.source === "file date" || g.source === "chosen",
  )
  const ok =
    dates.length > 0 && dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
  return (
    <Dialog open={groups !== null} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-2xl" data-testid="date-check-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarCheck className="h-5 w-5" />
            {groups && groups.length > 1
              ? `${groups.length} dates: one upload each`
              : "Check the date"}
          </DialogTitle>
          <DialogDescription>
            Each upload is filed under its collection date. Check that these are
            right, and correct any before uploading.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-96 space-y-2 overflow-auto">
          {(groups ?? []).map((g, i) => (
            <div
              key={`${g.date}-${g.label ?? ""}-${i}`}
              className="rounded-md border p-2"
              data-testid="date-check-row"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="date"
                  className="h-8 w-40"
                  value={dates[i] ?? ""}
                  onChange={(e) =>
                    setDates((d) =>
                      d.map((x, j) => (j === i ? e.target.value : x)),
                    )
                  }
                />
                <span className="text-sm font-medium">
                  {g.count} file{g.count === 1 ? "" : "s"}
                  {g.label ? ` · ${g.label}` : ""}
                </span>
                <span
                  className={`text-xs ${g.source === "file date" || g.source === "chosen" ? "text-amber-600" : "text-muted-foreground"}`}
                >
                  {SOURCE_TEXT[g.source]}
                </span>
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {g.samples.slice(0, 3).join(", ")}
                {g.count > 3 ? ", …" : ""}
              </p>
            </div>
          ))}
        </div>
        {unsure && (
          <p className="text-xs text-amber-600">
            Some dates come from the files' own dates or the form, not from
            their names: check those especially.
          </p>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={!ok}
            onClick={() => onConfirm(dates)}
            data-testid="date-check-confirm"
          >
            {groups && groups.length > 1
              ? `Upload ${groups.length} dates`
              : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
