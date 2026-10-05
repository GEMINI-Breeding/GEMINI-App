/**
 * ReferenceDataUploadDialog — column mapping + upload for the Reference
 * Data flow, against `/api/reference_data/parse-headers` and
 * `/api/reference_data/upload` (`ReferenceDataService`).
 *
 * Opens after the user selects a reference CSV/Excel file in the Upload
 * tab. Metadata (Name, Experiment, Location, Population, Date) is already
 * filled in the DataStructureForm on the left — this dialog picks the
 * sheets and header row, maps columns, and reports what the upload matched.
 *
 * Headers always come from the server (CSV included), so the column names
 * the mapping is keyed by are exactly the ones `/upload` parses: trimmed,
 * de-duplicated (`Height`, `Height.1`), with the delimiter and BOM handled.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"

import { ReferenceDataService, type ReferenceDatasetOutput } from "@/client"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import useCustomToast from "@/hooks/useCustomToast"
import { extractApiErrorMessage } from "@/lib/apiError"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const IDENTITY_FIELDS = ["plot_id", "col", "row", "accession"] as const
type IdentityField = (typeof IDENTITY_FIELDS)[number]
type Role = IdentityField | "trait" | "ignore"

/** What one file column becomes. `name` is the trait name for "trait". */
interface ColumnRole {
  role: Role
  name: string
}

type ColumnMapping = Record<string, ColumnRole>

interface ParsedFile {
  headers: string[]
  sheets: string[]
  preview: (string | null)[][]
  numericColumns: string[]
  rowCount: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Header names field sheets use for each identity field, compared with
 *  case, spaces and punctuation removed (`Field.plot.number` → `fieldplotnumber`). */
const IDENTITY_ALIASES: Record<IdentityField, string[]> = {
  plot_id: [
    "plotid",
    "plot",
    "plotno",
    "plotnum",
    "plotnumber",
    "fieldplot",
    "fieldplotnumber",
    "fieldplotno",
  ],
  col: ["col", "column", "bed", "range", "plotcol", "plotcolumn"],
  row: ["row", "tier", "plotrow", "plotrownumber"],
  accession: [
    "accession",
    "acc",
    "genotype",
    "entry",
    "lineid",
    "line",
    "linename",
    "variety",
    "cultivar",
    "germplasm",
  ],
}

const compact = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "")

export function autoIdentify(header: string): IdentityField | null {
  const h = compact(header)
  for (const field of IDENTITY_FIELDS) {
    if (IDENTITY_ALIASES[field].includes(h)) return field
  }
  return null
}

/** Initial mapping: identity columns by name (first match wins), numeric
 *  columns as traits, everything else (notes, codes) ignored. A previous
 *  mapping for the same header is kept, so changing sheets or the header
 *  row doesn't throw away the user's choices. */
export function initialMapping(
  headers: string[],
  numericColumns: string[],
  previous: ColumnMapping = {},
): ColumnMapping {
  const taken = new Set<IdentityField>()
  const mapping: ColumnMapping = {}
  for (const h of headers) {
    if (previous[h]) {
      mapping[h] = previous[h]
      if (previous[h].role !== "trait" && previous[h].role !== "ignore")
        taken.add(previous[h].role as IdentityField)
    }
  }
  for (const h of headers) {
    if (mapping[h]) continue
    const id = autoIdentify(h)
    if (id && !taken.has(id)) {
      taken.add(id)
      mapping[h] = { role: id, name: h }
    } else if (numericColumns.includes(h) && !id) {
      mapping[h] = { role: "trait", name: h }
    } else {
      mapping[h] = { role: "ignore", name: h }
    }
  }
  return mapping
}

/** The server's mapping JSON: identity columns and named traits only —
 *  ignored columns are left out, not sent as a sentinel. */
export function toServerMapping(
  mapping: ColumnMapping,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [h, c] of Object.entries(mapping)) {
    if (c.role === "ignore") continue
    if (c.role === "trait") {
      if (c.name.trim()) out[h] = c.name.trim()
    } else out[h] = c.role
  }
  return out
}

