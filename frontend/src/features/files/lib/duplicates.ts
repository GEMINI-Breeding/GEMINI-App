/**
 * Which of the files about to be uploaded are already stored for this
 * upload's destination.
 *
 * Two layouts:
 *  - Most data types write straight into one folder
 *    (`…/{sensor}/Orthomosaic/{name}`), so a same-named file there would be
 *    overwritten without a word.
 *  - Image uploads get a per-batch folder (`…/{sensor}/{batchId}/Images/`),
 *    so nothing is overwritten — but the same image uploaded in an earlier
 *    batch would be stored twice and fed to ODM twice. `batchRoot` is the
 *    folder above the batch ids; any `{batchRoot}/*\/Images/{name}` counts.
 */
export function existingUploadNames(
  fileNames: string[],
  listedObjects: string[],
  targetRootDir: string,
  batchRoot?: string,
): string[] {
  if (batchRoot) {
    const root = `${batchRoot.replace(/\/+$/, "")}/`
    const earlier = new Set(
      listedObjects
        .filter((o) => o.startsWith(root))
        .map((o) => o.slice(root.length).split("/"))
        // {batchId}/Images/{name}
        .filter((p) => p.length === 3 && p[1] === "Images")
        .map((p) => p[2]),
    )
    return fileNames.filter((n) => earlier.has(n))
  }
  const dir = targetRootDir.replace(/\/+$/, "")
  const present = new Set(listedObjects)
  return fileNames.filter((n) => present.has(`${dir}/${n}`))
}
