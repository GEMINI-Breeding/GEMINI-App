/**
 * useUpdateChecker — checks for a newer app version once per day.
 *
 * How it works:
 *   1. On mount, reads the last-checked timestamp from localStorage.
 *   2. If more than 24 h have passed (or never checked), fetches the GitHub
 *      releases API for the latest release tag.
 *   3. Compares the remote tag against CURRENT_VERSION using semver ordering.
 *   4. If a newer version is found, calls onUpdateAvailable(version, downloadUrl).
 *
 * Configuration:
 *   Set VITE_UPDATE_CHECK_URL in your .env to the GitHub releases API endpoint.
 *   Default: https://api.github.com/repos/eranario/GEMINI-App/releases/latest
 *   The JSON response must have { tag_name: string, html_url: string }.
 */

import { useEffect } from "react"

const CURRENT_VERSION = "0.0.3"
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours
const LS_KEY = "gemi_last_update_check"
const LS_DISMISSED_KEY = "gemi_dismissed_version"

const RELEASES_PAGE = "https://github.com/GEMINI-Breeding/GEMINI-App/releases"

const UPDATE_CHECK_URL =
  (import.meta.env.VITE_UPDATE_CHECK_URL as string | undefined) ??
  "https://api.github.com/repos/GEMINI-Breeding/GEMINI-App/releases/latest"

/** Parse "vX.Y.Z" or "X.Y.Z" into [major, minor, patch]. */
function parseVersion(tag: string): [number, number, number] {
  const clean = tag.replace(/^v/, "")
  const parts = clean.split(".").map(Number)
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
}

/** Returns true if `remote` is strictly greater than `local`. */
function isNewer(local: string, remote: string): boolean {
  const [lMaj, lMin, lPat] = parseVersion(local)
  const [rMaj, rMin, rPat] = parseVersion(remote)
  if (rMaj !== lMaj) return rMaj > lMaj
  if (rMin !== lMin) return rMin > lMin
  return rPat > lPat
}

interface UseUpdateCheckerOptions {
  onUpdateAvailable: (version: string, downloadUrl: string) => void
}

export function useUpdateChecker({ onUpdateAvailable }: UseUpdateCheckerOptions) {
  useEffect(() => {
    async function check() {
      const now = Date.now()
      const lastCheck = Number(localStorage.getItem(LS_KEY) ?? "0")
      if (now - lastCheck < CHECK_INTERVAL_MS) return

      localStorage.setItem(LS_KEY, String(now))

      try {
        const res = await fetch(UPDATE_CHECK_URL, {
          headers: { Accept: "application/vnd.github+json" },
          signal: AbortSignal.timeout(10_000),
        })
        if (!res.ok) return

        const data = await res.json()
        const remoteTag: string = data.tag_name ?? ""
        // Always send users to the releases page so they can pick the right
        // installer for their platform (macOS .dmg, Windows .exe, Linux .deb).
        const downloadUrl: string = RELEASES_PAGE

        if (!remoteTag) return

        // Skip if user already dismissed this version
        const dismissed = localStorage.getItem(LS_DISMISSED_KEY)
        if (dismissed === remoteTag) return

        if (isNewer(CURRENT_VERSION, remoteTag)) {
          onUpdateAvailable(remoteTag, downloadUrl)
        }
      } catch {
        // Network errors are non-fatal — silently skip
      }
    }

    check()
  }, [onUpdateAvailable])
}
