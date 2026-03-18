import { Download, EllipsisVertical, Images, Pencil } from "lucide-react"
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
import DeleteUpload from "./DeleteUpload"
import { EditUploadDialog } from "./EditUploadDialog"
import { ImageViewerDialog } from "./ImageViewerDialog"

const IMAGE_DATA_TYPES = new Set(["Image Data", "Farm-ng Binary File", "Orthomosaic"])

interface UploadActionsMenuProps {
  upload: FileUploadPublic
}

async function downloadZip(upload: FileUploadPublic) {
  const base = (window as any).__GEMI_BACKEND_URL__ ?? OpenAPI.BASE ?? ""
  const token =
    typeof OpenAPI.TOKEN === "function"
      ? await (OpenAPI.TOKEN as () => Promise<string>)()
      : OpenAPI.TOKEN ?? ""

  const res = await fetch(`${base}/api/v1/files/${upload.id}/download-zip`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new Error(`Download failed: ${res.status}`)

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  const disposition = res.headers.get("Content-Disposition")
  const match = disposition?.match(/filename="([^"]+)"/)
  a.download = match?.[1] ?? "download.zip"
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export const UploadActionsMenu = ({ upload }: UploadActionsMenuProps) => {
  const [menuOpen, setMenuOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const canView = IMAGE_DATA_TYPES.has(upload.data_type)
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
          <DropdownMenuItem
            disabled={downloading}
            onClick={async () => {
              setMenuOpen(false)
              setDownloading(true)
              try {
                await downloadZip(upload)
              } finally {
                setDownloading(false)
              }
            }}
          >
            <Download className="mr-2 h-4 w-4" />
            {downloading ? "Downloading…" : "Download ZIP"}
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
    </>
  )
}
