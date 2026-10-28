import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

const check = vi.fn()
const use = vi.fn()
vi.mock("@/features/agent/lib/agentApi", () => ({
  agentApi: {
    computeClusterCheck: (i: unknown) => check(i),
    computeClusterUse: (i: unknown) => use(i),
  },
}))

import { ClusterSetup } from "./Welcome"

const survey = {
  ssh: "ssh -i ~/.ssh/id_lab jdoe@hive.edu",
  name: "hive",
  login: "jdoe@hive.edu",
  ssh_key: "~/.ssh/id_lab",
  user: "jdoe",
  slurm: "23.02",
  containers: "apptainer 1.3",
  containers_ok: true,
  core: "high:lab",
  core_wait_minutes: 0,
  workers_try: ["high:lab"],
  llm_try: [],
  data_root: "/group/lab/gemini_app",
  data_root_candidates: ["/group/lab (2T free)"],
  already_installed: null,
  internet: {},
}

function show(configured: string | null = null) {
  const onReady = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ClusterSetup configured={configured} onReady={onReady} />
    </QueryClientProvider>,
  )
  return onReady
}

describe("ClusterSetup", () => {
  it("asks for the SSH command and key file, checks them, then saves", async () => {
    check.mockResolvedValue(survey)
    use.mockResolvedValue({ cluster: "hive" })
    const onReady = show()
    expect(screen.getByTestId("cluster-check")).toBeDisabled()
    fireEvent.change(screen.getByTestId("cluster-ssh"), {
      target: { value: "ssh jdoe@hive.edu" },
    })
    fireEvent.change(screen.getByTestId("cluster-key"), {
      target: { value: "~/.ssh/id_lab" },
    })
    fireEvent.click(screen.getByTestId("cluster-check"))
    await screen.findByTestId("cluster-survey")
    expect(check).toHaveBeenCalledWith({
      ssh: "ssh jdoe@hive.edu",
      key: "~/.ssh/id_lab",
      data_root: undefined,
    })
    expect(screen.getByTestId("cluster-folder")).toHaveValue(
      "/group/lab/gemini_app",
    )
    fireEvent.click(screen.getByTestId("cluster-use"))
    await waitFor(() => expect(onReady).toHaveBeenCalledWith("hive"))
    expect(use.mock.calls[0][0]).toMatchObject({
      ssh: survey.ssh,
      data_root: "/group/lab/gemini_app",
      core: "high:lab",
    })
  })

  it("says why a login failed", async () => {
    check.mockRejectedValue(new Error("could not log in to jdoe@hive.edu"))
    show()
    fireEvent.change(screen.getByTestId("cluster-ssh"), {
      target: { value: "jdoe@hive.edu" },
    })
    fireEvent.click(screen.getByTestId("cluster-check"))
    expect(await screen.findByTestId("cluster-check-error")).toHaveTextContent(
      "could not log in",
    )
  })

  it("shows a cluster already set up", () => {
    show("hive")
    expect(screen.getByTestId("cluster-configured")).toHaveTextContent("hive")
  })
})
