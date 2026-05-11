/**
 * Phase 9e step 2 (or step 1 if metadata was seeded by the Files page):
 * for each sheet, pick the role of every column — plot identifier, trait
 * columns, germplasm columns, season / site / date / timestamp / extra
 * metadata. Validation rules live in
 * `features/import/lib/columnMapping.ts` so they're testable in isolation.
 *
 * Ported from `backend/gemini-ui/src/components/import-wizard/step-column-
 * mapping.tsx`. Adapted to:
 *   - our Radix-based <Select> (uses `value` + `onValueChange` instead of
 *     a native <select>)
 *   - `parseSpreadsheet` from `features/import/lib/spreadsheet.ts`
 *   - `useScopeOptions` for the existing-population dropdown
 *
 * The "+ Create new… population" inline form uses the same `EntitySelectField`
 * pattern as StepMetadata.
 */
import { ChevronLeft, ChevronRight, Loader2, Plus, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useScopeOptions } from "@/features/files/hooks/useUploadScope"
import {
  emptySheetConfig,
  isPristine,
  isSheetConfigValid,
  NOT_MAPPED,
  reservedColumnSet,
  seedSheetConfig,
} from "@/features/import/lib/columnMapping"
import {
  detectSkipRows,
  parseSpreadsheet,
} from "@/features/import/lib/spreadsheet"
import type {
  ColumnMapping,
  FileWithPath,
  MetadataColumn,
  ParsedSheet,
  SheetMapping,
  TraitColumn,
} from "@/features/import/lib/types"

interface StepColumnMappingProps {
  files: FileWithPath[]
  /** Restore prior mapping when the user navigates back to this step. */
  initial: ColumnMapping | null
  onNext: (mapping: ColumnMapping) => void
  onBack: () => void
}

const POPULATION_NEW = "__create_new__"
const POPULATION_NONE = "__none__"

