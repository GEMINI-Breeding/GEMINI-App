import { useEffect, useState } from "react"

import { OpenAPI } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

async function fetchDataRoot(): Promise<string> {
  const token =
    typeof OpenAPI.TOKEN === "function"
      ? await (OpenAPI.TOKEN as () => Promise<string>)()
      : OpenAPI.TOKEN ?? ""
  const res = await fetch(`${OpenAPI.BASE}/api/v1/settings/data-root`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error("Failed to fetch data root")
  const data = await res.json()
  return data.value as string
}

async function saveDataRoot(value: string): Promise<string> {
  const token =
    typeof OpenAPI.TOKEN === "function"
      ? await (OpenAPI.TOKEN as () => Promise<string>)()
      : OpenAPI.TOKEN ?? ""
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

const ApplicationSettings = () => {
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

  const handleReset = () => {
    setDataRoot(defaultRoot)
    setSaved(false)
  }

  return (
    <div className="max-w-md">
      <h3 className="text-lg font-semibold py-4">Application Settings</h3>
      <div className="flex flex-col gap-4">
        <div className="grid gap-2">
          <Label htmlFor="data-root">Data Root Directory</Label>
          <Input
            id="data-root"
            value={dataRoot}
            onChange={(e) => {
              setDataRoot(e.target.value)
              setSaved(false)
            }}
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
          <Button variant="outline" onClick={handleReset}>
            Reset to Default
          </Button>
          {saved && (
            <span className="text-sm text-green-600">Settings saved.</span>
          )}
        </div>
      </div>
    </div>
  )
}

export default ApplicationSettings
