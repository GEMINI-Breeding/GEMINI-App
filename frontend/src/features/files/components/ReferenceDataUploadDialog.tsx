/**
 * ReferenceDataUploadDialog — column mapping step for Reference Data upload.
 *
 * Opens after the user has selected a file in the Upload tab.  Metadata
 * (Name, Experiment, Location, Population, Date) is already filled in the
 * DataStructureForm on the left — this dialog only shows the column-mapping
 * table (same pattern as the Field Design upload in the pipeline flow).
 *
 * On submit, POSTs to POST /api/v1/reference-data/upload and shows a match
 * report toast.
 */

import { useEffect, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { OpenAPI } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import useCustomToast from "@/hooks/useCustomToast"

function apiUrl(path: string): string {
  return OpenAPI.BASE.replace(/\/$/, "") + path
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const IDENTITY_FIELDS = ["plot_id", "col", "row", "accession"] as const
const IGNORE = "__ignore__"

type ColumnMapping = Record<string, string> // original_col → canonical

interface MatchReport {
  total: number
  matched: number
  unmatched: number
}

interface UploadResponse {
  id: string
  name: string
  plot_count: number
  trait_columns: string[]
  match_report: MatchReport | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseCSVHeaders(text: string): string[] {
  const firstLine = text.split(/\r?\n/)[0] ?? ""
  const headers: string[] = []
  let cur = ""
  let inQ = false
  for (let i = 0; i < firstLine.length; i++) {
    const ch = firstLine[i]
    if (ch === '"') {
      if (inQ && firstLine[i + 1] === '"') { cur += '"'; i++ } else inQ = !inQ
    } else if (ch === "," && !inQ) { headers.push(cur.trim()); cur = "" } else cur += ch
  }
  headers.push(cur.trim())
  return headers.filter(Boolean)
}

function autoIdentify(header: string): string {
  const h = header.toLowerCase()
  if (h === "plot_id" || h === "plot" || h === "plotid") return "plot_id"
  if (h === "col" || h === "column" || h === "bed") return "col"
  if (h === "row" || h === "tier") return "row"
  if (h === "accession" || h === "acc" || h === "genotype" || h === "entry") return "accession"
  return header // default: use as trait name
}

// ---------------------------------------------------------------------------
// Dialog (column mapping only — opens after standard UploadList upload)
// ---------------------------------------------------------------------------

interface Props {
  open: boolean
  onClose: () => void
  file: File
  formValues: Record<string, string>
}

export function ReferenceDataUploadDialog({ open, onClose, file, formValues }: Props) {
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const [headers, setHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [isParsing, setIsParsing] = useState(false)

  // Parse headers when file changes
  useEffect(() => {
    if (!file) return
    setIsParsing(true)
    const lower = file.name.toLowerCase()
    if (lower.endsWith(".csv")) {
      file.text().then((text) => {
        const hdrs = parseCSVHeaders(text)
        initMapping(hdrs)
        setIsParsing(false)
      })
    } else {
      // Excel: call backend
      const fd = new FormData()
      fd.append("file", file)
      const token = localStorage.getItem("access_token") || ""
      fetch(apiUrl("/api/v1/reference-data/parse-headers"), {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      })
        .then((r) => r.json())
        .then((data: { headers: string[] }) => {
          initMapping(data.headers)
          setIsParsing(false)
        })
        .catch(() => {
          showErrorToast("Could not read file headers")
          setIsParsing(false)
          onClose()
        })
    }
  }, [file])

  function initMapping(hdrs: string[]) {
    setHeaders(hdrs)
    const auto: ColumnMapping = {}
    for (const h of hdrs) auto[h] = autoIdentify(h)
    setMapping(auto)
  }

  const uploadMutation = useMutation({
    mutationFn: async () => {
      const fd = new FormData()
      fd.append("file", file)
      // Default name to filename (without extension) if not provided
      const defaultName = file.name.replace(/\.[^.]+$/, "")
      const params = new URLSearchParams({
        name: formValues.name?.trim() || defaultName,
        experiment: formValues.experiment ?? "",
        location: formValues.location ?? "",
        population: formValues.population ?? "",
        date: formValues.date ?? "",
        column_mapping_json: JSON.stringify(mapping),
      })
      const token = localStorage.getItem("access_token") || ""
      const res = await fetch(
        apiUrl(`/api/v1/reference-data/upload?${params.toString()}`),
        {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: fd,
        }
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Upload failed" }))
        throw new Error(err.detail ?? "Upload failed")
      }
      return res.json() as Promise<UploadResponse>
    },
    onSuccess: (data) => {
      const report = data.match_report
      const plots = report ? `${report.matched}/${report.total}` : String(data.plot_count)
      showSuccessToast(
        `"${data.name}" uploaded — ${plots} plots. Associate it with a workspace in the Process tab.`
      )
      onClose()
    },
    onError: (err: Error) => showErrorToast(err.message),
  })

  const mappingValues = Object.values(mapping).filter((v) => v !== IGNORE)
  const hasPlotId = mappingValues.includes("plot_id")
  const hasColRow = mappingValues.includes("col") && mappingValues.includes("row")
  const mappingValid = hasPlotId || hasColRow

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl flex flex-col max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Map Columns — {file.name}</DialogTitle>
          <DialogDescription>
            {isParsing
              ? "Reading file headers…"
              : `Match your file's columns to plot identity and trait fields. ${headers.length} columns detected.`}
          </DialogDescription>
        </DialogHeader>

        {isParsing ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Reading file…</div>
        ) : (
          <div className="space-y-4 overflow-y-auto min-h-0 flex-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left">
                  <th className="w-2/5 pb-2 font-medium">File column</th>
                  <th className="pb-2 font-medium">Maps to</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {headers.map((h) => (
                  <tr key={h}>
                    <td className="py-2 pr-4">
                      <code className="bg-muted rounded px-1 py-0.5 text-xs">{h}</code>
                    </td>
                    <td className="py-2">
                      <div className="flex gap-2">
                        <select
                          className="bg-background flex-1 rounded border px-2 py-1 text-sm"
                          value={
                            IDENTITY_FIELDS.includes(mapping[h] as typeof IDENTITY_FIELDS[number])
                              ? mapping[h]
                              : mapping[h] === IGNORE
                                ? IGNORE
                                : "__trait__"
                          }
                          onChange={(e) => {
                            const v = e.target.value
                            setMapping((m) => ({ ...m, [h]: v === "__trait__" ? h : v }))
                          }}
                        >
                          <option value="plot_id">plot_id — plot identifier</option>
                          <option value="col">col — column / bed number</option>
                          <option value="row">row — row / tier number</option>
                          <option value="accession">accession — genotype / entry</option>
                          <option value="__trait__">trait — numeric measurement</option>
                          <option value={IGNORE}>— ignore —</option>
                        </select>
                        {/* Trait name input */}
                        {mapping[h] !== IGNORE &&
                          !IDENTITY_FIELDS.includes(mapping[h] as typeof IDENTITY_FIELDS[number]) && (
                            <Input
                              className="w-36 text-sm h-8"
                              value={mapping[h]}
                              placeholder="trait name"
                              onChange={(e) =>
                                setMapping((m) => ({ ...m, [h]: e.target.value }))
                              }
                            />
                          )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {!mappingValid && headers.length > 0 && (
              <p className="text-destructive text-xs">
                Map at least <code>plot_id</code>, or both <code>col</code> and <code>row</code>.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!mappingValid || uploadMutation.isPending || isParsing}
            onClick={() => uploadMutation.mutate()}
          >
            {uploadMutation.isPending ? "Uploading…" : "Upload Reference Data"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
