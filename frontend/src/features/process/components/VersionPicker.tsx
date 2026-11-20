/**
 * VersionPicker — list, activate, and delete plot-geometry versions.
 *
 * Drives PlotGeometryService.versions/* endpoints (Phase 2 controller work).
 */
import { Button } from "@/components/ui/button"
import {
  type PlotGeometryVersion,
  useActivatePlotGeometryVersion,
  useDeletePlotGeometryVersion,
  usePlotGeometryVersions,
} from "@/features/process/hooks/usePlotGeometry"

export function VersionPicker({
  directory,
  onLoad,
  activeVersion,
}: {
  directory: string
  onLoad: (version: number) => void
  activeVersion: number | null
}) {
  const { data: versions = [], isLoading } = usePlotGeometryVersions(directory)
  const activate = useActivatePlotGeometryVersion()
  const remove = useDeletePlotGeometryVersion()

  if (isLoading) {
    return <p className="text-muted-foreground text-sm">Loading versions…</p>
  }
  if (versions.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No saved versions yet. Save the current geometry to create one.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-3 py-2 text-left">Version</th>
            <th className="px-3 py-2 text-left">Name</th>
            <th className="px-3 py-2 text-left">Created</th>
            <th className="px-3 py-2 text-left">Active</th>
            <th className="px-3 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v: PlotGeometryVersion) => (
            <tr key={v.version} className="border-t">
              <td className="px-3 py-2 font-mono text-xs">v{v.version}</td>
              <td className="px-3 py-2">{v.name ?? "—"}</td>
              <td className="px-3 py-2 text-muted-foreground text-xs">
                {v.created_at ? new Date(v.created_at).toLocaleString() : "—"}
              </td>
              <td className="px-3 py-2">{v.is_active ? "✓" : ""}</td>
              <td className="px-3 py-2 text-right">
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant={
                      activeVersion === v.version ? "default" : "outline"
                    }
                    onClick={() => onLoad(v.version)}
                  >
                    Load
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={v.is_active || activate.isPending}
                    onClick={() =>
                      activate.mutate({ directory, version: v.version })
                    }
                  >
                    Activate
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (
                        confirm(
                          `Delete version ${v.version}${v.name ? ` (${v.name})` : ""}?`,
                        )
                      ) {
                        remove.mutate({ directory, version: v.version })
                      }
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
