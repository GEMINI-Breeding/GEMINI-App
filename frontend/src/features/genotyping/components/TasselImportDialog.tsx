/**
 * Bring a GWAS run done in TASSEL into this study. The person picks
 * TASSEL's GLM/MLM stats table (for an MLM export, the file ending in
 * _2.txt); the traits it holds are read from the file here, one is chosen,
 * the file is uploaded and a job turns it into a run like the app's own
 * (Manhattan and QQ plots, inflation, strongest markers). Nothing is
 * recomputed: the p-values are TASSEL's.
 */
import { useQueryClient } from "@tanstack/react-query"
import { FileUp, Loader2 } from "lucide-react"
import { useState } from "react"

import { JobsService } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import useCustomToast from "@/hooks/useCustomToast"
import { uploadFileChunked } from "@/lib/chunkedUpload"

const REQUIRED = ["Trait", "Marker", "Chr", "Pos", "p"]

/** The traits in a TASSEL stats table (its Trait column), read in pieces so a
 *  file of hundreds of MB never sits in memory whole. Throws when the file is
 *  not a stats table. */
function blobBytes(b: Blob): Promise<ArrayBuffer> {
  if (typeof b.arrayBuffer === "function") return b.arrayBuffer()
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as ArrayBuffer)
    r.onerror = () => reject(r.error)
    r.readAsArrayBuffer(b)
  })
}

export async function readTasselTraits(file: Blob): Promise<string[]> {
  const PIECE = 4 * 1024 * 1024
  const decoder = new TextDecoder()
  let rest = ""
  let header: string[] | null = null
  let col = 0
  const seen = new Set<string>()
  for (let at = 0; at < file.size || at === 0; at += PIECE) {
    const last = at + PIECE >= file.size
    const bytes = await blobBytes(file.slice(at, at + PIECE))
    const lines = (rest + decoder.decode(bytes, { stream: !last })).split(
      /\r?\n/,
    )
    rest = last ? "" : (lines.pop() ?? "")
    for (const line of lines) {
      if (!line) continue
      if (!header) {
        header = line.split("\t")
        if (!REQUIRED.every((c) => header?.includes(c)))
          throw new Error(
            "This is not a TASSEL GLM/MLM stats table (columns Trait, Marker, Chr, Pos, p). For an MLM export, use the file ending in _2.txt.",
          )
        col = header.indexOf("Trait")
        continue
      }
      const t = line.split("\t", col + 1)[col]
      if (t) seen.add(t)
    }
    if (last) break
  }
  return [...seen]
}

export function TasselImportDialog({
  studyId,
  open,
  onOpenChange,
}: {
  studyId: string
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const qc = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [file, setFile] = useState<File | null>(null)
  const [traits, setTraits] = useState<string[]>([])
  const [trait, setTrait] = useState("")
  const [label, setLabel] = useState("")
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)

  function reset() {
    setFile(null)
    setTraits([])
    setTrait("")
    setLabel("")
    setError(null)
    setProgress(null)
  }

  async function pick(f: File | null) {
    reset()
    setFile(f)
    if (!f) return
    setReading(true)
    try {
      const t = await readTasselTraits(f)
      if (t.length === 0) throw new Error("The table has no rows.")
      setTraits(t)
      setTrait(t[0])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setReading(false)
    }
  }

  async function submit() {
    if (!file || !trait) return
    setError(null)
    try {
      const objectName = `gwas/imports/tassel/${Date.now()}-${file.name}`
      setProgress(0)
      await uploadFileChunked({
        file,
        fileIdentifier: `tassel:${file.name}:${file.size}:${file.lastModified}`,
        objectName,
        onProgress: (p) => setProgress(Math.round(p.fraction * 100)),
      })
      await JobsService.apiJobsSubmitSubmitJob({
        requestBody: {
          job_type: "RUN_GWAS",
          parameters: {
            source: "tassel",
            study_id: studyId,
            stats_path: objectName,
            tassel_trait: trait,
            trait_label: label.trim() || trait,
            tassel_model: "TASSEL MLM",
          },
        },
      })
      qc.invalidateQueries({ queryKey: ["jobs"] })
      showSuccessToast(`Importing TASSEL results for ${label.trim() || trait}`)
      reset()
      onOpenChange(false)
    } catch (e) {
      setProgress(null)
      showErrorToast(e instanceof Error ? e.message : "Import failed")
    }
  }

  const busy = reading || progress !== null
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!busy) {
          if (!v) reset()
          onOpenChange(v)
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import TASSEL results</DialogTitle>
          <DialogDescription>
            A GWAS run in TASSEL (GLM or MLM) shows here next to the app's own
            runs, with Manhattan and QQ plots. Pick TASSEL's stats table: for an
            MLM export, the file ending in <code>_2.txt</code>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="tassel-file">Stats file</Label>
            <Input
              id="tassel-file"
              type="file"
              accept=".txt,.tsv"
              data-testid="tassel-file"
              disabled={busy}
              onChange={(e) => pick(e.target.files?.[0] ?? null)}
            />
            {reading && (
              <p className="text-muted-foreground flex items-center gap-1 text-xs">
                <Loader2 className="h-3 w-3 animate-spin" /> Reading the traits
                in {file?.name}…
              </p>
            )}
            {error && (
              <p className="text-xs text-red-600" data-testid="tassel-error">
                {error}
              </p>
            )}
          </div>
          {traits.length > 0 && (
            <>
              <div className="space-y-2">
                <Label htmlFor="tassel-trait">
                  Trait{" "}
                  <span className="text-muted-foreground text-xs font-normal">
                    ({traits.length} in this file; each import is one run)
                  </span>
                </Label>
                <select
                  id="tassel-trait"
                  data-testid="tassel-trait"
                  value={trait}
                  onChange={(e) => setTrait(e.target.value)}
                  disabled={busy}
                  className="border-input bg-background flex h-9 w-full rounded-md border px-3 py-1 text-sm"
                >
                  {traits.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tassel-label">Name to show (optional)</Label>
                <Input
                  id="tassel-label"
                  placeholder={trait}
                  value={label}
                  disabled={busy}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>
            </>
          )}
          {progress !== null && (
            <div className="space-y-1">
              <div className="bg-muted h-2 w-full overflow-hidden rounded">
                <div
                  className="bg-primary h-full transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-muted-foreground text-xs">
                Uploading {file?.name}: {progress}%
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            data-testid="tassel-import"
            disabled={!file || !trait || busy}
            onClick={submit}
          >
            <FileUp className="mr-1.5 h-4 w-4" /> Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
