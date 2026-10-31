/**
 * The copies from online storage started in this browser, kept across pages
 * and reloads, so the process panel and the upload page can show where each
 * one is after the person has moved on. A copy is followed until it ends;
 * its last state stays until it is dismissed (or after two days).
 */
import { useSyncExternalStore } from "react"

import type { CloudFetch } from "@/features/agent/lib/agentApi"

export interface TrackedCopy {
  /** The copy's id: a cluster job id, a "w…" waiting id, or a local copy's id. */
  id: string
  /** The date it is for (one copy per date when dates come from the files). */
  date: string
  /** Where it copies from ("box:/GEMINI_Team/…"). */
  source?: string
  started: number
  /** Set once it has ended: the state it ended in. */
  final?: Pick<CloudFetch, "state" | "line" | "error">
}

const KEY = "gemini.copies.v1"
const KEEP_MS = 2 * 24 * 3600 * 1000
const listeners = new Set<() => void>()
let cache: TrackedCopy[] | null = null

function load(): TrackedCopy[] {
  if (cache) return cache
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as TrackedCopy[]
    cache = Array.isArray(raw)
      ? raw.filter((c) => c?.id && Date.now() - c.started < KEEP_MS)
      : []
  } catch {
    cache = []
  }
  return cache
}

function save(next: TrackedCopy[]) {
  cache = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Storage blocked: followed for this page's life only.
  }
  for (const l of listeners) l()
}

export const copyTracker = {
  list: load,
  add(copies: Omit<TrackedCopy, "started">[]) {
    const ids = new Set(copies.map((c) => c.id))
    save([
      ...copies.map((c) => ({ ...c, started: Date.now() })),
      ...load().filter((c) => !ids.has(c.id)),
    ])
  },
  /** Record how it ended; true the first time (so it is announced once). */
  finish(id: string, final: TrackedCopy["final"]): boolean {
    const list = load()
    const c = list.find((x) => x.id === id)
    if (!c || c.final) return false
    save(list.map((x) => (x.id === id ? { ...x, final } : x)))
    return true
  },
  remove(id: string) {
    save(load().filter((c) => c.id !== id))
  },
  subscribe(l: () => void) {
    listeners.add(l)
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) {
        cache = null
        l()
      }
    }
    window.addEventListener("storage", onStorage)
    return () => {
      listeners.delete(l)
      window.removeEventListener("storage", onStorage)
    }
  },
}

export function useTrackedCopies(): TrackedCopy[] {
  return useSyncExternalStore(copyTracker.subscribe, load, load)
}

const FINISHED = new Set(["done", "failed", "COMPLETED", "FAILED", "ENDED"])

export function isFinished(f: Pick<CloudFetch, "state">): boolean {
  return FINISHED.has(f.state)
}

export function isFailure(f: Pick<CloudFetch, "state">): boolean {
  return f.state === "failed" || f.state === "FAILED" || f.state === "ENDED"
}

/** A copy's state in words. */
export function copyStateLabel(f: Pick<CloudFetch, "state">): string {
  switch (f.state) {
    case "copying":
      return "Copying from the storage…"
    case "uploading":
      return "Uploading into the app…"
    case "done":
    case "COMPLETED":
      return "Done: the run shows on the Process tab"
    case "failed":
    case "FAILED":
    case "ENDED":
      return "The copy did not finish"
    case "WAITING":
      return "Waiting for a free cluster job slot (starts by itself)…"
    case "PENDING":
    case "QUEUED":
      return "Waiting for the cluster to start the copy job…"
    case "RUNNING":
      return "Copying and uploading on the cluster…"
    default:
      return f.state
  }
}

/** A copy's state in one or two words, for a row. */
export function copyShortState(f: Pick<CloudFetch, "state">): string {
  switch (f.state) {
    case "done":
    case "COMPLETED":
      return "done"
    case "failed":
    case "FAILED":
    case "ENDED":
      return "did not finish"
    case "WAITING":
    case "PENDING":
    case "QUEUED":
      return "queued"
    case "RUNNING":
      return "running"
    default:
      return f.state.toLowerCase()
  }
}
