import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { NavStatus, NavStep } from "@/features/process/lib/stepNav"
import { StepNavigator } from "./StepNavigator"

const STEPS: NavStep[] = [
  { key: "plot_boundary_prep", label: "Boundaries", kind: "interactive" },
  { key: "split_orthomosaic", label: "Plot images", kind: "compute" },
  {
    key: "trait_extraction",
    label: "Traits",
    kind: "compute",
    needs: ["plot_boundary_prep"],
  },
  {
    key: "inference",
    label: "Inference",
    kind: "interactive",
    needs: ["split_orthomosaic"],
  },
]

function nav(shown: string, status: Record<string, NavStatus>) {
  return render(
    <StepNavigator
      steps={STEPS}
      statusOf={(k) => status[k] ?? "locked"}
      shownKey={shown}
      nextKey="split_orthomosaic"
      onShow={() => {}}
    >
      <div />
    </StepNavigator>,
  )
}

describe("StepNavigator next arrow", () => {
  it("goes on to trait extraction without making the plot images first", () => {
    nav("split_orthomosaic", {
      plot_boundary_prep: "completed",
      split_orthomosaic: "ready",
      trait_extraction: "ready",
    })
    expect(screen.getByTestId("step-next")).toBeEnabled()
  })

  it("stays locked when the next step needs this one", () => {
    nav("trait_extraction", {
      plot_boundary_prep: "completed",
      split_orthomosaic: "ready",
      trait_extraction: "ready",
    })
    // Inference needs the plot images, which are not made yet.
    expect(screen.getByTestId("step-next")).toBeDisabled()
  })
})
