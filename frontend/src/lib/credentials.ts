/**
 * The person's own keys and tokens, saved once in Settings → Keys & tokens
 * and used wherever a model needs one and its own settings have none
 * (Hugging Face models such as SAM 3, Roboflow models).
 *
 * Stored on the server with the person's account (users/me/credentials),
 * returned only to them. A copy is kept in memory so job submissions, which
 * are not React components, can read it (`savedKey`).
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { OpenAPI } from "@/client"
import { getToken } from "@/lib/auth"

export interface KeyField {
  key: string
  label: string
  placeholder: string
  /** What it is for, in a line. */
  use: string
  /** Where to get one. */
  link: { href: string; text: string }
}

export const KEY_FIELDS: KeyField[] = [
  {
    key: "hf_token",
    label: "Hugging Face access token",
    placeholder: "hf_…",
    use: "Gated or private Hugging Face models, e.g. SAM 3 for “Describe it” (after requesting access to facebook/sam3), and Hugging Face cloud inference.",
    link: {
      href: "https://huggingface.co/settings/tokens",
      text: "Create a read token",
    },
  },
  {
    key: "roboflow_api_key",
    label: "Roboflow API key",
    placeholder: "rf_…",
    use: "Roboflow models, on Roboflow's cloud or your own inference server.",
    link: {
      href: "https://app.roboflow.com/settings/api",
      text: "Find your API key",
    },
  },
]

export type Credentials = Record<string, string>

let cache: Credentials = {}

/** A saved key, or "" (for code outside React, e.g. building job parameters). */
export function savedKey(key: string): string {
  return cache[key] ?? ""
}

function url(): string {
  return `${(OpenAPI.BASE ?? "").replace(/\/$/, "")}/api/users/me/credentials`
}

export async function fetchCredentials(): Promise<Credentials> {
  const res = await fetch(url(), {
    headers: { Authorization: `Bearer ${getToken()}` },
  })
  if (!res.ok) throw new Error(`Could not read your keys (${res.status})`)
  const body = (await res.json()) as { credentials?: Credentials }
  cache = body.credentials ?? {}
  return cache
}

/** Save some keys (an empty value removes one). */
export async function saveCredentials(
  patch: Credentials,
): Promise<Credentials> {
  const res = await fetch(url(), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${getToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ credentials: patch }),
  })
  if (!res.ok) throw new Error(`Could not save your keys (${res.status})`)
  const body = (await res.json()) as { credentials?: Credentials }
  cache = body.credentials ?? {}
  return cache
}

export const CREDENTIALS_KEY = ["me", "credentials"] as const

/** The saved keys (also fills the in-memory copy job submissions read). */
export function useCredentials() {
  return useQuery({
    queryKey: CREDENTIALS_KEY,
    queryFn: fetchCredentials,
    staleTime: 5 * 60_000,
    retry: false,
  })
}

export function useSaveCredentials() {
  const qc = useQueryClient()
  return async (patch: Credentials) => {
    const next = await saveCredentials(patch)
    qc.setQueryData(CREDENTIALS_KEY, next)
    return next
  }
}

/** "hf_…abcd": enough to recognise a key without showing it. */
export function maskKey(v: string): string {
  if (!v) return ""
  return v.length <= 8 ? "••••" : `${v.slice(0, 3)}…${v.slice(-4)}`
}
