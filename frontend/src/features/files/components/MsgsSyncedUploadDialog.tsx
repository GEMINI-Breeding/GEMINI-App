import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
  const base = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "")
  return base + path
}

// ── Expected pipeline columns ─────────────────────────────────────────────────

const TARGET_COLS = [
  {
    key: "image_path",
    required: true,
    hint: "Image filename or full path (e.g. DJI_0001.jpg)",
  },
  {
    key: "timestamp",
    required: true,
    hint: "Unix epoch seconds (float) — used to match platform log GPS",
  },
  {
    key: "lat",
    required: true,
    hint: "Latitude in decimal degrees",
  },
  {
    key: "lon",
    required: true,
    hint: "Longitude in decimal degrees",
  },
  {
    key: "alt",
    required: false,
    hint: "Altitude in metres (optional)",
  },
  {
    key: "time",
    required: false,
    hint: "Human-readable timestamp string (optional, not used by pipeline)",
  },
] as const

type TargetKey = (typeof TARGET_COLS)[number]["key"]

// ── CSV helpers (same tiny parser as PlotBoundaryPrep) ────────────────────────

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(Boolean)
  if (!lines.length) return { headers: [], rows: [] }

  function parseLine(line: string): string[] {
    const fields: string[] = []
    let cur = ""
    let inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++ } else inQ = !inQ
      } else if (ch === "," && !inQ) { fields.push(cur); cur = "" } else cur += ch
    }
    fields.push(cur)
    return fields
  }

  const headers = parseLine(lines[0]).map((h) => h.trim())
  const rows = lines.slice(1).map((line) => {
    const vals = parseLine(line)
    return Object.fromEntries(headers.map((h, i) => [h, (vals[i] ?? "").trim()]))
  })
  return { headers, rows }
}

function remapAndSerialize(
  rows: Record<string, string>[],
  mapping: Partial<Record<TargetKey, string>>,
): string {
  if (!rows.length) return ""
  const usedSources = new Set(Object.values(mapping).filter(Boolean) as string[])
  const passthroughCols = Object.keys(rows[0]).filter((c) => !usedSources.has(c))
  const newHeaders: string[] = [
    ...Object.entries(mapping).filter(([, src]) => src).map(([tgt]) => tgt),
    ...passthroughCols,
  ]
  const lines = [newHeaders.join(",")]
  for (const row of rows) {
    const vals = newHeaders.map((h) => {
      const src = (mapping as Record<string, string>)[h] ?? h
      const v = row[src] ?? ""
      return v.includes(",") || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v
    })
    lines.push(vals.join(","))
  }
  return lines.join("\n")
}

const ALIASES: Record<TargetKey, string[]> = {
  image_path: ["image_path", "image", "filename", "file", "name", "path"],
  timestamp: ["timestamp", "unix_time", "unix_ts", "epoch", "posix", "ts"],
  lat: ["lat", "latitude"],
  lon: ["lon", "long", "longitude"],
  alt: ["alt", "altitude", "height", "elevation"],
  time: ["time", "datetime", "date_time", "date"],
}

function autoDetect(headers: string[], key: TargetKey): string {
  const lower = headers.map((h) => h.toLowerCase())
  for (const alias of ALIASES[key]) {
    const idx = lower.findIndex((h) => h === alias || h.startsWith(alias))
    if (idx !== -1) return headers[idx]
  }
  return ""
}

// ── Dialog ────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  onClose: () => void
  onSaved: (rowCount: number) => void
  formValues: Record<string, string>
}

