import { useState } from "react"
import { Upload, FolderOpen } from "lucide-react"
import { NavSidebar } from "@/components/Common/NavSidebar"
import { ManageData } from "./ManageData"
import { UploadData } from "./UploadData"

const NAV_GROUPS = [
  { items: [
    { id: "upload", label: "Upload", icon: Upload },
    { id: "manage", label: "Manage", icon: FolderOpen },
  ]},
] as const

type Section = "upload" | "manage"

export function FilesDashboard() {
  const [active, setActive] = useState<Section>("upload")

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 64px)" }}>
      <div className="flex-shrink-0 px-6 pt-5 pb-3 border-b">
        <h1 className="text-xl font-semibold">Files</h1>
        <p className="text-muted-foreground text-sm">Upload and manage your data</p>
      </div>
      <div className="flex flex-1 min-h-0">
        <NavSidebar
          groups={NAV_GROUPS}
          activeId={active}
          onSelect={(id) => setActive(id as Section)}
        />
        <div className="flex-1 overflow-auto px-6 py-6">
          {active === "upload" && <UploadData />}
          {active === "manage" && <ManageData />}
        </div>
      </div>
    </div>
  )
}
