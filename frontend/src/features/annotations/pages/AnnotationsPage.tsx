/**
 * AnnotationsPage — manage YOLO-format training labels and CVAT linkage.
 *
 * Backend (`backend/gemini/rest_api/controllers/annotations.py`):
 *   POST /api/annotations/check_labels   — given dirPath + fileList, returns
 *                                          the subset that doesn't yet exist.
 *   POST /api/annotations/upload_labels  — multipart upload of one label file
 *                                          to the given dirPath.
 *   POST /api/annotations/start_cvat     — currently a stub returning a
 *                                          documentation URL; CVAT itself is
 *                                          deployed alongside the stack.
 *
 * The page targets the operator who's running an annotation cycle:
 *   1. drop a folder of YOLO `.txt` labels into the dropzone,
 *   2. preview which already exist on the server (via /check_labels),
 *   3. upload only the new ones,
 *   4. follow the CVAT link to label whatever's missing.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ExternalLink, Upload } from "lucide-react"
import { useMemo, useRef, useState } from "react"

import { AnnotationsService, FilesService, type FileMetadata } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import useCustomToast from "@/hooks/useCustomToast"
import { isLoggedIn } from "@/lib/auth"

const DEFAULT_BUCKET = "gemini"

export function AnnotationsPage() {
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const qc = useQueryClient()

  const [dirPath, setDirPath] = useState("Labels/")
  const [picked, setPicked] = useState<File[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const labelsListing = useQuery<FileMetadata[], Error>({
    queryKey: ["annotations", "labels-list", dirPath],
    queryFn: async () => {
      try {
        const res = await FilesService.apiFilesListFilePathListFiles({
          filePath: `${DEFAULT_BUCKET}/${dirPath.replace(/^\//, "")}`,
        })
        return ((res as FileMetadata[] | null) ?? []).filter((f) =>
          /\.(txt|zip)$/i.test(f.object_name ?? ""),
        )
      } catch {
        return []
      }
    },
    enabled: isLoggedIn() && Boolean(dirPath),
    refetchInterval: 30_000,
  })

  const checkLabels = useMutation<string[], Error, string[]>({
    mutationFn: (fileList) =>
      AnnotationsService.apiAnnotationsCheckLabelsCheckExistingLabels({
        requestBody: { dirPath, fileList },
      }) as Promise<string[]>,
  })

  const uploadOne = useMutation<unknown, Error, File>({
    mutationFn: (file) =>
      AnnotationsService.apiAnnotationsUploadLabelsUploadTraitLabels({
        formData: { dirPath, files: file },
      }),
  })

  const cvat = useMutation<{ status?: string; message?: string; [k: string]: unknown }, Error>({
    mutationFn: () =>
      AnnotationsService.apiAnnotationsStartCvatStartCvat() as Promise<{
        status?: string
        message?: string
      }>,
    onSuccess: (resp) => {
      showSuccessToast(resp.status ?? "OK")
    },
    onError: (err) => showErrorToast(err.message),
  })

  function pickFiles() {
    inputRef.current?.click()
  }

  function onFiles(ev: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(ev.target.files ?? [])
    setPicked(list)
    ev.target.value = ""
    if (list.length > 0) {
      checkLabels.mutate(list.map((f) => f.name))
    }
  }

  const missingNames = useMemo<Set<string>>(() => {
    return new Set(checkLabels.data ?? [])
  }, [checkLabels.data])

  async function uploadAllMissing() {
    const toUpload = picked.filter((f) => missingNames.size === 0 || missingNames.has(f.name))
    if (toUpload.length === 0) return
    let ok = 0
    let fail = 0
    for (const file of toUpload) {
      try {
        await uploadOne.mutateAsync(file)
        ok++
      } catch {
        fail++
      }
    }
    if (fail > 0) showErrorToast(`Uploaded ${ok}, ${fail} failed`)
    else showSuccessToast(`Uploaded ${ok} label(s)`)
    qc.invalidateQueries({ queryKey: ["annotations", "labels-list"] })
    setPicked([])
    checkLabels.reset()
  }

  return (
    <div className="container max-w-5xl space-y-4 px-4 py-6">
      <header>
        <h1 className="text-2xl font-semibold">Annotations</h1>
        <p className="text-muted-foreground text-sm">
          Upload YOLO-format training labels and link out to CVAT for
          interactive annotation.
        </p>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">CVAT</CardTitle>
          <CardDescription>
            CVAT runs as a separate Docker service in this deployment. The
            backend stub returns the configured URL.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Button
            data-testid="annotations-cvat-open"
            variant="outline"
            onClick={() => cvat.mutate()}
            disabled={cvat.isPending}
          >
            <ExternalLink className="mr-1.5 h-4 w-4" />
            {cvat.isPending ? "Checking…" : "Open CVAT"}
          </Button>
          {cvat.data && (
            <span className="text-xs text-muted-foreground">
              {cvat.data.status} {cvat.data.message ? `— ${cvat.data.message}` : ""}
            </span>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Upload labels</CardTitle>
          <CardDescription>
            Files land at <code>{dirPath}{"<filename>"}</code> in MinIO.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="dirpath">Destination prefix</Label>
            <Input
              id="dirpath"
              data-testid="annotations-dirpath"
              value={dirPath}
              onChange={(e) => setDirPath(e.target.value)}
              placeholder="Labels/"
            />
          </div>

          <div>
            <input
              ref={inputRef}
              type="file"
              multiple
              hidden
              accept=".txt,.zip"
              data-testid="annotations-picker"
              onChange={onFiles}
            />
            <Button variant="outline" onClick={pickFiles} data-testid="annotations-pick">
              <Upload className="mr-1.5 h-4 w-4" /> Choose label files
            </Button>
            {picked.length > 0 && (
              <span className="ml-2 text-xs text-muted-foreground">
                {picked.length} file(s) selected
              </span>
            )}
          </div>

          {picked.length > 0 && (
            <div className="rounded border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead className="w-32">Size</TableHead>
                    <TableHead className="w-32 text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {picked.map((f) => {
                    const isMissing = checkLabels.isSuccess
                      ? missingNames.has(f.name)
                      : null
                    return (
                      <TableRow key={f.name} data-testid="annotations-pending-row">
                        <TableCell className="font-mono text-xs">{f.name}</TableCell>
                        <TableCell className="text-xs">{f.size} B</TableCell>
                        <TableCell className="text-right">
                          {isMissing === null ? (
                            <Badge variant="outline">checking…</Badge>
                          ) : isMissing ? (
                            <Badge variant="default">new</Badge>
                          ) : (
                            <Badge variant="secondary">already on server</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          <Button
            data-testid="annotations-upload"
            disabled={picked.length === 0 || uploadOne.isPending}
            onClick={uploadAllMissing}
          >
            {uploadOne.isPending ? "Uploading…" : `Upload ${missingNames.size > 0 ? missingNames.size : picked.length}`}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Existing labels</CardTitle>
          <CardDescription>
            Files currently under <code>{dirPath}</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Path</TableHead>
                  <TableHead className="w-32">Size</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {labelsListing.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={2} className="py-6 text-center text-muted-foreground text-sm">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : (labelsListing.data ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} className="py-6 text-center text-muted-foreground text-sm">
                      No labels yet at <code>{dirPath}</code>.
                    </TableCell>
                  </TableRow>
                ) : (
                  (labelsListing.data ?? []).map((f) => (
                    <TableRow key={f.object_name} data-testid="annotations-existing-row">
                      <TableCell className="font-mono text-xs">{f.object_name}</TableCell>
                      <TableCell className="text-xs">{f.size ?? "—"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
