import { useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  autoDetect,
  parseCSV,
  remapAndSerialize,
} from "@/features/process/lib/csv"
import {
  FD_ALIASES,
  FD_TARGET_COLS,
  FD_TRANSFORM_IDENTITY,
  type FdTargetKey,
  type FieldDesign,
  type FieldDesignRow,
} from "@/features/process/lib/fieldDesign"
import useCustomToast from "@/hooks/useCustomToast"

interface Props {
  open: boolean
  onClose: () => void
  onSaved: (fd: FieldDesign) => void
}

/**
 * Two-step dialog for uploading a field-design CSV. Step 1 picks a file and
 * parses it; step 2 lets the user map their CSV columns onto the pipeline's
 * expected fields (row, col, plot, accession). On save, the parent receives
 * a complete `FieldDesign` payload ready to drop onto the geometry snapshot.
 *
 * No network calls happen here — the parent owns persistence (snapshot
 * save). That's intentional: GEMINIbase has no field-design endpoint, and
 * the design rides on PlotGeometryStateSnapshot anyway.
 */
export function FieldDesignUploadDialog({ open, onClose, onSaved }: Props) {
  const [step, setStep] = useState<"upload" | "map">("upload")
  const [headers, setHeaders] = useState<string[]>([])
  const [parsedRows, setParsedRows] = useState<FieldDesignRow[]>([])
  const [mapping, setMapping] = useState<Partial<Record<FdTargetKey, string>>>(
    {},
  )
  const [fileName, setFileName] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const { showErrorToast } = useCustomToast()

  function reset() {
    setStep("upload")
    setHeaders([])
    setParsedRows([])
    setMapping({})
    setFileName(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  function handleClose() {
    reset()
    onClose()
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = (ev.target?.result as string) ?? ""
      try {
        const { headers: h, rows } = parseCSV(text)
        if (!h.length) {
          showErrorToast("No columns found in CSV — file may be empty.")
          return
        }
        setHeaders(h)
        setParsedRows(rows)
        const auto: Partial<Record<FdTargetKey, string>> = {}
        for (const t of FD_TARGET_COLS)
          auto[t.key] = autoDetect(h, FD_ALIASES[t.key])
        setMapping(auto)
        setStep("map")
      } catch (err) {
        showErrorToast(
          err instanceof Error ? err.message : "Failed to parse CSV",
        )
      }
    }
    reader.readAsText(file)
  }

  function handleSave() {
    const fd: FieldDesign = {
      csv_text: remapAndSerialize(parsedRows, mapping),
      mapping,
      rows: parsedRows,
      transform: FD_TRANSFORM_IDENTITY,
    }
    onSaved(fd)
    reset()
  }

  const requiredMapped = FD_TARGET_COLS.filter((t) => t.required).every(
    (t) => mapping[t.key],
  )

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>
            {step === "upload" ? "Upload field design CSV" : "Map columns"}
          </DialogTitle>
          <DialogDescription>
            {step === "upload"
              ? "Upload a CSV mapping plot grid (row, col) coordinates to plot metadata. The design's rows/cols auto-populate the grid; metadata tags each generated polygon."
              : `Match your CSV's columns to the expected pipeline fields. ${parsedRows.length} rows detected.`}
          </DialogDescription>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-3">
            <Label htmlFor="fd-file-button">Select CSV file</Label>
            <div className="flex items-center gap-3">
              <Button
                id="fd-file-button"
                type="button"
                variant="secondary"
                onClick={() => fileInputRef.current?.click()}
              >
                Choose file
              </Button>
              <span
                className="text-muted-foreground text-sm"
                data-testid="fd-file-name"
              >
                {fileName ?? "No file chosen"}
              </span>
              {/* Keep the native input in the DOM so the click() ref + the
                  Playwright `setInputFiles` testid path both still work. */}
              <input
                ref={fileInputRef}
                data-testid="field-design-file"
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
          </div>
        )}

        {step === "map" && (
          <div className="flex min-h-0 flex-1 flex-col space-y-4 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left">
                  <th className="w-2/5 pb-2 font-medium">Pipeline field</th>
                  <th className="pb-2 font-medium">Your column</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {FD_TARGET_COLS.map((t) => (
                  <tr key={t.key}>
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-1.5">
                        <code className="bg-muted rounded px-1 py-0.5 text-xs">
                          {t.key}
                        </code>
                        {t.required && (
                          <span className="text-xs text-red-500">*</span>
                        )}
                      </div>
                      <div className="text-muted-foreground mt-0.5 text-xs">
                        {t.hint}
                      </div>
                    </td>
                    <td className="py-2">
                      <select
                        data-testid={`field-design-map-${t.key}`}
                        className="bg-background w-full rounded border px-2 py-1 text-sm"
                        value={mapping[t.key] ?? ""}
                        onChange={(e) =>
                          setMapping((m) => ({ ...m, [t.key]: e.target.value }))
                        }
                      >
                        {t.required ? (
                          <option value="">— select column —</option>
                        ) : (
                          <option value="">— skip —</option>
                        )}
                        {headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {!requiredMapped && (
              <p className="text-xs text-red-500">row and col are required.</p>
            )}

            <div>
              <p className="text-muted-foreground mb-1 text-xs">
                Preview (first 4 rows after mapping):
              </p>
              <div className="bg-muted/40 overflow-x-auto rounded border">
                <table className="w-full font-mono text-xs">
                  <thead>
                    <tr className="bg-muted border-b">
                      {FD_TARGET_COLS.filter((t) => mapping[t.key]).map((t) => (
                        <th
                          key={t.key}
                          className="px-2 py-1 text-left font-medium"
                        >
                          {t.key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.slice(0, 4).map((row, i) => (
                      <tr key={i} className="border-b last:border-0">
                        {FD_TARGET_COLS.filter((t) => mapping[t.key]).map(
                          (t) => (
                            <td key={t.key} className="px-2 py-1">
                              {row[mapping[t.key]!] ?? ""}
                            </td>
                          ),
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {step === "map" && (
            <Button variant="outline" onClick={() => setStep("upload")}>
              Back
            </Button>
          )}
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          {step === "map" && (
            <Button
              data-testid="field-design-confirm"
              disabled={!requiredMapped}
              onClick={handleSave}
            >
              Use field design
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