export function StepColumnMapping({
  files,
  initial,
  onNext,
  onBack,
}: StepColumnMappingProps) {
  const [sheets, setSheets] = useState<ParsedSheet[]>(
    () => initial?.sheets ?? [],
  )
  const [loading, setLoading] = useState(() => !initial)
  const [parseError, setParseError] = useState<string | null>(null)
  const [sheetIdx, setSheetIdx] = useState(0)
  const [configs, setConfigs] = useState<SheetMapping[]>(
    () => initial?.sheetConfigs ?? [],
  )
  // "Header lines to skip" — N lines before the row treated as the header.
  // Auto-detected on first parse via findHeaderRowIndex (the same banner-
  // row heuristic the XLSX path always used). The user can override.
  const [skipRows, setSkipRows] = useState<number>(0)
  // Hold the file the user dropped so we can re-parse it when skipRows
  // changes without forcing the parent to re-pass files prop.
  const tabularFileRef = useRef<File | null>(null)
  // Tracks the most recently applied skipRows so the re-parse effect
  // doesn't fire on the value the initial parse already used.
  const appliedSkipRowsRef = useRef<number>(0)
  const [pendingMetadataSelect, setPendingMetadataSelect] =
    useState<string>(NOT_MAPPED)

  const scopeOptions = useScopeOptions()
  const existingPopulations = useMemo(
    () => scopeOptions.population.options.map((o) => o.name),
    [scopeOptions.population.options],
  )

  useEffect(() => {
    if (initial) return
    let cancelled = false
    async function parse() {
      setLoading(true)
      setParseError(null)
      try {
        const tabularFile = files.find((f) => {
          const ext = f.name.split(".").pop()?.toLowerCase() ?? ""
          return ["csv", "tsv", "txt", "xlsx", "xls", "ods"].includes(ext)
        })
        if (!tabularFile) {
          if (!cancelled) {
            setParseError("No tabular file found in uploaded files.")
            setLoading(false)
          }
          return
        }
        // Auto-detect banner rows first so the "Header lines to skip"
        // input opens pre-filled with a sensible guess — then parse with
        // that explicit value. This keeps the initial preview identical
        // to a manual override of the same number.
        const detected = await detectSkipRows(tabularFile)
        if (cancelled) return
        const parsed = await parseSpreadsheet(tabularFile, {
          skipRows: detected,
        })
        if (cancelled) return
        if (parsed.length === 0) {
          setParseError("The file contains no data.")
          setLoading(false)
          return
        }
        tabularFileRef.current = tabularFile
        appliedSkipRowsRef.current = detected
        setSkipRows(detected)
        setSheets(parsed)
        setSheetIdx(0)
        setConfigs(parsed.map((s) => emptySheetConfig(s)))
      } catch (err) {
        if (!cancelled) {
          setParseError(
            err instanceof Error ? err.message : "Failed to parse file.",
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    parse()
    return () => {
      cancelled = true
    }
  }, [files, initial])

  // Re-parse the file when the user changes the "Header lines to skip"
  // input. Resets every sheet's config because the headers (and thus the
  // user's column picks) may have shifted.
  useEffect(() => {
    if (initial) return
    if (skipRows === appliedSkipRowsRef.current) return
    const file = tabularFileRef.current
    if (!file) return
    let cancelled = false
    async function reparse() {
      setLoading(true)
      setParseError(null)
      try {
        const parsed = await parseSpreadsheet(file!, { skipRows })
        if (cancelled) return
        if (parsed.length === 0) {
          setParseError("The file contains no data.")
          setLoading(false)
          return
        }
        appliedSkipRowsRef.current = skipRows
        setSheets(parsed)
        setSheetIdx(0)
        setConfigs(parsed.map((s) => emptySheetConfig(s)))
      } catch (err) {
        if (!cancelled) {
          setParseError(
            err instanceof Error ? err.message : "Failed to re-parse file.",
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    reparse()
    return () => {
      cancelled = true
    }
  }, [skipRows, initial])

  const currentSheet = sheets[sheetIdx] ?? null
  const currentConfig: SheetMapping | null = configs[sheetIdx] ?? null
  const headers = useMemo(() => currentSheet?.headers ?? [], [currentSheet])

  const reservedColumns = useMemo(
    () =>
      currentConfig ? reservedColumnSet(currentConfig) : new Set<string>(),
    [currentConfig],
  )

  const availableForMetadata = useMemo(() => {
    if (!currentConfig) return [] as string[]
    const enabledTraitHeaders = new Set(
      currentConfig.traitColumns
        .filter((tc) => tc.enabled)
        .map((tc) => tc.columnHeader),
    )
    return headers.filter(
      (h) => !reservedColumns.has(h) && !enabledTraitHeaders.has(h),
    )
  }, [currentConfig, headers, reservedColumns])

  const updateCurrentConfig = (updates: Partial<SheetMapping>) => {
    setConfigs((prev) => {
      if (!prev[sheetIdx]) return prev
      const next = [...prev]
      next[sheetIdx] = { ...next[sheetIdx], ...updates }
      return next
    })
  }

  const toggleTraitColumn = (header: string, enabled: boolean) => {
    setConfigs((prev) => {
      const config = prev[sheetIdx]
      if (!config) return prev
      const existing = config.traitColumns.find(
        (tc) => tc.columnHeader === header,
      )
      const traitColumns: TraitColumn[] = existing
        ? config.traitColumns.map((tc) =>
            tc.columnHeader === header ? { ...tc, enabled } : tc,
          )
        : [
            ...config.traitColumns,
            { columnHeader: header, traitName: header, units: "", enabled },
          ]
      const next = [...prev]
      next[sheetIdx] = { ...config, traitColumns }
      return next
    })
  }

  const updateTraitField = (
    header: string,
    field: "traitName" | "units",
    value: string,
  ) => {
    setConfigs((prev) => {
      const config = prev[sheetIdx]
      if (!config) return prev
      const next = [...prev]
      next[sheetIdx] = {
        ...config,
        traitColumns: config.traitColumns.map((tc) =>
          tc.columnHeader === header ? { ...tc, [field]: value } : tc,
        ),
      }
      return next
    })
  }

  const addMetadataColumn = (header: string) => {
    if (header === NOT_MAPPED) return
    setConfigs((prev) => {
      const config = prev[sheetIdx]
      if (!config) return prev
      if (config.metadataColumns.some((mc) => mc.columnHeader === header)) {
        return prev
      }
      const entry: MetadataColumn = { columnHeader: header, label: header }
      const next = [...prev]
      next[sheetIdx] = {
        ...config,
        metadataColumns: [...config.metadataColumns, entry],
      }
      return next
    })
    setPendingMetadataSelect(NOT_MAPPED)
  }

  const removeMetadataColumn = (header: string) => {
    setConfigs((prev) => {
      const config = prev[sheetIdx]
      if (!config) return prev
      const next = [...prev]
      next[sheetIdx] = {
        ...config,
        metadataColumns: config.metadataColumns.filter(
          (mc) => mc.columnHeader !== header,
        ),
      }
      return next
    })
  }

  const updateMetadataLabel = (header: string, label: string) => {
    setConfigs((prev) => {
      const config = prev[sheetIdx]
      if (!config) return prev
      const next = [...prev]
      next[sheetIdx] = {
        ...config,
        metadataColumns: config.metadataColumns.map((mc) =>
          mc.columnHeader === header ? { ...mc, label } : mc,
        ),
      }
      return next
    })
  }

  const goToSheet = (nextIdx: number) => {
    if (nextIdx < 0 || nextIdx >= sheets.length) return
    setConfigs((prev) => {
      const existing = prev[nextIdx]
      if (existing && !isPristine(existing)) return prev
      const next = [...prev]
      const prevConfig = prev[sheetIdx] ?? null
      next[nextIdx] = seedSheetConfig(prevConfig, sheets[nextIdx])
      return next
    })
    setSheetIdx(nextIdx)
    setPendingMetadataSelect(NOT_MAPPED)
  }

  const allSheetsValid =
    configs.length === sheets.length && configs.every(isSheetConfigValid)
  const currentValid = currentConfig ? isSheetConfigValid(currentConfig) : false
  const hasAnyUnskipped = configs.length > 0 && configs.some((c) => !c.skipped)
  const canContinue = allSheetsValid && hasAnyUnskipped && !loading

  const handleContinue = () => {
    if (!canContinue) return
    onNext({ recordType: "trait", sheets, sheetConfigs: configs })
  }

  if (loading) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-3 py-12"
        data-testid="mapping-loading"
      >
        <Loader2 className="text-primary h-8 w-8 animate-spin" />
        <p className="text-muted-foreground text-sm">Parsing spreadsheet…</p>
      </div>
    )
  }

  if (parseError) {
    return (
      <div className="space-y-6" data-testid="mapping-error">
        <div className="border-destructive/50 bg-destructive/5 rounded-md border p-4">
          <p className="text-destructive text-sm">{parseError}</p>
        </div>
        <div className="flex justify-between">
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
        </div>
      </div>
    )
  }

  if (!currentSheet || !currentConfig) return null

  return (
    <div className="space-y-6" data-testid="step-column-mapping">
      <div className="flex items-center justify-between gap-3 rounded-lg border p-4">
        <div className="text-sm">
          <span className="font-medium">
            Sheet {sheetIdx + 1} of {sheets.length}:
          </span>{" "}
          <span className="text-muted-foreground">
            {currentSheet.name} ({currentSheet.rows.length} rows)
          </span>
        </div>
        {sheets.length > 1 && (
          <Label
            htmlFor="sheet-skip-cb"
            className="flex cursor-pointer items-center gap-2 text-sm"
          >
            <Checkbox
              id="sheet-skip-cb"
              checked={currentConfig.skipped}
              onCheckedChange={(v) =>
                updateCurrentConfig({ skipped: v === true })
              }
              data-testid="sheet-skip"
            />
            Skip this sheet (don't import its data)
          </Label>
        )}
      </div>

      {currentConfig.skipped && (
        <div className="text-muted-foreground rounded-md border border-dashed p-4 text-center text-sm">
          This sheet will be skipped during import. Uncheck above to configure
          it.
        </div>
      )}

      {!currentConfig.skipped && (
        <>
          <SkipRowsField value={skipRows} onChange={setSkipRows} />

          <DataPreview sheet={currentSheet} />

          <PlotColumnsSection
            headers={headers}
            config={currentConfig}
            onUpdate={updateCurrentConfig}
          />

          <TraitColumnsSection
            headers={headers}
            reservedColumns={reservedColumns}
            config={currentConfig}
            onToggle={toggleTraitColumn}
            onFieldChange={updateTraitField}
          />

          <GermplasmColumnsSection
            headers={headers}
            config={currentConfig}
            onUpdate={updateCurrentConfig}
          />

          <PopulationField
            value={currentConfig.populationName}
            onChange={(v) => updateCurrentConfig({ populationName: v })}
            existing={existingPopulations}
          />

          <CollectionDateSection
            headers={headers}
            config={currentConfig}
            onUpdate={updateCurrentConfig}
          />

          <SeasonSection
            headers={headers}
            config={currentConfig}
            onUpdate={updateCurrentConfig}
          />

          <SiteSection
            headers={headers}
            config={currentConfig}
            onUpdate={updateCurrentConfig}
          />

          <TimestampSection
            headers={headers}
            config={currentConfig}
            onUpdate={updateCurrentConfig}
          />

          <MetadataColumnsSection
            availableForMetadata={availableForMetadata}
            config={currentConfig}
            pending={pendingMetadataSelect}
            onPendingChange={setPendingMetadataSelect}
            onAdd={addMetadataColumn}
            onRemove={removeMetadataColumn}
            onLabelChange={updateMetadataLabel}
          />

          <MappedPreviewSection sheet={currentSheet} config={currentConfig} />
        </>
      )}

      {sheets.length > 1 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => goToSheet(sheetIdx - 1)}
            disabled={sheetIdx === 0}
            data-testid="sheet-prev"
          >
            <ChevronLeft className="h-4 w-4" />
            Previous sheet
          </Button>
          <span className="text-muted-foreground text-sm">
            Sheet {sheetIdx + 1} of {sheets.length}
          </span>
          <Button
            variant={
              currentValid && !canContinue && sheetIdx < sheets.length - 1
                ? "default"
                : "outline"
            }
            size="sm"
            onClick={() => goToSheet(sheetIdx + 1)}
            disabled={sheetIdx === sheets.length - 1 || !currentValid}
            data-testid="sheet-next"
          >
            Next sheet
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} data-testid="mapping-back">
          Back
        </Button>
        <Button
          onClick={handleContinue}
          disabled={!canContinue}
          data-testid="mapping-continue"
        >
          Continue to Upload
        </Button>
      </div>
    </div>
  )
}

function SkipRowsField({
  value,
  onChange,
}: {
  value: number
  onChange: (next: number) => void
}) {
  return (
    <div className="space-y-2 rounded-lg border p-4">
      <div className="flex items-center gap-3">
        <Label
          htmlFor="skip-rows-input"
          className="text-sm font-medium whitespace-nowrap"
        >
          Header lines to skip
        </Label>
        <Input
          id="skip-rows-input"
          data-testid="skip-rows-input"
          type="number"
          min={0}
          step={1}
          value={value}
          onChange={(e) => {
            const raw = e.currentTarget.value
            if (raw === "") {
              onChange(0)
              return
            }
            const n = Number.parseInt(raw, 10)
            if (Number.isFinite(n) && n >= 0) onChange(n)
          }}
          className="w-24"
        />
      </div>
      <p className="text-muted-foreground text-xs">
        Drop this many lines before the header. Auto-detected from the file
        on open — adjust if the preview below doesn&apos;t look right.
      </p>
    </div>
  )
}

function DataPreview({ sheet }: { sheet: ParsedSheet }) {
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Data Preview</h3>
        <span className="text-muted-foreground text-xs">
          {sheet.rows.length} rows, {sheet.headers.length} columns
        </span>
      </div>
      <div className="max-h-64 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {sheet.headers.map((header) => (
                <TableHead key={header} className="whitespace-nowrap">
                  {header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sheet.rows.slice(0, 5).map((row, i) => (
              <TableRow key={i}>
                {sheet.headers.map((header) => (
                  <TableCell key={header} className="whitespace-nowrap">
                    {row[header] != null ? String(row[header]) : ""}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

interface ColumnSelectProps {
  testId: string
  value: string | null
  onChange: (next: string | null) => void
  headers: string[]
  placeholder?: string
  className?: string
}

function ColumnSelect({
  testId,
  value,
  onChange,
  headers,
  placeholder,
  className,
}: ColumnSelectProps) {
  return (
    <Select
      value={value ?? NOT_MAPPED}
      onValueChange={(v) => onChange(v === NOT_MAPPED ? null : v)}
    >
      <SelectTrigger className={className} data-testid={testId}>
        <SelectValue placeholder={placeholder ?? "-- Not mapped --"} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NOT_MAPPED}>
          {placeholder ?? "-- Not mapped --"}
        </SelectItem>
        {headers.map((header) => (
          <SelectItem key={header} value={header}>
            {header}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function PlotColumnsSection({
  headers,
  config,
  onUpdate,
}: {
  headers: string[]
  config: SheetMapping
  onUpdate: (u: Partial<SheetMapping>) => void
}) {
  const plotUnmapped = !config.plotNumberColumn
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <h3 className="font-medium">Plot columns</h3>
      </div>
      <p className="text-muted-foreground text-sm">
        Trait records can attach to plots. Plot number, row, and column are
        all optional — leave them unmapped if your data has no plot context.
      </p>
      {plotUnmapped && (
        <p
          data-testid="plot-unmapped-warning"
          className="text-sm text-amber-700 dark:text-amber-400"
        >
          No plot column mapped. Records from this sheet will be saved without
          plot linkage and won&apos;t appear on plot maps.
        </p>
      )}
      <div className="space-y-2">
        <FieldRow label="Plot number">
          <ColumnSelect
            testId="plot-number-select"
            value={config.plotNumberColumn}
            onChange={(next) => onUpdate({ plotNumberColumn: next })}
            headers={headers}
            placeholder="-- Select a column (optional) --"
            className="flex-1"
          />
        </FieldRow>
        <FieldRow label="Plot row">
          <ColumnSelect
            testId="plot-row-select"
            value={config.plotRowColumn}
            onChange={(next) => onUpdate({ plotRowColumn: next })}
            headers={headers}
            className="flex-1"
          />
        </FieldRow>
        <FieldRow label="Plot column">
          <ColumnSelect
            testId="plot-col-select"
            value={config.plotColumnColumn}
            onChange={(next) => onUpdate({ plotColumnColumn: next })}
            headers={headers}
            className="flex-1"
          />
        </FieldRow>
      </div>
    </div>
  )
}

function FieldRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-36 shrink-0 text-sm">{label}</div>
      {children}
    </div>
  )
}

function TraitColumnsSection({
  headers,
  reservedColumns,
  config,
  onToggle,
  onFieldChange,
}: {
  headers: string[]
  reservedColumns: Set<string>
  config: SheetMapping
  onToggle: (header: string, enabled: boolean) => void
  onFieldChange: (
    header: string,
    field: "traitName" | "units",
    value: string,
  ) => void
}) {
  const candidates = headers.filter((h) => !reservedColumns.has(h))
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <h3 className="font-medium">Trait columns</h3>
        <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
          Required
        </Badge>
      </div>
      <p className="text-muted-foreground text-sm">
        Select every column that contains trait measurements. Each selected
        column becomes a separate trait. Edit the trait name and optionally
        specify its units (e.g., cm, count, g/m²).
      </p>
      <div className="space-y-2">
        {candidates.map((header) => {
          const entry = config.traitColumns.find(
            (tc) => tc.columnHeader === header,
          )
          const checked = entry?.enabled ?? false
          const label = entry?.traitName ?? header
          const units = entry?.units ?? ""
          return (
            <div key={header} className="flex items-center gap-3">
              <Label className="flex w-48 shrink-0 cursor-pointer items-center gap-2">
                <Checkbox
                  checked={checked}
                  onCheckedChange={(v) => onToggle(header, v === true)}
                  data-testid={`trait-checkbox-${header}`}
                />
                <span className="truncate text-sm font-medium">{header}</span>
              </Label>
              <Input
                value={label}
                onChange={(e) =>
                  onFieldChange(header, "traitName", e.target.value)
                }
                placeholder={header}
                disabled={!checked}
                className="flex-1"
                data-testid={`trait-label-${header}`}
              />
              <Input
                value={units}
                onChange={(e) => onFieldChange(header, "units", e.target.value)}
                placeholder="units"
                disabled={!checked}
                className="w-28 shrink-0"
                data-testid={`trait-units-${header}`}
              />
            </div>
          )
        })}
        {candidates.length === 0 && (
          <p className="text-muted-foreground text-sm">
            All columns are being used for other roles. Clear a plot, genotype,
            timestamp, or metadata mapping to select it as a trait instead.
          </p>
        )}
      </div>
    </div>
  )
}

function GermplasmColumnsSection({
  headers,
  config,
  onUpdate,
}: {
  headers: string[]
  config: SheetMapping
  onUpdate: (u: Partial<SheetMapping>) => void
}) {
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <h3 className="font-medium">Germplasm columns (optional)</h3>
      <p className="text-muted-foreground text-sm">
        Tag the columns that identify the germplasm for each row. An{" "}
        <em>accession</em> is a canonical germplasm unit (e.g.{" "}
        <code>SL-58-6-8-09</code>); a <em>line</em> is a pedigree anchor (e.g.{" "}
        <code>MAGIC110</code>, <code>B73</code>); an <em>alias</em> is a
        field-book shorthand (e.g. <code>1</code>, <code>Check1</code>) that
        points at an accession or line. You can map any combination — sheets
        often have a line name + a numeric alias, or an accession name on its
        own.
      </p>
      <div className="space-y-2">
        <FieldRow label="Accession name">
          <ColumnSelect
            testId="accession-name-column-select"
            value={config.accessionNameColumn}
            onChange={(next) => onUpdate({ accessionNameColumn: next })}
            headers={headers}
            className="flex-1"
          />
        </FieldRow>
        <FieldRow label="Line name">
          <ColumnSelect
            testId="line-name-column-select"
            value={config.lineNameColumn}
            onChange={(next) => onUpdate({ lineNameColumn: next })}
            headers={headers}
            className="flex-1"
          />
        </FieldRow>
        <FieldRow label="Alias">
          <ColumnSelect
            testId="alias-column-select"
            value={config.aliasColumn}
            onChange={(next) => onUpdate({ aliasColumn: next })}
            headers={headers}
            className="flex-1"
          />
        </FieldRow>
      </div>
    </div>
  )
}

function PopulationField({
  value,
  onChange,
  existing,
}: {
  value: string
  onChange: (v: string) => void
  existing: string[]
}) {
  const derivedMode: "none" | "existing" | "new" =
    value.trim() === ""
      ? "none"
      : existing.includes(value.trim())
        ? "existing"
        : "new"
  const [localMode, setLocalMode] = useState<
    "none" | "existing" | "new" | null
  >(null)
  const mode = localMode ?? derivedMode

  const selectValue =
    mode === "none" ? POPULATION_NONE : mode === "new" ? POPULATION_NEW : value

  // Radix Select returns focus to its trigger when it closes, which races
  // with the new-name input's `autoFocus`. Defer focusing past that handoff.
  const newNameInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (mode === "new") {
      const t = setTimeout(() => newNameInputRef.current?.focus(), 0)
      return () => clearTimeout(t)
    }
  }, [mode])

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <h3 className="font-medium">Population name (optional)</h3>
      <p className="text-muted-foreground text-sm">
        The germplasm population that all rows in this sheet belong to (e.g. a
        diversity panel or RIL population). Pick an existing population or
        create a new one. Leave unspecified if it doesn't apply.
      </p>
      <Select
        value={selectValue}
        onValueChange={(v) => {
          if (v === POPULATION_NONE) {
            setLocalMode("none")
            onChange("")
          } else if (v === POPULATION_NEW) {
            setLocalMode("new")
            onChange("")
          } else {
            setLocalMode("existing")
            onChange(v)
          }
        }}
      >
        <SelectTrigger data-testid="population-select">
          <SelectValue placeholder="-- Not specified --" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={POPULATION_NONE}>-- Not specified --</SelectItem>
          <SelectItem value={POPULATION_NEW}>+ Create new…</SelectItem>
          {existing.map((name) => (
            <SelectItem key={name} value={name}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {mode === "new" && (
        <Input
          ref={newNameInputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. UC Davis Diversity Panel"
          data-testid="population-name"
          autoFocus
        />
      )}
    </div>
  )
}

function CollectionDateSection({
  headers,
  config,
  onUpdate,
}: {
  headers: string[]
  config: SheetMapping
  onUpdate: (u: Partial<SheetMapping>) => void
}) {
  // The native <input type="date"> shows today's date in the picker even when
  // the underlying value is empty, so users think the field is set. Mirror
  // that into the sheet config so isSheetConfigValid accepts it.
  useEffect(() => {
    if (config.collectionDateMode === "fixed" && !config.collectionDate) {
      onUpdate({ collectionDate: new Date().toISOString().slice(0, 10) })
    }
  }, [config.collectionDateMode, config.collectionDate, onUpdate])

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <h3 className="font-medium">Collection date</h3>
      <p className="text-muted-foreground text-sm">
        The date measurements were collected. Choose a fixed date, a column with
        per-row dates, or mark it unknown (e.g., for post-harvest measurements
        like yield with no meaningful collection date).
      </p>
      <div className="flex items-center gap-3">
        <Select
          value={config.collectionDateMode}
          onValueChange={(v) => {
            const mode = v as "fixed" | "column" | "unknown"
            onUpdate({
              collectionDateMode: mode,
              ...(mode !== "column" ? { collectionDateColumn: null } : {}),
              ...(mode !== "fixed" ? { collectionDate: "" } : {}),
            })
          }}
        >
          <SelectTrigger
            className="w-44 shrink-0"
            data-testid="collection-date-mode"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fixed">Fixed date</SelectItem>
            <SelectItem value="column">From column</SelectItem>
            <SelectItem value="unknown">Unknown / not defined</SelectItem>
          </SelectContent>
        </Select>
        {config.collectionDateMode === "fixed" && (
          <Input
            type="date"
            value={config.collectionDate}
            onChange={(e) => onUpdate({ collectionDate: e.target.value })}
            className="flex-1"
            data-testid="collection-date-fixed"
          />
        )}
        {config.collectionDateMode === "column" && (
          <ColumnSelect
            testId="collection-date-column"
            value={config.collectionDateColumn}
            onChange={(next) => onUpdate({ collectionDateColumn: next })}
            headers={headers}
            placeholder="-- Select a column --"
            className="flex-1"
          />
        )}
      </div>
    </div>
  )
}

function SeasonSection({
  headers,
  config,
  onUpdate,
}: {
  headers: string[]
  config: SheetMapping
  onUpdate: (u: Partial<SheetMapping>) => void
}) {
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <h3 className="font-medium">Season</h3>
        <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
          Required
        </Badge>
      </div>
      <p className="text-muted-foreground text-sm">
        Specify a fixed season name for every row in this sheet, or read it from
        a column (useful when a sheet contains data from multiple years).
      </p>
      <div className="flex items-center gap-3">
        <Select
          value={config.seasonMode}
          onValueChange={(v) => {
            const mode = v as "fixed" | "column"
            onUpdate({
              seasonMode: mode,
              ...(mode === "fixed"
                ? { seasonColumn: null }
                : { seasonName: "" }),
            })
          }}
        >
          <SelectTrigger className="w-44 shrink-0" data-testid="season-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fixed">Fixed value</SelectItem>
            <SelectItem value="column">From column</SelectItem>
          </SelectContent>
        </Select>
        {config.seasonMode === "fixed" ? (
          <Input
            value={config.seasonName}
            onChange={(e) => onUpdate({ seasonName: e.target.value })}
            placeholder="e.g. Summer 2022"
            className="flex-1"
            data-testid="season-fixed"
          />
        ) : (
          <ColumnSelect
            testId="season-column"
            value={config.seasonColumn}
            onChange={(next) => onUpdate({ seasonColumn: next })}
            headers={headers}
            placeholder="-- Select a column --"
            className="flex-1"
          />
        )}
      </div>
    </div>
  )
}

function SiteSection({
  headers,
  config,
  onUpdate,
}: {
  headers: string[]
  config: SheetMapping
  onUpdate: (u: Partial<SheetMapping>) => void
}) {
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <h3 className="font-medium">Site</h3>
        <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
          Required
        </Badge>
      </div>
      <p className="text-muted-foreground text-sm">
        Specify a fixed site name for every row in this sheet, or read it from a
        column (useful when a sheet contains data from multiple locations).
      </p>
      <div className="flex items-center gap-3">
        <Select
          value={config.siteMode}
          onValueChange={(v) => {
            const mode = v as "fixed" | "column"
            onUpdate({
              siteMode: mode,
              ...(mode === "fixed" ? { siteColumn: null } : { siteName: "" }),
            })
          }}
        >
          <SelectTrigger className="w-44 shrink-0" data-testid="site-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fixed">Fixed value</SelectItem>
            <SelectItem value="column">From column</SelectItem>
          </SelectContent>
        </Select>
        {config.siteMode === "fixed" ? (
          <Input
            value={config.siteName}
            onChange={(e) => onUpdate({ siteName: e.target.value })}
            placeholder="e.g. Davis Field A"
            className="flex-1"
            data-testid="site-fixed"
          />
        ) : (
          <ColumnSelect
            testId="site-column"
            value={config.siteColumn}
            onChange={(next) => onUpdate({ siteColumn: next })}
            headers={headers}
            placeholder="-- Select a column --"
            className="flex-1"
          />
        )}
      </div>
    </div>
  )
}

function TimestampSection({
  headers,
  config,
  onUpdate,
}: {
  headers: string[]
  config: SheetMapping
  onUpdate: (u: Partial<SheetMapping>) => void
}) {
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <h3 className="font-medium">Timestamp column (optional)</h3>
      <p className="text-muted-foreground text-sm">
        If unmapped, timestamps will be derived from the collection date.
      </p>
      <ColumnSelect
        testId="timestamp-column-select"
        value={config.timestampColumn}
        onChange={(next) => onUpdate({ timestampColumn: next })}
        headers={headers}
      />
    </div>
  )
}

function MetadataColumnsSection({
  availableForMetadata,
  config,
  pending,
  onPendingChange,
  onAdd,
  onRemove,
  onLabelChange,
}: {
  availableForMetadata: string[]
  config: SheetMapping
  pending: string
  onPendingChange: (v: string) => void
  onAdd: (header: string) => void
  onRemove: (header: string) => void
  onLabelChange: (header: string, label: string) => void
}) {
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <h3 className="font-medium">Additional metadata (optional)</h3>
      <p className="text-muted-foreground text-sm">
        Add any other column as passthrough metadata. Each selected column is
        saved with every record under its label (e.g. notes, reps, block).
      </p>

      {config.metadataColumns.length > 0 && (
        <div className="space-y-2">
          {config.metadataColumns.map((mc) => (
            <div key={mc.columnHeader} className="flex items-center gap-3">
              <div
                className="w-36 shrink-0 truncate text-sm"
                title={mc.columnHeader}
              >
                {mc.columnHeader}
              </div>
              <Input
                value={mc.label}
                onChange={(e) => onLabelChange(mc.columnHeader, e.target.value)}
                placeholder={mc.columnHeader}
                className="flex-1"
                data-testid={`metadata-label-${mc.columnHeader}`}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => onRemove(mc.columnHeader)}
                data-testid={`metadata-remove-${mc.columnHeader}`}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Select
          value={pending}
          onValueChange={onPendingChange}
          disabled={availableForMetadata.length === 0}
        >
          <SelectTrigger className="flex-1" data-testid="metadata-add-select">
            <SelectValue
              placeholder={
                availableForMetadata.length === 0
                  ? "-- No columns available --"
                  : "-- Choose a column to add --"
              }
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NOT_MAPPED}>
              {availableForMetadata.length === 0
                ? "-- No columns available --"
                : "-- Choose a column to add --"}
            </SelectItem>
            {availableForMetadata.map((header) => (
              <SelectItem key={header} value={header}>
                {header}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onAdd(pending)}
          disabled={pending === NOT_MAPPED}
          data-testid="metadata-add-button"
        >
          <Plus className="h-4 w-4" />
          Add
        </Button>
      </div>
    </div>
  )
}

function MappedPreviewSection({
  sheet,
  config,
}: {
  sheet: ParsedSheet
  config: SheetMapping
}) {
  const enabledTraits = config.traitColumns.filter((tc) => tc.enabled)
  const previewHeaders: string[] = []
  if (config.plotNumberColumn) previewHeaders.push("Plot #")
  if (config.plotRowColumn) previewHeaders.push("Row")
  if (config.plotColumnColumn) previewHeaders.push("Col")
  if (config.accessionNameColumn) previewHeaders.push("Accession")
  if (config.lineNameColumn) previewHeaders.push("Line")
  if (config.aliasColumn) previewHeaders.push("Alias")
  for (const tc of enabledTraits) {
    previewHeaders.push(tc.traitName || tc.columnHeader)
  }
  for (const mc of config.metadataColumns) {
    previewHeaders.push(`[${mc.label}]`)
  }
  if (previewHeaders.length === 0) return null

  const previewRows = sheet.rows.slice(0, 3).map((row) => {
    const r: string[] = []
    const push = (col: string | null, transform: "raw" | "trim" = "raw") => {
      if (!col) return
      const v = row[col]
      if (v == null) {
        r.push("")
        return
      }
      r.push(transform === "trim" ? String(v).trim() : String(v))
    }
    push(config.plotNumberColumn)
    push(config.plotRowColumn)
    push(config.plotColumnColumn)
    push(config.accessionNameColumn, "trim")
    push(config.lineNameColumn, "trim")
    push(config.aliasColumn, "trim")
    for (const tc of enabledTraits) push(tc.columnHeader)
    for (const mc of config.metadataColumns) push(mc.columnHeader)
    return r
  })
  if (previewRows.length === 0) return null

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <h3 className="font-medium">Mapped Preview</h3>
      <p className="text-muted-foreground text-sm">
        How the first rows of this sheet will be interpreted:
      </p>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {previewHeaders.map((label) => (
                <TableHead key={label} className="whitespace-nowrap">
                  {label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {previewRows.map((row, i) => (
              <TableRow key={i}>
                {row.map((cell, j) => (
                  <TableCell key={j} className="whitespace-nowrap">
                    {cell}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
