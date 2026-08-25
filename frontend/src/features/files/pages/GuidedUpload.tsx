/**
 * GuidedUpload — platform-first upload flow, a third option alongside the
 * standard Upload/Manage tabs. Asks "what platform is this?" first, then
 * only surfaces the upload options relevant to that platform, instead of
 * one flat dropdown of every data type regardless of platform.
 *
 * This is a curation layer over the *existing* upload machinery
 * (DataStructureForm/UploadList, exactly as the standard Upload tab uses
 * them) — not a rebuild — except for the DJI "Thermal Images" option,
 * which is genuinely new (see ThermalDirectoryUpload.tsx).
 */

import { useCallback, useState } from "react"
import { useNavigate, useSearch } from "@tanstack/react-router"
import {
  ChevronLeft,
  Cog,
  FileText,
  FolderOpen,
  Navigation,
  Plane,
  Settings2,
  Thermometer,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { DataStructureForm, UploadList } from "../components"
import { ThermalDirectoryUpload } from "../components/ThermalDirectoryUpload"
import { WeatherFileUploadForm } from "../components/WeatherFileUploadForm"

type Platform = "ground" | "dji" | "custom"

const PLATFORM_CARDS: {
  key: Platform
  label: string
  description: string
  icon: LucideIcon
  // Full literal Tailwind classes — Tailwind's JIT compiler can't process
  // dynamically-interpolated class name strings like `bg-${color}-500/10`.
  iconBoxClass: string
  iconClass: string
}[] = [
  {
    key: "ground",
    label: "Ground Rover",
    description: "Farm-ng Amiga or similar ground platform",
    icon: Navigation,
    iconBoxClass: "bg-green-500/10",
    iconClass: "text-green-600",
  },
  {
    key: "dji",
    label: "DJI Drone",
    description: "Includes thermal (R-JPEG) conversion",
    icon: Plane,
    iconBoxClass: "bg-blue-500/10",
    iconClass: "text-blue-600",
  },
  {
    key: "custom",
    label: "Custom / Other Drone",
    description: "ArduPilot-based or other flight platforms",
    icon: Settings2,
    iconBoxClass: "bg-purple-500/10",
    iconClass: "text-purple-600",
  },
]

const THERMAL_OPTION = "__thermal__"
const WEATHER_OPTION = "__weather__"

interface UploadOption {
  key: string
  label: string
  description: string
  icon: LucideIcon
}

const PLATFORM_OPTIONS: Record<Platform, UploadOption[]> = {
  ground: [
    {
      key: "Farm-ng Binary File",
      label: "Farm-ng Binary File",
      description: "Raw .bin capture — extracted into images automatically",
      icon: FileText,
    },
    {
      key: "Image Data",
      label: "Image Data",
      description: "Already-extracted images",
      icon: FolderOpen,
    },
    {
      key: "Synced Metadata",
      label: "Synced Metadata",
      description: "GPS-synced image manifest CSV",
      icon: FileText,
    },
  ],
  dji: [
    {
      key: "Image Data",
      label: "Standard Images",
      description: "RGB images from the drone",
      icon: FolderOpen,
    },
    {
      key: THERMAL_OPTION,
      label: "Thermal Images",
      description: "Upload + convert DJI R-JPEG thermal captures (_T/_V pairs)",
      icon: Thermometer,
    },
    {
      key: WEATHER_OPTION,
      label: "Weather File",
      description: "TOA5 weather-station file for thermal conversion",
      icon: Cog,
    },
  ],
  custom: [
    {
      key: "Ardupilot Logs",
      label: "Ardupilot Logs",
      description: "Flight controller .bin/.log/.tlog",
      icon: FileText,
    },
    {
      key: "Image Data",
      label: "Image Data",
      description: "Raw captured images",
      icon: FolderOpen,
    },
  ],
}

const PLATFORM_LABELS: Record<Platform, string> = {
  ground: "Ground Rover",
  dji: "DJI Drone",
  custom: "Custom / Other Drone",
}

// URL-backed instead of local state so the bottom-right Process panel can
// deep-link straight back into an in-progress sub-view (e.g. DJI → Thermal
// Images) after the user navigates away — see routes/_layout/files/index.tsx.
function isPlatform(value: string | undefined): value is Platform {
  return value === "ground" || value === "dji" || value === "custom"
}

export function GuidedUpload() {
  const navigate = useNavigate()
  const { platform: platformParam, option: optionParam } = useSearch({ from: "/_layout/files/" })
  const platform = isPlatform(platformParam) ? platformParam : null
  const optionKey = optionParam ?? null
  const [formValues, setFormValues] = useState<Record<string, string>>({})

  const handleFormChange = useCallback((field: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [field]: value }))
  }, [])

  function selectPlatform(p: Platform) {
    setFormValues({})
    navigate({ to: "/files", search: { section: "guided", platform: p } })
  }

  function selectOption(key: string) {
    navigate({ to: "/files", search: { section: "guided", platform: platform ?? undefined, option: key } })
  }

  function backToPlatforms() {
    navigate({ to: "/files", search: { section: "guided" } })
  }

  function backToOptions() {
    navigate({ to: "/files", search: { section: "guided", platform: platform ?? undefined } })
  }

  if (!platform) {
    return (
      <div>
        <h2 className="mb-1 text-lg font-medium">What platform is this?</h2>
        <p className="text-muted-foreground mb-4 text-sm">
          Choose your data source to see relevant upload options.
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {PLATFORM_CARDS.map((card) => (
            <Card
              key={card.key}
              className="hover:border-primary cursor-pointer transition-colors"
              onClick={() => selectPlatform(card.key)}
            >
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${card.iconBoxClass}`}>
                    <card.icon className={`h-5 w-5 ${card.iconClass}`} />
                  </div>
                  <div>
                    <CardTitle>{card.label}</CardTitle>
                    <CardDescription>{card.description}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent />
            </Card>
          ))}
        </div>
      </div>
    )
  }

  if (!optionKey) {
    return (
      <div>
        <Button variant="ghost" size="sm" className="mb-3" onClick={backToPlatforms}>
          <ChevronLeft className="mr-1 h-4 w-4" /> Change platform
        </Button>
        <h2 className="mb-1 text-lg font-medium">{PLATFORM_LABELS[platform]}</h2>
        <p className="text-muted-foreground mb-4 text-sm">What are you uploading?</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {PLATFORM_OPTIONS[platform].map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => selectOption(opt.key)}
              className="text-left rounded-lg border p-3 transition-colors hover:border-primary/50"
            >
              <div className="flex items-center gap-2">
                <opt.icon className="h-4 w-4 text-muted-foreground shrink-0" />
                <p className="text-sm font-medium">{opt.label}</p>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{opt.description}</p>
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      <Button variant="ghost" size="sm" className="mb-3" onClick={backToOptions}>
        <ChevronLeft className="mr-1 h-4 w-4" /> Back
      </Button>

      {optionKey === WEATHER_OPTION && (
        <div className="max-w-2xl">
          <h2 className="mb-1 text-lg font-medium">Weather File</h2>
          <p className="text-muted-foreground mb-4 text-sm">
            Upload a Campbell Scientific TOA5 .dat file — used to match
            per-image humidity/ambient temperature by nearest timestamp
            during thermal conversion.
          </p>
          <WeatherFileUploadForm />
        </div>
      )}

      {optionKey === THERMAL_OPTION && <ThermalDirectoryUpload />}

      {optionKey !== WEATHER_OPTION && optionKey !== THERMAL_OPTION && (
        <div className="grid grid-cols-2 gap-8 items-start">
          <DataStructureForm
            fileType={optionKey}
            values={formValues}
            onChange={handleFormChange}
          />
          <UploadList dataType={optionKey} formValues={formValues} />
        </div>
      )}
    </div>
  )
}
