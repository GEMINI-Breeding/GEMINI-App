import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const onboarding = vi.fn()
vi.mock("./agentApi", () => ({ agentApi: { onboarding: () => onboarding() } }))

import { MODEL_CHOICE_KEY, useAgentHidden } from "./agentChoice"

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>
    {children}
  </QueryClientProvider>
)

describe("useAgentHidden", () => {
  beforeEach(() => {
    localStorage.clear()
    onboarding.mockReset()
  })
  it("shows the agent unless the person chose to go without", () => {
    const { result } = renderHook(() => useAgentHidden(), { wrapper })
    expect(result.current).toBe(false)
    expect(onboarding).not.toHaveBeenCalled()
  })
  it("hides it after 'Continue without a model'", async () => {
    localStorage.setItem(MODEL_CHOICE_KEY, "later")
    onboarding.mockResolvedValue({ model: { configured: false } })
    const { result } = renderHook(() => useAgentHidden(), { wrapper })
    await waitFor(() => expect(onboarding).toHaveBeenCalled())
    expect(result.current).toBe(true)
  })
  it("brings it back once a model is set up", async () => {
    localStorage.setItem(MODEL_CHOICE_KEY, "later")
    onboarding.mockResolvedValue({ model: { configured: true } })
    const { result } = renderHook(() => useAgentHidden(), { wrapper })
    await waitFor(() => expect(result.current).toBe(false))
  })
})
