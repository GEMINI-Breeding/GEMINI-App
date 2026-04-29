import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { OrthoVersion } from "@/features/process/lib/orthoVersions"

import {
  TraitExtractionDialog,
  type TraitDialogState,
} from "./TraitExtractionDialog"

function makeOrtho(n: number, label?: string): OrthoVersion {
  return {
    version: n,
    filename: `ortho_v${n}.tif`,
    path: `gemini/Processed/.../ortho_v${n}.tif`,
    label: label ?? null,
    source: "RUN_ODM",
    createdAt: null,
    hasCog: false,
  }
}

const baseState: TraitDialogState = {
  orthoVersion: 1,
  boundaryVersion: null,
  exgThreshold: 0.1,
}

describe("TraitExtractionDialog", () => {
  it("renders nothing when closed", () => {
    render(
      <TraitExtractionDialog
        open={false}
        onClose={() => {}}
        orthoVersions={[]}
        state={baseState}
        onChange={() => {}}
        onSubmit={() => {}}
      />,
    )
    expect(
      screen.queryByRole("heading", { name: /configure trait extraction/i }),
    ).toBeNull()
  })

  it("warns about boundaries and disables submit when no boundary versions exist", () => {
    render(
      <TraitExtractionDialog
        open
        onClose={() => {}}
        orthoVersions={[makeOrtho(1)]}
        state={baseState}
        onChange={() => {}}
        onSubmit={() => {}}
      />,
    )
    expect(
      screen.getByText(/no plot-boundary versions saved/i),
    ).toBeTruthy()
    const submit = screen.getByRole("button", {
      name: /run trait extraction/i,
    }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
  })

  it("disables submit when boundary versions exist but none picked yet", () => {
    render(
      <TraitExtractionDialog
        open
        onClose={() => {}}
        orthoVersions={[makeOrtho(1)]}
        boundaryVersions={[
          {
            version: 1,
            name: null,
            is_active: false,
            created_at: null,
          },
        ]}
        state={{ ...baseState, boundaryVersion: null }}
        onChange={() => {}}
        onSubmit={() => {}}
      />,
    )
    expect(
      screen.getByText(/pick a boundary version to enable extraction/i),
    ).toBeTruthy()
    const submit = screen.getByRole("button", {
      name: /run trait extraction/i,
    }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
  })

  it("disables submit when no ortho versions exist even with a boundary", () => {
    render(
      <TraitExtractionDialog
        open
        onClose={() => {}}
        orthoVersions={[]}
        state={{ ...baseState, orthoVersion: null, boundaryVersion: 3 }}
        onChange={() => {}}
        onSubmit={() => {}}
      />,
    )
    expect(screen.getByText(/no orthomosaic versions available/i)).toBeTruthy()
    const submit = screen.getByRole("button", {
      name: /run trait extraction/i,
    }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
  })

  it("enables submit and fires onSubmit once ortho + boundary are set", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <TraitExtractionDialog
        open
        onClose={() => {}}
        orthoVersions={[makeOrtho(2, "Final")]}
        state={{ orthoVersion: 2, boundaryVersion: 4, exgThreshold: 0.15 }}
        onChange={() => {}}
        onSubmit={onSubmit}
      />,
    )
    expect(screen.queryByText(/plot boundaries are required/i)).toBeNull()
    const submit = screen.getByRole("button", {
      name: /run trait extraction/i,
    }) as HTMLButtonElement
    expect(submit.disabled).toBe(false)
    await user.click(submit)
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it("propagates ExG slider changes via onChange", () => {
    const onChange = vi.fn()
    render(
      <TraitExtractionDialog
        open
        onClose={() => {}}
        orthoVersions={[makeOrtho(1)]}
        state={baseState}
        onChange={onChange}
        onSubmit={() => {}}
      />,
    )
    const slider = screen.getByTestId("trait-exg-threshold") as HTMLInputElement
    fireEvent.change(slider, { target: { value: "0.25" } })
    expect(onChange).toHaveBeenCalledOnce()
    const arg = onChange.mock.calls[0][0] as TraitDialogState
    expect(arg.exgThreshold).toBeCloseTo(0.25, 2)
  })
})
