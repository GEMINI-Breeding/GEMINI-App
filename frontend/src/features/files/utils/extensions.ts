// Image extensions accepted when a data type declares fileType = "image/*".
export const IMAGE_EXTS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".tif",
  ".tiff",
  ".webp",
  ".bmp",
  ".gif",
])

/**
 * Match a file path against a data type's fileType descriptor.
 *
 *  - `"*"`          → always accept.
 *  - `"image/*"`    → accept any IMAGE_EXTS member.
 *  - Anything else  → comma-separated list of extensions (".csv,.xlsx,.xls")
 *                     matched case-insensitively. `.tif` also accepts `.tiff`.
 */
export function isExtensionAllowed(filePath: string, fileType: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase()
  if (fileType === "*") return true
  if (fileType === "image/*") return IMAGE_EXTS.has(ext)
  const allowed = fileType.split(",").map((s) => s.trim().toLowerCase())
  return allowed.some((a) => ext === a) || (allowed.includes(".tif") && ext === ".tiff")
}
