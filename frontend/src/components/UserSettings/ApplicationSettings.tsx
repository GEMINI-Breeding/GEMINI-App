import {
  AlertCircle,
  CheckCircle,
  HardDrive,
  Info,
  RefreshCw,
} from "lucide-react"
import { useCallback, useState } from "react"
import { NavSidebar } from "@/components/Common/NavSidebar"
import { Button } from "@/components/ui/button"
import { CURRENT_VERSION, checkForUpdates } from "@/hooks/useUpdateChecker"
import { openUrl } from "@/lib/platform"
import { LegacyImport } from "./LegacyImport"
import { StackSettings } from "./StackSettings"

type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "up_to_date"; version: string }
  | { kind: "update_available"; version: string; downloadUrl: string }
  | { kind: "error"; message: string }

function AboutSettings() {
  const [status, setStatus] = useState<UpdateStatus>({ kind: "idle" })

  const handleCheck = useCallback(async () => {
    setStatus({ kind: "checking" })
    const result = await checkForUpdates()
    if (result.status === "update_available") {
      setStatus({
        kind: "update_available",
        version: result.version,
        downloadUrl: result.downloadUrl,
      })
    } else if (result.status === "up_to_date") {
      setStatus({ kind: "up_to_date", version: result.version })
    } else {
      setStatus({ kind: "error", message: result.message })
    }
  }, [])

  return (
    <div className="max-w-xl flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Version</span>
        <span className="text-muted-foreground text-sm font-mono">
          {CURRENT_VERSION}
        </span>
      </div>

      <div className="flex flex-col gap-3">
        <Button
          variant="outline"
          className="w-fit"
          onClick={handleCheck}
          disabled={status.kind === "checking"}
        >
          <RefreshCw
            className={`h-4 w-4 mr-2 ${status.kind === "checking" ? "animate-spin" : ""}`}
          />
          {status.kind === "checking" ? "Checking…" : "Check for Updates"}
        </Button>

        {status.kind === "up_to_date" && (
          <div className="flex items-center gap-2 text-sm text-green-600">
            <CheckCircle className="h-4 w-4" />
            GEMI is up to date (latest: {status.version})
          </div>
        )}
        {status.kind === "update_available" && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm text-blue-600">
              <Info className="h-4 w-4" />
              {status.version} is available
            </div>
            <Button
              variant="default"
              className="w-fit"
              onClick={() => openUrl(status.downloadUrl)}
            >
              Download Update
            </Button>
          </div>
        )}
        {status.kind === "error" && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {status.message}
          </div>
        )}
      </div>
    </div>
  )
}

const SETTINGS_NAV_GROUPS = [
  {
    items: [
      { id: "data", label: "Data & services", icon: HardDrive },
      { id: "about", label: "About", icon: Info },
    ],
  },
] as const

type SettingsSection = "data" | "about"

const ApplicationSettings = () => {
  const [active, setActive] = useState<SettingsSection>("data")

  return (
    <div className="flex flex-1 min-h-0">
      <NavSidebar
        groups={SETTINGS_NAV_GROUPS}
        activeId={active}
        onSelect={(id) => setActive(id as SettingsSection)}
      />
      <div className="flex-1 overflow-auto px-6 py-6">
        {active === "data" && (
          <>
            <StackSettings />
            <LegacyImport />
          </>
        )}
        {active === "about" && <AboutSettings />}
      </div>
    </div>
  )
}

export default ApplicationSettings
