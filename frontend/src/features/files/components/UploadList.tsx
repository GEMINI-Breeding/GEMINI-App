import { Eye, File, X, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { UploadZone } from "./UploadZone";
import { Button } from "@/components/ui/button";
import { dataTypes } from "@/config/dataTypes";
import { useFileUpload } from "@/features/files/hooks/useFileUpload";
import { FilePreviewDialog } from "./FilePreviewDialog";
import { OpenAPI } from "@/client";
import useCustomToast from "@/hooks/useCustomToast";

interface UploadListProps {
  dataType: string | null;
  formValues: Record<string, string>;
  onFilesSelected?: (paths: string[]) => void;
  onUploadComplete?: (destPaths: string[]) => void;
  onDockerError?: (message: string) => void;
  /** Optional label shown above the upload zone */
  label?: string;
  /** Optional sub-path appended to the target directory (e.g. "DEM") */
  subDir?: string;
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

interface PendingUpload {
  filePaths: string[];
  dataType: string;
  targetRootDir: string;
  formValues: Record<string, string>;
  existingFiles: string[];
}

// Map dataTypes fileType → sets of valid lowercase extensions
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp", ".bmp", ".gif"])

function isExtensionAllowed(filePath: string, fileType: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase()
  if (fileType === "*") return true
  if (fileType === "image/*") return IMAGE_EXTS.has(ext)
  // Comma-separated list (e.g. ".csv,.xlsx,.xls") or single extension
  const allowed = fileType.split(",").map((s) => s.trim().toLowerCase())
  return allowed.some((a) => ext === a) || (allowed.includes(".tif") && ext === ".tiff")
}

export function UploadList({ dataType, formValues, onFilesSelected, onUploadComplete, onDockerError, label, subDir }: UploadListProps) {
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const { uploadFiles } = useFileUpload();
  const { showErrorToast } = useCustomToast();

  const addFiles = (paths: string[]) => {
    if (dataType) {
      const cfg = dataTypes[dataType as keyof typeof dataTypes]
      if (cfg?.fileType) {
        const rejected = paths.filter((p) => !isExtensionAllowed(p, cfg.fileType))
        if (rejected.length > 0) {
          const names = rejected.map((p) => p.split(/[\\/]/).pop()).join(", ")
          showErrorToast(`Wrong file type for "${dataType}": ${names}`)
          const accepted = paths.filter((p) => isExtensionAllowed(p, cfg.fileType))
          if (accepted.length === 0) return
          setSelectedPaths((prev) => [...prev, ...accepted]);
          onFilesSelected?.(accepted);
          return
        }
      }
    }
    setSelectedPaths((prev) => [...prev, ...paths]);
    onFilesSelected?.(paths);
  };

  const removeFile = (index: number) => {
    setSelectedPaths((prev) => prev.filter((_, i) => i !== index));
  };

  function buildUploadParams() {
    if (!dataType) return null;
    const selectedDataType = dataTypes[dataType as keyof typeof dataTypes];
    if (!selectedDataType) return null;
    const values = { ...formValues };
    if (values["date"]) values["year"] = values["date"].split("-")[0];
    let targetRootDir = selectedDataType.directory
      .map((field) => values[field.toLowerCase()] || field)
      .join("/");
    if (subDir) targetRootDir += `/${subDir}`;
    return { values, targetRootDir };
  }

  const handleUploadClick = async () => {
    const params = buildUploadParams();
    if (!params) return;
    const { values, targetRootDir } = params;

    const fileNames = selectedPaths.map(fileNameFromPath);
    setIsChecking(true);
    try {
      const res = await fetch(`${OpenAPI.BASE}/api/v1/files/check-existing`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
        },
        body: JSON.stringify({ target_root_dir: targetRootDir, file_names: fileNames, data_type: dataType }),
      });
      const data = res.ok ? await res.json() : { existing: [] };
      const existing: string[] = data.existing ?? [];

      if (existing.length > 0) {
        setPendingUpload({ filePaths: selectedPaths, dataType: dataType!, targetRootDir, formValues: values, existingFiles: existing });
      } else {
        doUpload(selectedPaths, dataType!, targetRootDir, values, false);
      }
    } catch {
      // Check failed — proceed without warning
      doUpload(selectedPaths, dataType!, params.targetRootDir, values, false);
    } finally {
      setIsChecking(false);
    }
  };

  function doUpload(filePaths: string[], dt: string, targetRootDir: string, values: Record<string, string>, reupload: boolean) {
    uploadFiles({ filePaths, dataType: dt, targetRootDir, reupload, formValues: values, onComplete: onUploadComplete, onDockerError });
    setSelectedPaths([]);
    setPendingUpload(null);
  }

  return (
    <>
    <div className="space-y-6">
      {label && (
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
      )}
      <UploadZone onFilesAdded={addFiles} />

      {selectedPaths.length > 0 && (
        <div className="border-border bg-card rounded-lg border p-6">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex w-full items-center justify-between text-left"
          >
            <h3 className="text-foreground">
              Selected Files ({selectedPaths.length})
            </h3>
            {isExpanded ? (
              <ChevronUp className="text-muted-foreground h-5 w-5" />
            ) : (
              <ChevronDown className="text-muted-foreground h-5 w-5" />
            )}
          </button>

          {isExpanded && (
            <div className="mt-4 max-h-64 space-y-2 overflow-y-auto">
              {selectedPaths.map((filePath, index) => (
                <div
                  key={index}
                  className="border-border bg-muted flex items-center justify-between rounded border p-2"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <File className="text-muted-foreground h-4 w-4 flex-shrink-0" />
                    <span className="text-foreground truncate">
                      {fileNameFromPath(filePath)}
                    </span>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setPreviewPath(filePath); }}
                    className="hover:bg-accent ml-2 flex-shrink-0 rounded p-1"
                    title="Preview file"
                  >
                    <Eye className="text-muted-foreground h-4 w-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(index);
                    }}
                    className="hover:bg-accent ml-1 flex-shrink-0 rounded p-1"
                  >
                    <X className="text-muted-foreground h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <Button
              variant="outline"
              onClick={handleUploadClick}
              disabled={isChecking}
            >
              {isChecking ? "Checking…" : `Upload ${selectedPaths.length} file(s)`}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setSelectedPaths([])}
            >
              Clear
            </Button>
          </div>
        </div>
      )}
    </div>

      {previewPath && (
        <FilePreviewDialog filePath={previewPath} onClose={() => setPreviewPath(null)} />
      )}

      {/* Conflict warning dialog */}
      {pendingUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background w-full max-w-md rounded-xl border p-6 shadow-xl">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-500" />
              <h2 className="text-base font-semibold">Files already exist</h2>
            </div>
            <p className="text-muted-foreground mb-3 text-sm">
              {pendingUpload.existingFiles.length === pendingUpload.filePaths.length
                ? "All selected files already exist in the destination folder."
                : `${pendingUpload.existingFiles.length} of ${pendingUpload.filePaths.length} selected files already exist in the destination folder.`}
            </p>
            <div className="bg-muted mb-4 max-h-36 overflow-y-auto rounded-md px-3 py-2">
              {pendingUpload.existingFiles.map((name) => (
                <p key={name} className="text-muted-foreground py-0.5 font-mono text-xs">{name}</p>
              ))}
            </div>
            <p className="text-muted-foreground mb-4 text-sm">
              Do you want to replace the existing files, or skip them and only upload new ones?
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={() => setPendingUpload(null)}>
                Cancel
              </Button>
              <Button
                variant="outline"
                onClick={() => doUpload(pendingUpload.filePaths, pendingUpload.dataType, pendingUpload.targetRootDir, pendingUpload.formValues, false)}
              >
                Skip existing
              </Button>
              <Button
                onClick={() => doUpload(pendingUpload.filePaths, pendingUpload.dataType, pendingUpload.targetRootDir, pendingUpload.formValues, true)}
              >
                Replace all
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
