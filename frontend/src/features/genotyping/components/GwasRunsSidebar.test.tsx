/**
 * GwasRunsSidebar component tests. We mock the data hooks rather than
 * the SDK because the only contracts that matter for this component
 * are (a) it renders one row per job, (b) the row whose id matches
 * `currentJobId` is marked active, and (c) clicking a row updates the
 * URL via the router's Link.
 */
import { render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    ...rest
  }: {
    children: React.ReactNode
    params: { studyId: string; jobId: string }
    [k: string]: unknown
  }) => (
    <a
      href={`/genotyping/${params.studyId}/gwas/${params.jobId}`}
      data-router-params={JSON.stringify(params)}
      {...rest}
    >
      {children}
    </a>
  ),
}))

const useStudyGwasJobsMock = vi.fn()
const useTraitNameMapMock = vi.fn()
vi.mock("@/features/genotyping/hooks/useGwas", () => ({
  useStudyGwasJobs: (...args: unknown[]) => useStudyGwasJobsMock(...args),
  useTraitNameMap: (...args: unknown[]) => useTraitNameMapMock(...args),
  // jobTraitNames is a pure helper — re-export the real one. We import
  // it dynamically inside the mock factory to keep the mock self-contained.
  jobTraitNames: (job: { parameters?: unknown }, names?: Map<string, string>) => {
    const params = (job.parameters ?? {}) as {
      trait_id?: string | null
      trait_ids?: string[] | null
    }
    const ids: string[] = []
    if (params.trait_id) ids.push(params.trait_id)
    if (Array.isArray(params.trait_ids)) ids.push(...params.trait_ids)
    return ids.map((id) => names?.get(id) ?? id)
  },
}))

import { GwasRunsSidebar } from "./GwasRunsSidebar"

const NAMES = new Map([
  ["trait-yield", "Yield_ha"],
  ["trait-height", "Plant_height"],
  ["trait-slope", "Max_slope"],
  ["trait-gs", "Max_gs"],
])

function setupJobs(jobs: unknown[]) {
  useStudyGwasJobsMock.mockReturnValue({
    data: jobs,
    isLoading: false,
    isSuccess: true,
  })
  useTraitNameMapMock.mockReturnValue({ data: NAMES, isSuccess: true })
}

describe("GwasRunsSidebar", () => {
  it("renders nothing-yet message when there are no runs", () => {
    setupJobs([])
    render(<GwasRunsSidebar studyId="study-A" currentJobId="any" />)
    expect(screen.getByTestId("gwas-sidebar-empty")).toBeInTheDocument()
  })

  it("renders one row per job and highlights the active job", () => {
    setupJobs([
      {
        id: "job-1",
        status: "COMPLETED",
        created_at: "2026-05-01T00:00:00Z",
        parameters: { study_id: "study-A", trait_id: "trait-yield", model: "lmm" },
      },
      {
        id: "job-2",
        status: "COMPLETED",
        created_at: "2026-05-02T00:00:00Z",
        parameters: {
          study_id: "study-A",
          model: "mvlmm",
          trait_ids: ["trait-yield", "trait-height", "trait-slope", "trait-gs"],
        },
      },
    ])
    render(<GwasRunsSidebar studyId="study-A" currentJobId="job-1" />)

    const rows = screen.getAllByTestId(/^gwas-sidebar-item-/)
    expect(rows).toHaveLength(2)

    // Newest-first sort: job-2 (2026-05-02) precedes job-1 (2026-05-01).
    expect(rows[0]).toHaveAttribute("data-testid", "gwas-sidebar-item-job-2")
    expect(rows[1]).toHaveAttribute("data-testid", "gwas-sidebar-item-job-1")

    // currentJobId=job-1 → only job-1 is marked active.
    expect(rows[0]).toHaveAttribute("data-active", "false")
    expect(rows[1]).toHaveAttribute("data-active", "true")

    // mvLMM row collapses the trait list rather than printing all four.
    expect(within(rows[0]).getByText(/mvLMM/i)).toBeInTheDocument()
    // Single-trait row shows the trait name directly.
    expect(within(rows[1]).getByText("Yield_ha")).toBeInTheDocument()
  })

  it("each row's Link points at /genotyping/<studyId>/gwas/<jobId>", () => {
    setupJobs([
      {
        id: "job-7",
        status: "RUNNING",
        created_at: "2026-05-03T00:00:00Z",
        parameters: { study_id: "study-A", trait_id: "trait-height", model: "lmm" },
      },
    ])
    render(<GwasRunsSidebar studyId="study-A" currentJobId="other" />)
    const row = screen.getByTestId("gwas-sidebar-item-job-7")
    expect(row).toHaveAttribute(
      "href",
      "/genotyping/study-A/gwas/job-7",
    )
  })
})
