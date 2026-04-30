/**
 * Step 1 of the /import wizard — drop files, run detection, show summary.
 *
 * Ported from `backend/gemini-ui/src/components/import-wizard/step-detect.tsx`.
 * Adapted to use our existing `<UploadZone>` (Phase 6) instead of the
 * gemini-ui Dropzone since our zone already handles folder-walking via
 * `webkitGetAsEntry()` and we don't need a second drag-drop primitive.
 */
import { Calendar, FileType, FolderOpen, Loader2 } from "lucide-react"
import { useRef, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { UploadZone } from "@/features/files/components/UploadZone"
import {
  type DataCategory,
  type DetectionResult,
  detectFiles,
  formatFileSize,
} from "@/features/import/lib/detection-engine"
import type { FileWithPath } from "@/features/import/lib/types"

interface StepDetectProps {
  onNext: (files: FileWithPath[], detection: DetectionResult) => void
}

const CATEGORY_LABELS: Record<DataCategory, string> = {
  drone_imagery: "Drone Imagery",
  csv_tabular: "CSV / Tabular",
  genomic: "Genomic",
  thermal: "Thermal",
  elevation: "Elevation",
  mixed: "Mixed",
}

/** Decorate raw browser-File[] with `path` so the detection engine can
 *  extract dates from folder paths. UploadZone returns flat File[] —
 *  webkitRelativePath is set by the native input picker for click-pick;
 *  for drag-and-drop the recursive walk produces files without a path,
 *  so we fall back to `name`. (Folder-path preservation for drag-and-drop
 *  is a Phase-9d/9e enhancement if needed.) */
function decorateWithPaths(files: File[]): FileWithPath[] {
  return files.map((f) => {
    const augmented = f as FileWithPath
    if (!augmented.path) {
      const wkrp = (f as File & { webkitRelativePath?: string })
        .webkitRelativePath
      augmented.path = wkrp && wkrp.length > 0 ? wkrp : f.name
    }
    return augmented
  })
}

export function StepDetect({ onNext }: StepDetectProps) {
  const [files, setFiles] = useState<FileWithPath[]>([])
  const [detection, setDetection] = useState<DetectionResult | null>(null)
  const [isDetecting, setIsDetecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const detectionCounterRef = useRef(0)

  async function handleFilesSelected(selected: File[]) {
    const decorated = decorateWithPaths(selected)
    setFiles(decorated)
    setDetection(null)
    setError(null)
    setIsDetecting(true)

    const callId = ++detectionCounterRef.current
    try {
      const result = await detectFiles(decorated)
      if (detectionCounterRef.current !== callId) return
      setDetection(result)
    } catch (err) {
      if (detectionCounterRef.current !== callId) return
      setError(err instanceof Error ? err.message : "Detection failed")
    } finally {
      if (detectionCounterRef.current === callId) {
        setIsDetecting(false)
      }
    }
  }

  function handleContinue() {
    if (detection) onNext(files, detection)
  }

  function handleReset() {
    setFiles([])
    setDetection(null)
    setError(null)
  }

  return (
    <div className="space-y-6" data-testid="import-step-detect">
      {files.length === 0 ? (
        <UploadZone onFilesAdded={handleFilesSelected} />
      ) : (
        <>
          {isDetecting && (
            <div className="text-muted-foreground flex items-center justify-center gap-2 py-12">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>
                Analyzing {files.length} file{files.length === 1 ? "" : "s"}…
              </span>
            </div>
          )}

          {error && (
            <div
              className="border-destructive/50 bg-destructive/5 text-destructive rounded-md border p-4 text-sm"
              data-testid="detect-error"
            >
              {error}
            </div>
          )}

          {detection && (
            <div className="space-y-6">
              {/* Summary header */}
              <div
                className="space-y-3 rounded-lg border p-4"
                data-testid="detection-summary"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">Detection Summary</h3>
                  <Button variant="ghost" size="sm" onClick={handleReset}>
                    Choose different files
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2">
                  {detection.dataCategories.map((cat) => (
                    <Badge key={cat}>{CATEGORY_LABELS[cat]}</Badge>
                  ))}
                  <Badge variant="secondary">
                    {detection.totalFiles} files
                  </Badge>
                  <Badge variant="secondary">
                    {formatFileSize(detection.totalSize)}
                  </Badge>
                </div>

                {detection.detectedDates.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Calendar className="text-muted-foreground h-4 w-4 shrink-0" />
                    <span className="text-muted-foreground text-sm">
                      Dates:
                    </span>
                    {detection.detectedDates.map((date) => (
                      <Badge key={date} variant="outline">
                        {date}
                      </Badge>
                    ))}
                  </div>
                )}

                {(detection.suggestedExperimentName ||
                  detection.suggestedSensorType ||
                  detection.suggestedPlatform) && (
                  <div className="text-muted-foreground space-y-1 text-sm">
                    {detection.suggestedExperimentName && (
                      <p>
                        Suggested experiment:{" "}
                        <span className="text-foreground font-medium">
                          {detection.suggestedExperimentName}
                        </span>
                      </p>
                    )}
                    {detection.suggestedPlatform && (
                      <p>
                        Suggested platform:{" "}
                        <span className="text-foreground font-medium">
                          {detection.suggestedPlatform}
                        </span>
                      </p>
                    )}
                    {detection.suggestedSensorType && (
                      <p>
                        Suggested sensor:{" "}
                        <span className="text-foreground font-medium">
                          {detection.suggestedSensorType}
                        </span>
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* File groups table */}
              {detection.fileGroups.length > 0 && (
                <div className="space-y-2">
                  <h4 className="flex items-center gap-1.5 text-sm font-medium">
                    <FolderOpen className="h-4 w-4" />
                    File Groups
                  </h4>
                  <div className="overflow-hidden rounded-md border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/50 border-b">
                          <th className="p-2 text-left font-medium">Folder</th>
                          <th className="p-2 text-right font-medium">Files</th>
                          <th className="p-2 text-right font-medium">Size</th>
                          <th className="p-2 text-left font-medium">Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detection.fileGroups.map((group) => (
                          <tr
                            key={group.folder}
                            className="border-b last:border-0"
                          >
                            <td
                              className="max-w-[300px] truncate p-2"
                              title={group.folder}
                            >
                              {group.folder}
                            </td>
                            <td className="text-muted-foreground p-2 text-right">
                              {group.fileCount}
                            </td>
                            <td className="text-muted-foreground p-2 text-right">
                              {formatFileSize(group.totalSize)}
                            </td>
                            <td className="p-2">
                              {group.date ? (
                                <Badge variant="outline" className="text-xs">
                                  {group.date}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* CSV files */}
              {detection.csvFiles.length > 0 && (
                <div className="space-y-2">
                  <h4 className="flex items-center gap-1.5 text-sm font-medium">
                    <FileType className="h-4 w-4" />
                    CSV Files
                  </h4>
                  <div className="space-y-2">
                    {detection.csvFiles.map((csv) => (
                      <div
                        key={csv.name}
                        className="space-y-2 rounded-md border p-3"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">
                            {csv.name}
                          </span>
                          <Badge variant="secondary" className="text-xs">
                            {csv.category.replace(/_/g, " ")}
                          </Badge>
                        </div>
                        <p className="text-muted-foreground truncate text-xs">
                          Headers: {csv.headers.join(", ")}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <Button onClick={handleContinue} data-testid="detect-continue">
                  Continue
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
