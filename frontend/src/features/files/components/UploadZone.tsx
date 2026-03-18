import { Upload, Image } from "lucide-react";
import { pickFiles } from "@/lib/platform";

interface UploadZoneProps {
  onFilesAdded?: (paths: string[]) => void;
}

export function UploadZone({ onFilesAdded }: UploadZoneProps) {
  const handleClick = async () => {
    const selected = await pickFiles({ multiple: true });
    if (selected && selected.length > 0) {
      // In Tauri, selected is string[]; in browser, File[] — extract path/name
      const paths = selected.map((f) => (typeof f === "string" ? f : f.name));
      onFilesAdded?.(paths);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="mb-4 flex items-center gap-2">
        <Image className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-foreground">Upload</h2>
      </div>

      <div
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            handleClick();
          }
        }}
        role="button"
        tabIndex={0}
        className="cursor-pointer rounded-lg border-2 border-dashed border-border p-8 text-center transition-colors hover:border-muted-foreground hover:bg-muted"
      >
        <Upload className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
        <p className="mb-1 text-foreground">
          Click to browse and select files
        </p>
        <p className="text-muted-foreground">Supports multiple files</p>
      </div>
    </div>
  );
}
