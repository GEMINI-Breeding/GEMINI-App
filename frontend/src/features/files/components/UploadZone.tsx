import { Upload, Image } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { pickFiles, isTauri } from "@/lib/platform";

interface UploadZoneProps {
  onFilesAdded?: (paths: string[]) => void;
}

export function UploadZone({ onFilesAdded }: UploadZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  // Ref-tracked version so the Tauri event closure always sees the current value
  const isDragOverRef = useRef(false);
  // Counter to handle nested dragenter/dragleave on child elements
  const dragCountRef = useRef(0);

  const setDrag = (val: boolean) => {
    isDragOverRef.current = val;
    setIsDragOver(val);
  };

  const handleClick = async () => {
    const selected = await pickFiles({ multiple: true });
    if (selected && selected.length > 0) {
      const paths = selected.map((f) => (typeof f === "string" ? f : f.name));
      onFilesAdded?.(paths);
    }
  };

  // Visual feedback — these DOM events fire even in Tauri's webview
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCountRef.current++;
    setDrag(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault(); // required to allow drop
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCountRef.current--;
    if (dragCountRef.current <= 0) {
      dragCountRef.current = 0;
      setDrag(false);
    }
  };

  // Browser-only drop (in Tauri the OS intercepts this; paths come from the effect below)
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCountRef.current = 0;
    setDrag(false);
    if (!isTauri()) {
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) onFilesAdded?.(files.map((f) => f.name));
    }
  };

  // Tauri: listen for native file-drop events on the window.
  // We only forward paths when the zone itself is in drag-over state,
  // so drops elsewhere on the window don't accidentally trigger uploads.
  useEffect(() => {
    if (!isTauri()) return;

    let unlisten: (() => void) | undefined;

    (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      unlisten = await win.onDragDropEvent((event) => {
        const type = event.payload.type;
        if (type === "drop") {
          if (isDragOverRef.current) {
            onFilesAdded?.((event.payload as { paths: string[] }).paths);
          }
          dragCountRef.current = 0;
          setDrag(false);
        } else if (type === "leave") {
          dragCountRef.current = 0;
          setDrag(false);
        }
      });
    })();

    return () => {
      unlisten?.();
    };
  }, [onFilesAdded]);

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="mb-4 flex items-center gap-2">
        <Image className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-foreground">Upload</h2>
      </div>

      <div
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") handleClick();
        }}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        role="button"
        tabIndex={0}
        className={`cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
          isDragOver
            ? "border-primary bg-primary/10"
            : "border-border hover:border-muted-foreground hover:bg-muted"
        }`}
      >
        <Upload className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
        <p className="mb-1 text-foreground">
          {isDragOver ? "Drop files here" : "Click to browse or drag & drop files"}
        </p>
        <p className="text-muted-foreground">Supports multiple files</p>
      </div>
    </div>
  );
}
