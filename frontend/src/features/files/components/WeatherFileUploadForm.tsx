/**
 * WeatherFileUploadForm — self-contained weather-station file upload/list/
 * delete widget, used both in Settings → Thermal and the Guided Upload
 * flow's DJI thermal step so the two don't duplicate this logic.
 */

import { useCallback, useEffect, useState } from "react"
import { ThermalService, type WeatherStationFilePublic } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Trash2, Upload } from "lucide-react"

export interface WeatherFileUploadFormProps {
  /** Called whenever the list changes (upload/delete) so a parent can refresh its own selector. */
  onChange?: (files: WeatherStationFilePublic[]) => void
}

export function WeatherFileUploadForm({ onChange }: WeatherFileUploadFormProps) {
  const [weatherFiles, setWeatherFiles] = useState<WeatherStationFilePublic[]>([])
  const [uploadName, setUploadName] = useState("")
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const refreshWeatherFiles = useCallback(() => {
    ThermalService.listWeatherFiles()
      .then((files) => {
        setWeatherFiles(files)
        onChange?.(files)
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    refreshWeatherFiles()
  }, [refreshWeatherFiles])

  const handleUpload = async () => {
    if (!uploadFile || !uploadName.trim()) return
    setUploading(true)
    setUploadError(null)
    try {
      await ThermalService.uploadWeatherFile({
        name: uploadName.trim(),
        format: "toa5",
        formData: { file: uploadFile },
      })
      setUploadName("")
      setUploadFile(null)
      refreshWeatherFiles()
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed")
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (id: string) => {
    await ThermalService.deleteWeatherFile({ id })
    refreshWeatherFiles()
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 items-end">
        <div className="grid gap-1 flex-1">
          <Label htmlFor="weather-name" className="text-xs">Name</Label>
          <Input
            id="weather-name"
            className="h-8"
            value={uploadName}
            onChange={(e) => setUploadName(e.target.value)}
            placeholder="e.g. Field Station A — June 2026"
          />
        </div>
        <Input
          type="file"
          accept=".dat"
          className="h-8 max-w-[180px]"
          onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
        />
        <Button
          size="sm"
          onClick={handleUpload}
          disabled={uploading || !uploadFile || !uploadName.trim()}
        >
          <Upload className="h-3.5 w-3.5 mr-1" />
          Upload
        </Button>
      </div>
      {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}

      {weatherFiles.length > 0 && (
        <div className="flex flex-col gap-1 mt-2">
          {weatherFiles.map((w) => (
            <div key={w.id} className="flex items-center justify-between rounded border px-2.5 py-1.5 text-sm">
              <div>
                <span className="font-medium">{w.name}</span>{" "}
                <span className="text-muted-foreground text-xs">
                  {w.row_count} rows · {w.start_time?.slice(0, 16)} → {w.end_time?.slice(0, 16)}
                </span>
              </div>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleDelete(w.id)}>
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
