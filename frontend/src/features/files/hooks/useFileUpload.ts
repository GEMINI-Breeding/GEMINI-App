import { useCallback } from "react";
import { useProcess } from "@/contexts/ProcessContext";
import useCustomToast from "@/hooks/useCustomToast";
import type { ProcessItem } from "@/types/process";
import { dataTypes } from "@/config/dataTypes";

interface UploadParams {
  filePaths: string[];
  dataType: string;
  targetRootDir: string;
  reupload?: boolean;
  formValues?: Record<string, string>;
  /** Called with absolute dest paths of all successfully uploaded files */
  onComplete?: (destPaths: string[]) => void;
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function useFileUpload() {
  const { addProcess, updateProcess, updateProcessItem } = useProcess();
  const { showErrorToastWithCopy } = useCustomToast();

  const uploadFiles = useCallback(
    async ({
      filePaths,
      dataType,
      targetRootDir,
      reupload = false,
      formValues = {},
      onComplete,
    }: UploadParams) => {
      const items: ProcessItem[] = filePaths.map((p, i) => ({
        id: String(i),
        name: fileNameFromPath(p),
        status: "pending" as const,
      }));

      const abortController = new AbortController();

      const processId = addProcess({
        type: "file_upload",
        status: "running",
        title: `Uploading ${filePaths.length} file(s)`,
        items,
        cancel: () => abortController.abort(),
      });

      const token = localStorage.getItem("access_token") || "";
      const baseUrl = import.meta.env.VITE_API_URL;

      try {
        const response = await fetch(
          `${baseUrl}/api/v1/files/copy-local-stream`,
          {
            method: "POST",
            signal: abortController.signal,
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              file_paths: filePaths,
              data_type: dataType,
              target_root_dir: targetRootDir,
              reupload,
              experiment: formValues.experiment || null,
              location: formValues.location || null,
              population: formValues.population || null,
              date: formValues.date || null,
              platform: formValues.platform || (dataTypes[dataType as keyof typeof dataTypes] as any)?.defaultPlatform || null,
              sensor: formValues.sensor || (dataTypes[dataType as keyof typeof dataTypes] as any)?.defaultSensor || null,
            }),
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          const errorMsg = `Server error: ${response.status} - ${errorText}`;
          updateProcess(processId, {
            status: "error",
            error: errorMsg,
          });
          showErrorToastWithCopy(errorMsg);
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          updateProcess(processId, {
            status: "error",
            error: "No response stream available",
          });
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";
        const completedDestPaths: string[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          // Keep last potentially incomplete line in buffer
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;

            try {
              const data = JSON.parse(trimmed.slice(6));

              switch (data.event) {
                case "start":
                  // Items already set up — mark all as pending (already done)
                  break;

                case "progress":
                  updateProcessItem(processId, String(data.index), {
                    status: data.status,
                  });
                  if (data.status === "completed" && data.dest_path) {
                    completedDestPaths.push(data.dest_path as string);
                  }
                  break;

                case "error":
                  updateProcessItem(processId, String(data.index), {
                    status: "error",
                    error: data.message,
                  });
                  break;

                case "extraction_progress":
                  if (data.phase === "complete") {
                    updateProcessItem(processId, String(data.index), {
                      status: "completed",
                      label: undefined,
                    });
                    updateProcess(processId, { message: undefined });
                  } else if (data.phase === "error") {
                    updateProcessItem(processId, String(data.index), {
                      status: "error",
                      error: data.message || "Extraction failed",
                    });
                    updateProcess(processId, { message: undefined });
                  } else {
                    updateProcessItem(processId, String(data.index), {
                      status: "running",
                      label: data.message || "Extracting…",
                    });
                    updateProcess(processId, {
                      message: data.message || "Extracting…",
                    });
                  }
                  break;

                case "complete":
                  updateProcess(processId, {
                    status: "completed",
                    completedAt: new Date(),
                    title: `Uploaded ${data.count} file(s)`,
                  });
                  onComplete?.(completedDestPaths);
                  break;
              }
            } catch {
              // Ignore malformed lines
            }
          }
        }

        // Stream ended — the "complete" event handler above already
        // marked the process. Nothing else to do here.
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          updateProcess(processId, { status: "error", error: "Cancelled", cancel: undefined });
        } else {
          const errorMsg = err instanceof Error ? err.message : String(err);
          updateProcess(processId, { status: "error", error: errorMsg });
          showErrorToastWithCopy(errorMsg);
        }
      }
    },
    [addProcess, updateProcess, updateProcessItem, showErrorToastWithCopy]
  );

  return { uploadFiles };
}
