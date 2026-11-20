/**
 * Where the app's data and processing are: this computer (Docker) or a
 * cluster session. Everything the pages show (experiments, runs, traits) and
 * every job comes from that one place; switching changes the place, it does
 * not move data between places.
 */
import { useQuery } from "@tanstack/react-query"

import { agentApi } from "@/features/agent/lib/agentApi"
import { useBackendUp } from "@/lib/connection"
import { isDesktopApp, stackMode } from "@/lib/stack"

export type Place = "computer" | "cluster"

export interface Where {
  /** null until known (no agent service to ask, in a plain browser build). */
  place: Place | null
  /** The cluster this computer is set up for (whether in use or not). */
  cluster: string | null
  /** Whose session it is, when it is a shared one; null for your own. */
  sharedBy: string | null
  /** Your own cluster session, shared with your group. */
  sharingYours: boolean
  /** The place answers (its API is reachable). */
  up: boolean | undefined
  /** The desktop app can switch place; a browser page is served for one place. */
  canSwitch: boolean
  /** "This computer" / "Cluster farm". */
  label: string
  /** "Docker" / "shared session of ana" / "your session, shared with your group". */
  detail: string
}

export function placeLabel(place: Place | null, cluster: string | null) {
  if (place === "cluster") return cluster ? `Cluster ${cluster}` : "A cluster"
  if (place === "computer") return "This computer"
  return "Unknown"
}

export function describeWhere(input: {
  desktop: boolean
  desktopMode: "local" | "cluster"
  agentCluster: string | null | undefined
  share?: { owner: string; shared: boolean; role: "owner" | "member" } | null
  up: boolean | undefined
}): Where {
  const known = input.desktop || input.agentCluster !== undefined
  const place: Place | null = !known
    ? null
    : input.desktop
      ? input.desktopMode === "cluster"
        ? "cluster"
        : "computer"
      : input.agentCluster
        ? "cluster"
        : "computer"
  const cluster = input.agentCluster ?? null
  const share = place === "cluster" ? input.share : null
  const sharedBy = share?.role === "member" ? share.owner : null
  const sharingYours = share?.role === "owner" && share.shared
  const detail =
    place === "computer"
      ? "Docker on this computer"
      : sharedBy
        ? `shared session of ${sharedBy}`
        : sharingYours
          ? "your session, shared with your group"
          : place === "cluster"
            ? "your session"
            : ""
  return {
    place,
    cluster,
    sharedBy,
    sharingYours: Boolean(sharingYours),
    up: input.up,
    canSwitch: input.desktop,
    label: placeLabel(place, cluster),
    detail,
  }
}

export function useWhere(): Where {
  const up = useBackendUp()
  const mode = useQuery({
    queryKey: ["agent", "mode", "where"],
    queryFn: agentApi.mode,
    retry: false,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
  const desktop = isDesktopApp()
  const desktopMode = stackMode()
  const onCluster = desktop
    ? desktopMode === "cluster"
    : Boolean(mode.data?.cluster)
  const compute = useQuery({
    queryKey: ["agent", "compute"],
    queryFn: () => agentApi.compute(),
    enabled: onCluster,
    retry: false,
    staleTime: 10_000,
  })
  return describeWhere({
    desktop,
    desktopMode,
    agentCluster: mode.isError
      ? null
      : mode.data
        ? mode.data.cluster
        : undefined,
    share: compute.data?.share ?? null,
    up,
  })
}
