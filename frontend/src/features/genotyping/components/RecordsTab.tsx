/**
 * Records tab on the StudyDetail page.
 *
 * Shows a paginated table of GenotypeRecordOutput rows for the current
 * study. New ingest happens through `/files` → "Genomic Data" → import
 * wizard (Phase 9d); the standalone "Upload matrix" button + dialog were
 * removed when the wizard shipped end-to-end.
 *
 * Pagination is simple `limit/offset` — the SDK exposes both as query
 * params and the backend caps `limit` at 500. Using 50 here keeps the
 * table responsive at typical breeding-study sizes (~10k records would
 * fit in 200 pages).
 */
import { Link } from "@tanstack/react-router"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useGenotypeRecords } from "@/features/genotyping/hooks/useGenotypeRecords"

const PAGE_SIZE = 50

export function RecordsTab({ studyId }: { studyId: string }) {
  const [page, setPage] = useState(0)
  const [variantFilter, setVariantFilter] = useState("")
  const [accessionFilter, setAccessionFilter] = useState("")

  const records = useGenotypeRecords({
    studyId,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    variantName: variantFilter.trim() || undefined,
    accessionName: accessionFilter.trim() || undefined,
  })

  const rows = records.data ?? []
  // The backend doesn't return a total-count, so "next page exists" is
  // approximated by "this page is full." Slight imperfection: a final
  // page that happens to fill exactly will offer one extra empty click.
  const hasNext = rows.length >= PAGE_SIZE

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <div className="grid gap-1">
            <label
              className="text-muted-foreground text-xs"
              htmlFor="records-variant-filter"
            >
              Variant
            </label>
            <Input
              id="records-variant-filter"
              data-testid="records-variant-filter"
              value={variantFilter}
              onChange={(e) => {
                setPage(0)
                setVariantFilter(e.currentTarget.value)
              }}
              placeholder="SNP_001"
              className="w-44"
            />
          </div>
          <div className="grid gap-1">
            <label
              className="text-muted-foreground text-xs"
              htmlFor="records-accession-filter"
            >
              Accession
            </label>
            <Input
              id="records-accession-filter"
              data-testid="records-accession-filter"
              value={accessionFilter}
              onChange={(e) => {
                setPage(0)
                setAccessionFilter(e.currentTarget.value)
              }}
              placeholder="LINE_A"
              className="w-44"
            />
          </div>
        </div>
        <Button asChild data-testid="records-upload-link">
          <Link to="/files">Import wizard →</Link>
        </Button>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Variant</TableHead>
              <TableHead>Chromosome</TableHead>
              <TableHead>Position</TableHead>
              <TableHead>Accession</TableHead>
              <TableHead>Call</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-muted-foreground py-6 text-center text-sm"
                >
                  Loading…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-muted-foreground py-6 text-center text-sm"
                  data-testid="records-empty"
                >
                  No records yet. Use the <strong>Import wizard</strong> at{" "}
                  <Link to="/files" className="underline">
                    /files
                  </Link>{" "}
                  → "Genomic Data" to ingest a genotype file.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow
                  key={String(r.id ?? `${r.variant_id}-${r.accession_id}`)}
                  data-testid="records-row"
                >
                  <TableCell className="font-medium">
                    {r.variant_name ?? ""}
                  </TableCell>
                  <TableCell>{r.chromosome ?? ""}</TableCell>
                  <TableCell>{r.position ?? ""}</TableCell>
                  <TableCell>{r.accession_name ?? ""}</TableCell>
                  <TableCell>{r.call_value ?? ""}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          Showing rows {rows.length === 0 ? 0 : page * PAGE_SIZE + 1}–
          {page * PAGE_SIZE + rows.length}
        </span>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="outline"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!hasNext}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}