function duplicateTraitNames(mapping: ColumnMapping): string[] {
  const seen = new Map<string, number>()
  for (const c of Object.values(mapping)) {
    if (c.role !== "trait" || !c.name.trim()) continue
    const k = c.name.trim()
    seen.set(k, (seen.get(k) ?? 0) + 1)
  }
  return [...seen].filter(([, n]) => n > 1).map(([k]) => k)
}

// ---------------------------------------------------------------------------
// Dialog (column mapping only — opens after standard UploadList upload)
// ---------------------------------------------------------------------------

interface Props {
  open: boolean
  onClose: () => void
  file: File
  formValues: Record<string, string>
  /** MinIO object the Files page staged the original at. */
  originalObject?: string | null
}

export function ReferenceDataUploadDialog({
  open,
  onClose,
  file,
  formValues,
  originalObject,
}: Props) {
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const queryClient = useQueryClient()

  const [parsed, setParsed] = useState<ParsedFile | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [isParsing, setIsParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  // null = server default (first sheet) until the workbook's sheets are known.
  const [selectedSheets, setSelectedSheets] = useState<string[] | null>(null)
  const [headerRow, setHeaderRow] = useState(1) // 1-based, as shown in Excel
  const [result, setResult] = useState<ReferenceDatasetOutput | null>(null)

  const mappingRef = useRef(mapping)
  mappingRef.current = mapping

  const sheetsParam =
    selectedSheets && selectedSheets.length > 0
      ? JSON.stringify(selectedSheets)
      : undefined

  // Parse when the file, the sheet selection or the header row changes.
  useEffect(() => {
    if (!file) return
    let cancelled = false
    setIsParsing(true)
    setParseError(null)
    ReferenceDataService.apiReferenceDataParseHeadersParseHeaders({
      formData: { file },
      sheets: sheetsParam,
      headerRow: headerRow - 1,
    })
      .then((data) => {
        if (cancelled) return
        const next: ParsedFile = {
          headers: data?.headers ?? [],
          sheets: data?.sheets ?? [],
          preview: data?.preview ?? [],
          numericColumns: data?.numeric_columns ?? [],
          rowCount: data?.row_count ?? 0,
        }
        setParsed(next)
        setMapping(
          initialMapping(next.headers, next.numericColumns, mappingRef.current),
        )
        // A workbook with several sheets: default to all of them, so no
        // sheet is dropped without the user seeing it. They can untick.
        setSelectedSheets((cur) =>
          cur === null && next.sheets.length > 1 ? next.sheets : cur,
        )
        setIsParsing(false)
      })
      .catch((err) => {
        if (cancelled) return
        setParseError(extractApiErrorMessage(err))
        setIsParsing(false)
      })
    return () => {
      cancelled = true
    }
  }, [file, sheetsParam, headerRow])

  const uploadMutation = useMutation({
    mutationFn: async () => {
      const defaultName = file.name.replace(/\.[^.]+$/, "")
      return (await ReferenceDataService.apiReferenceDataUploadUpload({
        name: formValues.name?.trim() || defaultName,
        experiment: formValues.experiment || undefined,
        location: formValues.location || undefined,
        population: formValues.population || undefined,
        date: formValues.date || undefined,
        columnMappingJson: JSON.stringify(toServerMapping(mapping)),
        originalObject: originalObject ?? undefined,
        sheets: sheetsParam,
        headerRow: headerRow - 1,
        formData: { file },
      })) as ReferenceDatasetOutput
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["reference-data"] })
      const report = data.match_report
      const summary = report
        ? `${report.matched} of ${report.total} rows matched plots`
        : `${data.plot_count ?? 0} rows`
      showSuccessToast(`"${data.name ?? "dataset"}" uploaded — ${summary}.`)
      const needsReview =
        (data.warnings?.length ?? 0) > 0 || (report?.unmatched ?? 0) > 0
      if (needsReview) setResult(data)
      else onClose()
    },
    onError: (err: unknown) => showErrorToast(extractApiErrorMessage(err)),
  })

  const roles = Object.values(mapping).map((c) => c.role)
  const hasPlotId = roles.includes("plot_id")
  const hasColRow = roles.includes("col") && roles.includes("row")
  const dupes = duplicateTraitNames(mapping)
  const traitCount = Object.values(mapping).filter(
    (c) => c.role === "trait" && c.name.trim(),
  ).length
  const sheetsChosen =
    !parsed?.sheets.length || (selectedSheets?.length ?? 1) > 0
  const mappingValid =
    (hasPlotId || hasColRow) &&
    dupes.length === 0 &&
    traitCount > 0 &&
    sheetsChosen

  const setRole = (h: string, role: Role) =>
    setMapping((m) => {
      const next = { ...m, [h]: { role, name: m[h]?.name || h } }
      // One column per identity field: moving plot_id here frees the old one.
      if (role !== "trait" && role !== "ignore") {
        for (const [k, c] of Object.entries(next)) {
          if (k !== h && c.role === role) next[k] = { ...c, role: "ignore" }
        }
      }
      return next
    })

  const headers = parsed?.headers ?? []
  const previewHeaders = useMemo(() => headers.slice(0, 8), [headers])

  if (result) return <UploadResult result={result} onClose={onClose} />

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl flex flex-col max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Map Columns — {file.name}</DialogTitle>
          <DialogDescription>
            {isParsing
              ? "Reading file…"
              : `Match your file's columns to plot identity and trait fields. ${headers.length} columns, ${parsed?.rowCount ?? 0} rows detected.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto min-h-0 flex-1">
          {parsed && parsed.sheets.length > 1 && (
            <div className="space-y-1.5" data-testid="ref-sheet-picker">
              <Label className="text-xs">
                Sheets to import ({parsed.sheets.length} in this workbook)
              </Label>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {parsed.sheets.map((s, i) => (
                  <label
                    key={s}
                    htmlFor={`ref-sheet-cb-${i}`}
                    className="flex cursor-pointer items-center gap-1.5 text-sm"
                  >
                    <Checkbox
                      id={`ref-sheet-cb-${i}`}
                      checked={selectedSheets?.includes(s) ?? false}
                      onCheckedChange={(c) =>
                        setSelectedSheets((cur) => {
                          const set = new Set(cur ?? [])
                          if (c) set.add(s)
                          else set.delete(s)
                          return parsed.sheets.filter((x) => set.has(x))
                        })
                      }
                      data-testid={`ref-sheet-${s}`}
                    />
                    {s}
                  </label>
                ))}
              </div>
              {!sheetsChosen && (
                <p className="text-destructive text-xs">
                  Pick at least one sheet.
                </p>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Label htmlFor="ref-header-row" className="text-xs">
              Column names are on row
            </Label>
            <Input
              id="ref-header-row"
              type="number"
              min={1}
              className="h-8 w-20 text-sm"
              value={headerRow}
              onChange={(e) =>
                setHeaderRow(Math.max(1, Number(e.target.value) || 1))
              }
              data-testid="ref-header-row"
            />
            <span className="text-muted-foreground text-xs">
              Raise this if the file has a title above the header.
            </span>
          </div>

          {parseError ? (
            <p
              className="text-destructive text-sm"
              data-testid="ref-parse-error"
            >
              Could not read the file: {parseError}
            </p>
          ) : isParsing && !parsed ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Reading file…
            </div>
          ) : (
            <>
              {parsed && parsed.preview.length > 0 && (
                <div className="overflow-x-auto rounded border">
                  <table className="w-full text-xs" data-testid="ref-preview">
                    <thead className="bg-muted">
                      <tr>
                        {previewHeaders.map((h, i) => (
                          <th
                            key={i}
                            className="px-2 py-1 text-left font-medium"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.preview.map((row, r) => (
                        <tr key={r} className="border-t">
                          {previewHeaders.map((_, i) => (
                            <td
                              key={i}
                              className="px-2 py-1 text-muted-foreground"
                            >
                              {row[i] ?? ""}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left">
                    <th className="w-2/5 pb-2 font-medium">File column</th>
                    <th className="pb-2 font-medium">Maps to</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {headers.map((h, i) => {
                    const c = mapping[h] ?? { role: "ignore", name: h }
                    return (
                      <tr key={i} data-testid={`ref-map-row-${h}`}>
                        <td className="py-2 pr-4">
                          <code className="bg-muted rounded px-1 py-0.5 text-xs">
                            {h}
                          </code>
                        </td>
                        <td className="py-2">
                          <div className="flex gap-2">
                            <select
                              className="bg-background flex-1 rounded border px-2 py-1 text-sm"
                              value={c.role}
                              onChange={(e) =>
                                setRole(h, e.target.value as Role)
                              }
                            >
                              <option value="plot_id">
                                plot_id — plot identifier
                              </option>
                              <option value="col">
                                col — column / bed number
                              </option>
                              <option value="row">
                                row — row / tier number
                              </option>
                              <option value="accession">
                                accession — genotype / entry
                              </option>
                              <option value="trait">
                                trait — numeric measurement
                              </option>
                              <option value="ignore">— ignore —</option>
                            </select>
                            {c.role === "trait" && (
                              <Input
                                className="w-36 text-sm h-8"
                                value={c.name}
                                placeholder="trait name"
                                onChange={(e) =>
                                  setMapping((m) => ({
                                    ...m,
                                    [h]: {
                                      role: "trait",
                                      name: e.target.value,
                                    },
                                  }))
                                }
                              />
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {headers.length > 0 && !(hasPlotId || hasColRow) && (
                <p className="text-destructive text-xs">
                  Map at least <code>plot_id</code>, or both <code>col</code>{" "}
                  and <code>row</code>.
                </p>
              )}
              {headers.length > 0 && traitCount === 0 && (
                <p className="text-destructive text-xs">
                  Map at least one column as a trait.
                </p>
              )}
              {dupes.length > 0 && (
                <p className="text-destructive text-xs">
                  Two columns use the same trait name: {dupes.join(", ")}.
                  Rename one of them.
                </p>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              !mappingValid ||
              uploadMutation.isPending ||
              isParsing ||
              Boolean(parseError)
            }
            onClick={() => uploadMutation.mutate()}
          >
            {uploadMutation.isPending ? "Uploading…" : "Upload Reference Data"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Shown after an upload that skipped rows, dropped values or has rows
 *  that match no plot in the trial — things a toast would hide. */
function UploadResult({
  result,
  onClose,
}: {
  result: ReferenceDatasetOutput
  onClose: () => void
}) {
  const report = result.match_report
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="ref-upload-result">
        <DialogHeader>
          <DialogTitle>Uploaded “{result.name}” — please review</DialogTitle>
          <DialogDescription>
            {result.plot_count ?? 0} rows stored
            {result.skipped_empty_rows
              ? `; ${result.skipped_empty_rows} row(s) with no values (blank lines, notes) skipped`
              : ""}
            .
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {report && (
            <div data-testid="ref-upload-match">
              <p>
                <strong>
                  {report.matched} of {report.total}
                </strong>{" "}
                rows matched a plot in {result.experiment} / {result.location}.
              </p>
              {report.unmatched > 0 && (
                <p className="text-amber-700 dark:text-amber-400">
                  {report.unmatched} row(s) match no plot and won't appear in
                  Analyze. Examples:{" "}
                  {(report.unmatched_examples ?? []).join(", ")}
                </p>
              )}
            </div>
          )}
          {(result.warnings ?? []).map((w, i) => (
            <p
              key={i}
              className="text-amber-700 dark:text-amber-400"
              data-testid="ref-upload-warning"
            >
              {w}
            </p>
          ))}
        </div>
        <DialogFooter>
          <Button onClick={onClose} data-testid="ref-upload-done">
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
