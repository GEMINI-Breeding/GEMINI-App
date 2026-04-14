import { useEffect, useState, useCallback } from "react"

import { OpenAPI } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Settings, Server, Info, RefreshCw, CheckCircle, AlertCircle } from "lucide-react"
import { NavSidebar } from "@/components/Common/NavSidebar"
import { openUrl } from "@/lib/platform"
import { checkForUpdates, CURRENT_VERSION } from "@/hooks/useUpdateChecker"

async function getToken(): Promise<string> {
  return typeof OpenAPI.TOKEN === "function"
    ? await (OpenAPI.TOKEN as () => Promise<string>)()
    : OpenAPI.TOKEN ?? ""
}

async function fetchDataRoot(): Promise<string> {
  const token = await getToken()
  const res = await fetch(`${OpenAPI.BASE}/api/v1/settings/data-root`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error("Failed to fetch data root")
  const data = await res.json()
  return data.value as string
}

async function saveDataRoot(value: string): Promise<string> {
  const token = await getToken()
  const res = await fetch(`${OpenAPI.BASE}/api/v1/settings/data-root`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ value }),
  })
  if (!res.ok) throw new Error("Failed to save data root")
  const data = await res.json()
  return data.value as string
}

interface DockerResources {
  cpus: number | null
  memory_gb: number | null
  swap_gb: number | null
}

interface SystemInfo {
  cpu_count: number
  total_ram_gb: number
}

async function fetchSystemInfo(): Promise<SystemInfo> {
  const token = await getToken()
  const res = await fetch(`${OpenAPI.BASE}/api/v1/settings/system-info`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error("Failed to fetch system info")
  return res.json() as Promise<SystemInfo>
}

async function fetchDockerResources(): Promise<DockerResources> {
  const token = await getToken()
  const res = await fetch(`${OpenAPI.BASE}/api/v1/settings/docker-resources`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error("Failed to fetch Docker resources")
  return res.json() as Promise<DockerResources>
}

async function saveDockerResources(body: DockerResources): Promise<DockerResources> {
  const token = await getToken()
  const res = await fetch(`${OpenAPI.BASE}/api/v1/settings/docker-resources`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error("Failed to save Docker resources")
  return res.json() as Promise<DockerResources>
}

function numStr(v: number | null): string {
  return v != null ? String(v) : ""
}

function parseNum(s: string): number | null {
  const n = parseFloat(s)
  return isNaN(n) || n <= 0 ? null : n
}

function GeneralSettings() {
  const [dataRoot, setDataRoot] = useState("")
  const [defaultRoot, setDefaultRoot] = useState("")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetchDataRoot().then((value) => {
      setDataRoot(value)
      setDefaultRoot(value)
    })
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    try {
      const result = await saveDataRoot(dataRoot)
      setDataRoot(result)
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-xl flex flex-col gap-4">
      <div className="grid gap-2">
        <Label htmlFor="data-root">Data Root Directory</Label>
        <Input
          id="data-root"
          value={dataRoot}
          onChange={(e) => { setDataRoot(e.target.value); setSaved(false) }}
          placeholder="/path/to/data"
        />
        <p className="text-muted-foreground text-sm">
          The root directory where uploaded files are stored.
        </p>
      </div>
      <div className="flex gap-3 items-center">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
        <Button variant="outline" onClick={() => { setDataRoot(defaultRoot); setSaved(false) }}>
          Reset to Default
        </Button>
        {saved && <span className="text-sm text-green-600">Settings saved.</span>}
      </div>
    </div>
  )
}

function DockerSettings() {
  const [cpus, setCpus] = useState("")
  const [memoryGb, setMemoryGb] = useState("")
  const [swapGb, setSwapGb] = useState("")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null)

  useEffect(() => {
    fetchDockerResources().then((r) => {
      setCpus(numStr(r.cpus))
      setMemoryGb(numStr(r.memory_gb))
      setSwapGb(numStr(r.swap_gb))
    })
    fetchSystemInfo().then(setSysInfo)
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    try {
      const result = await saveDockerResources({
        cpus: parseNum(cpus),
        memory_gb: parseNum(memoryGb),
        swap_gb: parseNum(swapGb),
      })
      setCpus(numStr(result.cpus))
      setMemoryGb(numStr(result.memory_gb))
      setSwapGb(numStr(result.swap_gb))
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  const handleClear = async () => {
    setSaving(true)
    setSaved(false)
    try {
      await saveDockerResources({ cpus: null, memory_gb: null, swap_gb: null })
      setCpus("")
      setMemoryGb("")
      setSwapGb("")
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-xl flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">
        Limit resources used by Docker containers (ODM, bin extractor). Leave blank for no limit.
        Changes apply to the next container run, no restart required.
      </p>
      {sysInfo && (
        <p className="text-xs text-orange-500 font-mono">
          {sysInfo.cpu_count} CPUs &nbsp;·&nbsp; {sysInfo.total_ram_gb} GB RAM available
        </p>
      )}
      <div className="grid grid-cols-3 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="docker-cpus">Max CPUs</Label>
          <Input
            id="docker-cpus"
            type="number"
            min="0.1"
            step="0.5"
            value={cpus}
            onChange={(e) => { setCpus(e.target.value); setSaved(false) }}
            placeholder="e.g. 4"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="docker-memory">Max RAM (GB)</Label>
          <Input
            id="docker-memory"
            type="number"
            min="0.1"
            step="0.5"
            value={memoryGb}
            onChange={(e) => { setMemoryGb(e.target.value); setSaved(false) }}
            placeholder="e.g. 8"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="docker-swap">Extra Swap (GB) <span className="text-muted-foreground font-normal text-xs">(requires RAM limit)</span></Label>
          <Input
            id="docker-swap"
            type="number"
            min="0"
            step="0.5"
            value={swapGb}
            onChange={(e) => { setSwapGb(e.target.value); setSaved(false) }}
            placeholder="e.g. 2"
          />
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        Extra Swap is additional swap on top of Max RAM. Requires Max RAM to be set.
      </p>
      <div className="flex gap-3 items-center">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
        <Button variant="outline" onClick={handleClear} disabled={saving}>
          Clear Limits
        </Button>
        {saved && <span className="text-sm text-green-600">Docker settings saved.</span>}
      </div>
    </div>
  )
}

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
      setStatus({ kind: "update_available", version: result.version, downloadUrl: result.downloadUrl })
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
        <span className="text-muted-foreground text-sm font-mono">{CURRENT_VERSION}</span>
      </div>

      <div className="flex flex-col gap-3">
        <Button
          variant="outline"
          className="w-fit"
          onClick={handleCheck}
          disabled={status.kind === "checking"}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${status.kind === "checking" ? "animate-spin" : ""}`} />
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
  { items: [
    { id: "general", label: "General", icon: Settings },
    { id: "docker",  label: "Docker",  icon: Server  },
    { id: "about",   label: "About",   icon: Info    },
  ]},
] as const

type SettingsSection = "general" | "docker" | "about"

const ApplicationSettings = () => {
  const [active, setActive] = useState<SettingsSection>("general")

  return (
    <div className="flex flex-1 min-h-0">
      <NavSidebar
        groups={SETTINGS_NAV_GROUPS}
        activeId={active}
        onSelect={(id) => setActive(id as SettingsSection)}
      />
      <div className="flex-1 overflow-auto px-6 py-6">
        {active === "general" && <GeneralSettings />}
        {active === "docker"  && <DockerSettings />}
        {active === "about"   && <AboutSettings />}
      </div>
    </div>
  )
}

export default ApplicationSettings
