/** The weather stations saved for an experiment, year and site. */
import { useQuery } from "@tanstack/react-query"

import { type FileMetadata, FilesService } from "@/client"
import { apiUrl } from "@/features/files/lib/download"
import { getToken } from "@/lib/auth"
import type { Station } from "../lib/canopyAir"
import { fromCsv, type StationMeta, weatherFolder } from "../lib/weather"

async function readText(path: string): Promise<string> {
  const res = await fetch(apiUrl(`/api/files/download/gemini/${path}`), {
    headers: { Authorization: `Bearer ${getToken()}` },
  })
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
  return res.text()
}

export const stationsKey = (scope: {
  year?: string
  experiment?: string
  site?: string
}) => ["weather", scope.year, scope.experiment, scope.site] as const

export function useStations(scope: {
  year?: string
  experiment?: string
  site?: string
}) {
  return useQuery({
    queryKey: stationsKey(scope),
    enabled: Boolean(scope.year && scope.experiment && scope.site),
    queryFn: async (): Promise<Station[]> => {
      const folder = weatherFolder({
        year: scope.year as string,
        experiment: scope.experiment as string,
        site: scope.site as string,
      })
      const files =
        ((await FilesService.apiFilesListFilePathListFiles({
          filePath: `gemini/${folder}`,
        }).catch(() => [])) as FileMetadata[] | null) ?? []
      const metas = files
        .map((f) => f.object_name ?? "")
        .filter((n) => n.endsWith(".json"))
      return Promise.all(
        metas.map(async (m) => {
          const meta = JSON.parse(await readText(m)) as StationMeta
          const { columns, rows } = fromCsv(
            await readText(m.replace(/\.json$/, ".csv")),
          )
          rows.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
          return { meta, columns, rows }
        }),
      )
    },
    staleTime: 5 * 60_000,
  })
}