export function MsgsSyncedUploadDialog({ open, onClose, onSaved, formValues }: Props) {
  const [step, setStep] = useState<"upload" | "map">("upload")
  const [headers, setHeaders] = useState<string[]>([])
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([])
  const [mapping, setMapping] = useState<Partial<Record<TargetKey, string>>>({})
  const { showErrorToast } = useCustomToast()

  function handleClose() {
    setStep("upload")
    setHeaders([])
    setParsedRows([])
    setMapping({})
    onClose()
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const { headers: h, rows } = parseCSV(text)
      setHeaders(h)
      setParsedRows(rows)
      const auto: Partial<Record<TargetKey, string>> = {}
      for (const t of TARGET_COLS) auto[t.key] = autoDetect(h, t.key)
      setMapping(auto)
      setStep("map")
    }
    reader.readAsText(file)
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const csvText = remapAndSerialize(parsedRows, mapping)
      return fetch(apiUrl("/api/v1/files/msgs-synced"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
        },
        body: JSON.stringify({
          csv_text: csvText,
          experiment: formValues.experiment ?? "",
          location: formValues.location ?? "",
          population: formValues.population ?? "",
          date: formValues.date ?? "",
          platform: formValues.platform ?? "",
        }),
      }).then(async (r) => {
        if (!r.ok) throw new Error(await r.text())
        return r.json() as Promise<{ row_count: number }>
      })
    },
    onSuccess: (data) => {
      onSaved(data.row_count)
      handleClose()
    },
    onError: () => showErrorToast("Failed to save msgs_synced.csv"),
  })

  const requiredMapped = TARGET_COLS.filter((t) => t.required).every((t) => mapping[t.key])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {step === "upload" ? "Upload msgs_synced.csv" : "Map Columns"}
          </DialogTitle>
          <DialogDescription>
            {step === "upload"
              ? "Upload a pre-synced image GPS manifest. It will be saved to Raw/.../Metadata/ and used instead of EXIF extraction during Data Sync."
              : `Match your file's columns to the expected pipeline fields. ${parsedRows.length} rows detected.`}
          </DialogDescription>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-3">
            <Label>Select CSV file</Label>
            <Input type="file" accept=".csv" className="mt-1" onChange={handleFileChange} />
          </div>
        )}

        {step === "map" && (
          <div className="space-y-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left">
                  <th className="w-2/5 pb-2 font-medium">Pipeline field</th>
                  <th className="pb-2 font-medium">Your column</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {TARGET_COLS.map((t) => (
                  <tr key={t.key}>
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-1.5">
                        <code className="bg-muted rounded px-1 py-0.5 text-xs">{t.key}</code>
                        {t.required && <span className="text-xs text-red-500">*</span>}
                      </div>
                      <div className="text-muted-foreground mt-0.5 text-xs">{t.hint}</div>
                    </td>
                    <td className="py-2">
                      <select
                        className="bg-background w-full rounded border px-2 py-1 text-sm"
                        value={mapping[t.key] ?? ""}
                        onChange={(e) => setMapping((m) => ({ ...m, [t.key]: e.target.value }))}
                      >
                        {t.required
                          ? <option value="">— select column —</option>
                          : <option value="">— skip —</option>}
                        {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {!requiredMapped && (
              <p className="text-xs text-red-500">
                image_path, timestamp, lat, and lon are required.
              </p>
            )}

            <div>
              <p className="text-muted-foreground mb-1 text-xs">
                Preview (first 4 rows after mapping):
              </p>
              <div className="bg-muted/40 overflow-x-auto rounded border">
                <table className="w-full font-mono text-xs">
                  <thead>
                    <tr className="bg-muted border-b">
                      {TARGET_COLS.filter((t) => mapping[t.key]).map((t) => (
                        <th key={t.key} className="px-2 py-1 text-left font-medium">{t.key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.slice(0, 4).map((row, i) => (
                      <tr key={i} className="border-b last:border-0">
                        {TARGET_COLS.filter((t) => mapping[t.key]).map((t) => (
                          <td key={t.key} className="px-2 py-1">{row[mapping[t.key]!] ?? ""}</td>
                        ))}
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
            <Button variant="outline" onClick={() => setStep("upload")}>Back</Button>
          )}
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          {step === "map" && (
            <Button
              disabled={!requiredMapped || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? "Saving…" : "Save msgs_synced.csv"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
