import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

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

function nav(
  shown: string,
  status: Record<string, NavStatus>,
  onShow: (k: string) => void = () => {},
) {
  return render(
    <StepNavigator
      steps={STEPS}
      statusOf={(k) => status[k] ?? "locked"}
      shownKey={shown}
      nextKey="split_orthomosaic"
      onShow={onShow}
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

describe("StepNavigator step bar", () => {
  it("opens an unlocked step from its segment, not a locked one", () => {
    const onShow = vi.fn()
    nav(
      "plot_boundary_prep",
      {
        plot_boundary_prep: "completed",
        split_orthomosaic: "ready",
        trait_extraction: "ready",
      },
      onShow,
    )
    fireEvent.click(screen.getByTestId("step-bar-trait_extraction"))
    expect(onShow).toHaveBeenCalledWith("trait_extraction")
    const locked = screen.getByTestId("step-bar-inference")
    expect(locked).toBeDisabled()
    expect(locked.getAttribute("title")).toMatch(/needs Plot images/)
  })
})
