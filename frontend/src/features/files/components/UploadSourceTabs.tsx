/**
 * Where the files to upload are: on this computer, already on the cluster,
 * or in online storage. One switch at the top of the upload column, so only
 * the chosen way shows (instead of every way stacked one under another).
 * Data types the cluster and online copies cannot take (trait tables,
 * genomic files, …) are uploaded from this computer only, with no switch.
 */
import { useQuery } from "@tanstack/react-query"
import { Cloud, Laptop, Server } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"

import { agentApi } from "@/features/agent/lib/agentApi"
import { CLUSTER_DATA_TYPES } from "./ClusterFolderUpload"

export type UploadSource = "computer" | "cluster" | "online"

const KEY = "gemi.upload.source"

/** The ways a data type can come in; a cluster folder only with a cluster. */
export function availableSources(
  dataType: string | null,
  cluster: string | null | undefined,
): UploadSource[] {
  if (!CLUSTER_DATA_TYPES[dataType ?? ""]) return ["computer"]
  return cluster ? ["computer", "cluster", "online"] : ["computer", "online"]
}

function remembered(): UploadSource {
  try {
    const v = localStorage.getItem(KEY)
    if (v === "cluster" || v === "online") return v
  } catch {
    // no storage (private window): start on this computer
  }
  return "computer"
}

export function UploadSourceTabs({
  dataType,
  children,
}: {
  dataType: string | null
  /** The panel for each source. */
  children: Record<UploadSource, ReactNode>
}) {
  const { data: compute } = useQuery({
    queryKey: ["agent", "compute"],
    queryFn: () => agentApi.compute(),
    staleTime: 30_000,
    retry: false,
  })
  const cluster = compute?.cluster ?? null
  const sources = availableSources(dataType, cluster)
  const [chosen, setChosen] = useState<UploadSource>(remembered)
  const source = sources.includes(chosen) ? chosen : "computer"
  useEffect(() => {
    try {
      localStorage.setItem(KEY, chosen)
    } catch {
      // per-viewer convenience only
    }
  }, [chosen])

  if (sources.length === 1) return <>{children.computer}</>
  const label: Record<UploadSource, { text: string; icon: ReactNode }> = {
    computer: { text: "This computer", icon: <Laptop className="h-4 w-4" /> },
    cluster: {
      text: `On ${cluster ?? "the cluster"}`,
      icon: <Server className="h-4 w-4" />,
    },
    online: { text: "Online storage", icon: <Cloud className="h-4 w-4" /> },
  }
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <p className="text-sm font-medium">Where are the files?</p>
        <div
          role="tablist"
          className="inline-flex rounded-md border bg-muted p-0.5"
          data-testid="upload-source"
        >
          {sources.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={s === source}
              onClick={() => setChosen(s)}
              data-testid={`upload-source-${s}`}
              className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-sm transition-colors ${
                s === source
                  ? "bg-background font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label[s].icon}
              {label[s].text}
            </button>
          ))}
        </div>
      </div>
      {children[source]}
    </div>
  )
}
