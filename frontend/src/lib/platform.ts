/** Returns true when running inside Tauri (desktop), false in a plain browser. */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Download a URL as a file.
 * - In Tauri: shows a native "Save As" dialog then writes to disk.
 * - In browser: fetches the resource and triggers a browser download.
 * Returns false if the user cancelled (Tauri save dialog only).
 */
export async function downloadFile(
  url: string,
  filename: string,
  method: "GET" | "POST" = "GET",
  filters?: { name: string; extensions: string[] }[],
): Promise<boolean> {
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { invoke } = await import("@tauri-apps/api/core");
    const dest = await save({ defaultPath: filename, filters });
    if (!dest) return false;
    // absoluteApiUrl is caller's responsibility — pass absolute URL
    await invoke("download_to_file", { url, dest, method });
    return true;
  }

  // Browser fallback: fetch → blob → anchor click
  const res = await fetch(url, { method });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
  return true;
}

/**
 * Open a native file picker.
 * - In Tauri: uses the plugin-dialog `open()`.
 * - In browser: creates a hidden <input type="file"> and resolves with the File objects.
 */
export async function pickFiles(opts?: {
  multiple?: boolean;
  accept?: string; // e.g. "image/*,.csv"
}): Promise<File[] | string[] | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ multiple: opts?.multiple ?? false, directory: false });
    if (!selected) return null;
    return Array.isArray(selected) ? selected : [selected];
  }

  // Browser fallback
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = opts?.multiple ?? false;
    if (opts?.accept) input.accept = opts.accept;
    input.onchange = () => {
      const files = input.files ? Array.from(input.files) : [];
      resolve(files.length ? files : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}
