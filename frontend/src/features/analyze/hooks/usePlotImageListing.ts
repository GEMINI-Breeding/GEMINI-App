/**
 * The plot images under a Processed/ folder, for the Query view: the
 * server's walk of just the plot image folders, else (an older server) the
 * folder's listing filtered to the image names it shows.
 */
import { useQuery } from "@tanstack/react-query"

import { type FileMetadata, OpenAPI } from "@/client"
import { getToken, isLoggedIn } from "@/lib/auth"
import { PLOT_IMAGE_MATCH } from "../lib/plotSeason"

export function usePlotImageListing(prefix: string | null) {
  return useQuery({
    queryKey: ["analyze", "plot-image-listing", prefix],
    queryFn: async (): Promise<FileMetadata[]> => {
      const base = (OpenAPI.BASE ?? "").replace(/\/$/, "")
      const path = `gemini/${prefix}`
        .split("/")
        .map(encodeURIComponent)
        .join("/")
      const headers = { Authorization: `Bearer ${getToken()}` }
      // The server walks just the plot image folders (fast); a server
      // without that endpoint lists the whole folder, filtered.
      let res = await fetch(`${base}/api/files/plot_images/${path}`, {
        headers,
      })
      if (res.status === 404 || res.status === 405)
        res = await fetch(
          `${base}/api/files/list/${path}?match=${encodeURIComponent(PLOT_IMAGE_MATCH)}`,
          { headers },
        )
      if (!res.ok) throw new Error(`Listing plot images failed (${res.status})`)
      return ((await res.json()) as FileMetadata[] | null) ?? []
    },
    enabled: isLoggedIn() && Boolean(prefix),
    staleTime: 5 * 60_000,
  })
}
