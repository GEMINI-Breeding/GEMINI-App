/**
 * Who is behind the data: everyone with an account, the experiments each is
 * linked to (the one who made an experiment is its owner), and whether an
 * experiment is public (everyone's lists) or private (only the people linked
 * to it). Private hides an experiment from other people's lists; it does not
 * lock its data.
 */
import { useQuery } from "@tanstack/react-query"

import { apiUrl } from "@/features/files/lib/download"
import { getToken } from "@/lib/auth"

export interface Person {
  id: string
  email: string
  full_name: string | null
  is_superuser: boolean
  is_active: boolean
  /** Signs in with their email alone (a lab's test setup). */
  passwordless: boolean
  guest: boolean
  experiments: { experiment_id: string; role: string }[]
}

export interface ExperimentPerson {
  user_id: string
  email: string
  full_name: string | null
  role: string
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(apiUrl(path), {
    ...init,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  })
  const body = await r.json().catch(() => null)
  if (!r.ok)
    throw new Error(
      (body as { error_description?: string; detail?: string } | null)
        ?.error_description ??
        (body as { detail?: string } | null)?.detail ??
        `HTTP ${r.status}`,
    )
  return body as T
}

export const peopleApi = {
  people: () => call<Person[]>("/api/users/people"),
  experimentPeople: () =>
    call<Record<string, ExperimentPerson[]>>("/api/experiments/people"),
  /** An account; without a password it signs in with its email alone
   *  (only where the server allows that). */
  addPerson: (input: {
    email: string
    full_name?: string
    password?: string
    is_superuser?: boolean
  }) =>
    call<unknown>("/api/users", {
      method: "POST",
      body: JSON.stringify({ ...input, password: input.password ?? "" }),
    }),
  setVisibility: (experimentId: string, visibility: "public" | "private") =>
    call<unknown>(`/api/experiments/id/${experimentId}/visibility`, {
      method: "PATCH",
      body: JSON.stringify({ visibility }),
    }),
  /** Link a person to an experiment (an admin, or the person themselves via /me). */
  linkMe: (experimentId: string, role = "member") =>
    call<unknown>("/api/users/me/experiments", {
      method: "POST",
      body: JSON.stringify({ experiment_id: experimentId, role }),
    }),
}

/** "Ana Ruiz" or "ana" from an email. */
export function shortName(p: { full_name?: string | null; email: string }) {
  return p.full_name?.trim() || p.email.split("@")[0]
}

export function useExperimentPeople() {
  return useQuery({
    queryKey: ["experiment-people"],
    queryFn: peopleApi.experimentPeople,
    staleTime: 60_000,
    retry: false,
  })
}
