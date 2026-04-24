import { Download, EllipsisVertical, GitMerge, Images, Pencil } from "lucide-react"
import { downloadFile } from "@/lib/platform"
import { useState } from "react"

import type { FileUploadPublic } from "@/client"
import { OpenAPI } from "@/client"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useProcess } from "@/contexts/ProcessContext"
import DeleteUpload from "./DeleteUpload"
import { EditUploadDialog } from "./EditUploadDialog"
import { ImageViewerDialog } from "./ImageViewerDialog"
import { MultispectralViewer } from "./MultispectralViewer"
import { SensorMatchViewer } from "./SensorMatchViewer"

const IMAGE_DATA_TYPES = new Set(["Image Data", "Farm-ng Binary File", "Orthomosaic"])
const MULTISPECTRAL_TYPE = "Multispectral Data"
const MATCHABLE_TYPES = new Set(["Multispectral Data", "Thermal Data"])

interface UploadActionsMenuProps {
  upload: FileUploadPublic
}

async function downloadZip(upload: FileUploadPublic) {
  const base = (window as any).__GEMI_BACKEND_URL__ ?? OpenAPI.BASE ?? ""
  const token =
    typeof OpenAPI.TOKEN === "function"
      ? await (OpenAPI.TOKEN as () => Promise<string>)()
      : OpenAPI.TOKEN ?? ""

  const label = [upload.experiment, upload.date].filter(Boolean).join("_") || "upload"
  const filename = `${label}.zip`
  const url = `${base}/api/v1/files/${upload.id}/download-zip`
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined
  await downloadFile(url, filename, "GET", [{ name: "ZIP archive", extensions: ["zip"] }], headers)
}

export const UploadActionsMenu = ({ upload }: UploadActionsMenuProps) => {
  const [menuOpen, setMenuOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [msViewerOpen, setMsViewerOpen] = useState(false)
  const [matchViewerOpen, setMatchViewerOpen] = useState(false)
  const { addProcess, updateProcess } = useProcess()

  const canView = IMAGE_DATA_TYPES.has(upload.data_type)
  const isMultispectral = upload.data_type === MULTISPECTRAL_TYPE
  const canMatch = MATCHABLE_TYPES.has(upload.data_type)
  const viewerTitle = [upload.experiment, upload.location, upload.population, upload.date]
    .filter(Boolean)
    .join(" · ")

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon">
            <EllipsisVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canView && (
            <DropdownMenuItem
              onClick={() => {
                setMenuOpen(false)
                setViewerOpen(true)
              }}
            >
              <Images className="mr-2 h-4 w-4" />
              View images
            </DropdownMenuItem>
          )}
          {isMultispectral && (
            <DropdownMenuItem
              onClick={() => {
                setMenuOpen(false)
                setMsViewerOpen(true)
              }}
            >
              <Images className="mr-2 h-4 w-4" />
              View bands
            </DropdownMenuItem>
          )}
          {canMatch && (
            <DropdownMenuItem
              onClick={() => {
                setMenuOpen(false)
                setMatchViewerOpen(true)
              }}
            >
              <GitMerge className="mr-2 h-4 w-4" />
              Match with RGB
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() => {
              setMenuOpen(false)
              const label = [upload.experiment, upload.date].filter(Boolean).join(" · ") || "upload"
              const pid = addProcess({
                type: "processing",
                status: "running",
                title: `Downloading ZIP — ${label}`,
                items: [],
                progress: 0,
                message: "Preparing archive…",
              })
              downloadZip(upload)
                .then(() => updateProcess(pid, { status: "completed", progress: 100, message: "Saved" }))
                .catch((e: any) => updateProcess(pid, { status: "error", message: e?.message ?? "Download failed" }))
            }}
          >
            <Download className="mr-2 h-4 w-4" />
            Download ZIP
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              setMenuOpen(false)
              setEditOpen(true)
            }}
          >
            <Pencil className="mr-2 h-4 w-4" />
            Edit fields
          </DropdownMenuItem>
          <DeleteUpload id={upload.id} onSuccess={() => setMenuOpen(false)} />
        </DropdownMenuContent>
      </DropdownMenu>

      <EditUploadDialog
        upload={upload}
        open={editOpen}
        onClose={() => setEditOpen(false)}
      />

      {viewerOpen && (
        <ImageViewerDialog
          uploadId={String(upload.id)}
          title={viewerTitle}
          onClose={() => setViewerOpen(false)}
        />
      )}

      {msViewerOpen && (
        <MultispectralViewer
          uploadId={String(upload.id)}
          title={viewerTitle}
          onClose={() => setMsViewerOpen(false)}
        />
      )}

      {matchViewerOpen && (
        <SensorMatchViewer
          uploadId={String(upload.id)}
          uploadDataType={upload.data_type}
          title={viewerTitle}
          onClose={() => setMatchViewerOpen(false)}
        />
      )}
    </>
  )
}
