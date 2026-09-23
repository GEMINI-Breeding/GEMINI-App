import { act, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { Process } from "@/types/process"

let processes: Process[] = []
const removeProcess = vi.fn()
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }))
vi.mock("@/contexts/ProcessContext", () => ({
  useProcess: () => ({
    processes,
    hasBeenActive: true,
    removeProcess,
    clearCompleted: vi.fn(),
    updateProcess: vi.fn(),
  }),
}))

import { AUTO_DISMISS_MS, ProcessPanel } from "./ProcessPanel"

const proc = (status: Process["status"]): Process => ({
  id: "p1",
  type: "processing",
  status,
  title: "Data Sync",
  items: [],
  createdAt: new Date(),
})

describe("ProcessPanel", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("drops a job that finished successfully after a while", () => {
    removeProcess.mockClear()
    processes = [proc("completed")]
    render(<ProcessPanel />)
    expect(screen.getByText("Data Sync")).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(AUTO_DISMISS_MS)
    })
    expect(removeProcess).toHaveBeenCalledWith("p1")
  })

  it("keeps a failed job until it is dismissed", () => {
    removeProcess.mockClear()
    processes = [proc("error")]
    render(<ProcessPanel />)
    act(() => {
      vi.advanceTimersByTime(AUTO_DISMISS_MS * 3)
    })
    expect(removeProcess).not.toHaveBeenCalled()
    expect(screen.getByText("Data Sync")).toBeInTheDocument()
  })

  it("stays open while a job is running", () => {
    processes = [proc("running")]
    render(<ProcessPanel />)
    act(() => {
      vi.advanceTimersByTime(AUTO_DISMISS_MS * 3)
    })
    expect(screen.getByText("Data Sync")).toBeInTheDocument()
  })
})
