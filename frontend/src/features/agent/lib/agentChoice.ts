/**
 * Whether the person chose to use the app without the agent ("Continue
 * without a model" on the welcome screen) and has not set a model up since.
 * Then the agent's boxes (the run page's) stay out of the way.
 */
import { useQuery } from "@tanstack/react-query"

import { agentApi } from "./agentApi"

/** Where the welcome screen keeps that choice (see Welcome.tsx). */
export const MODEL_CHOICE_KEY = "gemini.onboarding.model"

export function choseNoAgent(): boolean {
  try {
    return localStorage.getItem(MODEL_CHOICE_KEY) === "later"
  } catch {
    return false
  }
}

export function useAgentHidden(): boolean {
  const declined = choseNoAgent()
  const onboarding = useQuery({
    queryKey: ["agent", "onboarding"],
    queryFn: () => agentApi.onboarding(),
    enabled: declined,
    staleTime: 60_000,
    retry: false,
  })
  // A model set up afterwards (in Settings) brings the agent back.
  return declined && !onboarding.data?.model.configured
}
