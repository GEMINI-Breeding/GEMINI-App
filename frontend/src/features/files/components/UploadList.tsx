import { File, X, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { UploadZone } from "./UploadZone";
import { Button } from "@/components/ui/button";
import { dataTypes } from "@/config/dataTypes";
import { useFileUpload } from "@/features/files/hooks/useFileUpload";

interface UploadListProps {
  dataType: string | null;
  formValues: Record<string, string>;
  onFilesSelected?: (paths: string[]) => void;
  onUploadComplete?: (destPaths: string[]) => void;
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function UploadList({ dataType, formValues, onFilesSelected, onUploadComplete }: UploadListProps) {
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const { uploadFiles } = useFileUpload();

  const addFiles = (paths: string[]) => {
    setSelectedPaths((prev) => [...prev, ...paths]);
    onFilesSelected?.(paths);
  };

  const removeFile = (index: number) => {
    setSelectedPaths((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUploadClick = () => {
    if (!dataType) return;

    const selectedDataType =
      dataTypes[dataType as keyof typeof dataTypes];

    if (!selectedDataType) {
      return;
    }

    const values = { ...formValues };

    if (values["date"]) {
      values["year"] = values["date"].split("-")[0];
    }

    const targetRootDir = selectedDataType.directory
      .map((field) => values[field.toLowerCase()] || field)
      .join("/");

    uploadFiles({
      filePaths: selectedPaths,
      dataType,
      targetRootDir,
      formValues: values,
      onComplete: onUploadComplete,
    });

    setSelectedPaths([]);
  };

  return (
    <div className="space-y-6">
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
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(index);
                    }}
                    className="hover:bg-accent ml-2 flex-shrink-0 rounded p-1"
                  >
                    <X className="text-muted-foreground h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <Button
            variant="outline"
            className="mt-4"
            onClick={handleUploadClick}
          >
            Upload {selectedPaths.length} file(s)
          </Button>
        </div>
      )}
    </div>
  );
}
