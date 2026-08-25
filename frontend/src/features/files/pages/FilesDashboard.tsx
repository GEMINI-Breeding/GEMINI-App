import { useNavigate, useSearch } from "@tanstack/react-router"
import { Upload, FolderOpen, Compass } from "lucide-react"
import { NavSidebar } from "@/components/Common/NavSidebar"
import { GuidedUpload } from "./GuidedUpload"
import { ManageData } from "./ManageData"
import { UploadData } from "./UploadData"

const NAV_GROUPS = [
  { items: [
    { id: "upload", label: "Upload", icon: Upload },
    { id: "guided", label: "Guided Upload", icon: Compass },
    { id: "manage", label: "Manage", icon: FolderOpen },
  ]},
] as const

type Section = "upload" | "guided" | "manage"

export function FilesDashboard() {
  const navigate = useNavigate()
  const { section } = useSearch({ from: "/_layout/files/" })
  const active: Section = section ?? "upload"

  function setActive(id: Section) {
    navigate({
      to: "/files",
      // Switching top-level tab abandons whatever Guided Upload sub-view
      // was selected — only carry section forward.
      search: { section: id },
    })
  }

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
          {active === "guided" && <GuidedUpload />}
          {active === "manage" && <ManageData />}
        </div>
      </div>
    </div>
  )
}
