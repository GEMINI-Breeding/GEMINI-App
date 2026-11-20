/**
 * AssociationPanel — the Associate Boundaries step's result: which stitched
 * plot landed in which boundary polygon (the worker's association.json in
 * the newest stitch version), and the plot images it wrote to PlotImages/
 * for Analyze and inference.
 */
import { useQuery } from "@tanstack/react-query"
import { ChevronDown, ChevronRight } from "lucide-react"
import { useMemo, useState } from "react"
import type { FileMetadata } from "@/client"
import { authHeaders } from "@/components/Common/PlotImage"
import { Button } from "@/components/ui/button"
import { apiUrl, DEFAULT_BUCKET } from "@/features/files/lib/download"
import { PlotImageGrid } from "@/features/process/components/PlotImageGrid"
import { stitchVersions } from "@/features/process/lib/groundTrack"
import {
  type AerialScope,
  plotImagesPrefix,
  processedPrefix,
} from "@/features/process/lib/paths"

interface AssociationRow {
  stitched_plot: string
  matched: boolean
  plot?: string
  accession?: string
}

export function AssociationPanel({
  files,
  scope,
}: {
  files: FileMetadata[]
  scope: AerialScope | null
}) {
  const version = useMemo(
    () =>
      scope
        ? stitchVersions(files, scope).find((v) => v.combinedMosaic)
        : undefined,
    [files, scope],
  )
  const associationPath = version
    ? files.find((f) => f.object_name === `${version.prefix}association.json`)
        ?.object_name
    : undefined
  const assoc = useQuery<{ plots: AssociationRow[] } | null>({
    queryKey: ["association", associationPath],
    queryFn: async () => {
      const res = await fetch(
        apiUrl(`/api/files/download/${DEFAULT_BUCKET}/${associationPath}`),
        { headers: authHeaders() },
      )
      return res.ok ? await res.json() : null
    },
    enabled: Boolean(associationPath),
  })
  const images = useMemo(
    () =>
      scope
        ? files.filter((f) =>
            (f.object_name ?? "").startsWith(plotImagesPrefix(scope)),
          )
        : [],
    [files, scope],
  )

  const [showTable, setShowTable] = useState(false)
  const [showImages, setShowImages] = useState(false)
  const rows = assoc.data?.plots ?? []
  if (!rows.length) return null
  const matched = rows.filter((r) => r.matched)
  const unmatched = rows.filter((r) => !r.matched)
  return (
    <div className="space-y-2" data-testid="association-results">
      <p className="text-xs" data-testid="association-summary">
        {matched.length} of {rows.length} stitched plots matched a boundary
        {version ? ` (stitch v${version.version})` : ""}
      </p>
      {unmatched.length > 0 && (
        <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-800 text-xs">
          Outside every boundary: stitched plot
          {unmatched.length === 1 ? " " : "s "}
          {unmatched.map((r) => r.stitched_plot).join(", ")}
        </p>
      )}
      {/* Long lists stay folded: the summary above is what most visits need. */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => setShowTable((x) => !x)}
          aria-expanded={showTable}
          data-testid="association-toggle-table"
        >
          {showTable ? (
            <ChevronDown className="mr-1 h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="mr-1 h-3.5 w-3.5" />
          )}
          {showTable ? "Hide matches" : `Show ${rows.length} matches`}
        </Button>
        {scope && images.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => setShowImages((x) => !x)}
            aria-expanded={showImages}
          >
            {showImages ? (
              <ChevronDown className="mr-1 h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="mr-1 h-3.5 w-3.5" />
            )}
            {showImages
              ? "Hide plot images"
              : `Show ${images.length} plot images`}
          </Button>
        )}
      </div>
      {showTable && (
        <div className="max-h-72 overflow-auto rounded border">
          <table className="w-full text-xs" data-testid="association-table">
            <thead className="text-muted-foreground bg-muted/50 sticky top-0">
              <tr>
                <th className="px-2 py-1 text-left font-medium">
                  Stitched plot
                </th>
                <th className="px-2 py-1 text-left font-medium">
                  Boundary plot
                </th>
                <th className="px-2 py-1 text-left font-medium">Accession</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.stitched_plot} className="border-t">
                  <td className="px-2 py-1">{r.stitched_plot}</td>
                  <td className="px-2 py-1">{r.matched ? r.plot : "—"}</td>
                  <td className="px-2 py-1">{r.matched ? r.accession : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {scope && showImages && (
        <PlotImageGrid files={images} prefix={processedPrefix(scope)} />
      )}
    </div>
  )
}
