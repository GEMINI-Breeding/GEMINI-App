/**
 * List the entry names in a ZIP by reading its central directory — enough
 * for specs to check what a download contains without a zip dependency.
 * Handles ZIP64 archives only as far as the backend writes them (entry
 * sizes may be ZIP64; the directory itself stays under 4 GB here).
 */
export function zipEntryNames(buf: Buffer): string[] {
  // End-of-central-directory record: signature 0x06054b50, scanned from
  // the end (it may be followed by a comment of up to 64 KB).
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error("not a zip: no end-of-central-directory")
  let count = buf.readUInt16LE(eocd + 10)
  let offset = buf.readUInt32LE(eocd + 16)
  if (count === 0xffff || offset === 0xffffffff) {
    // ZIP64 EOCD locator sits right before the EOCD.
    const loc = eocd - 20
    if (buf.readUInt32LE(loc) !== 0x07064b50)
      throw new Error("bad zip64 locator")
    const z64 = Number(buf.readBigUInt64LE(loc + 8))
    count = Number(buf.readBigUInt64LE(z64 + 32))
    offset = Number(buf.readBigUInt64LE(z64 + 48))
  }
  const names: string[] = []
  let p = offset
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50)
      throw new Error("bad central header")
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    names.push(buf.toString("utf8", p + 46, p + 46 + nameLen))
    p += 46 + nameLen + extraLen + commentLen
  }
  return names
}
