import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("./PlotFramesPanel", () => ({ PlotFramesPanel: () => null }))
vi.mock("./PlotImageGrid", () => ({ PlotImageGrid: () => null }))

import { PlotImagesStepPanel, queuedChoice } from "./PlotImagesStepPanel"

const base = {
  plotImageFiles: [],
  prefix: "p/",
  framesPrefix: "f/",
  hasCameraPositions: true,
  running: false,
  onRunFrames: () => {},
  onRunOrtho: () => {},
}

describe("queuedChoice", () => {
  it("reads back what was queued, else the defaults", () => {
    expect(
      queuedChoice({
        source: "frames",
        plots: { mode: "list", text: "12, 15-18" },
      }),
    ).toEqual({ source: "frames", plots: { mode: "list", text: "12, 15-18" } })
    expect(queuedChoice(undefined)).toEqual({
      source: undefined,
      plots: { mode: "all" },
    })
    expect(queuedChoice({ source: "x", plots: { mode: "?" } }).plots).toEqual({
      mode: "all",
    })
  })
})

describe("PlotImagesStepPanel", () => {
  it("opens on the source and plots it was queued with", () => {
    render(
      <PlotImagesStepPanel
        {...base}
        hasFrames
        queued={{ source: "frames", plots: { mode: "list", text: "7, 9" } }}
      />,
    )
    expect(screen.getByTestId("plot-frames-run")).toBeInTheDocument()
    expect(screen.getByTestId("plot-images-which-list")).toBeChecked()
    expect(screen.getByTestId("plot-images-list")).toHaveValue("7, 9")
  })

  it("offers the plots choice for raw frames before any frames exist", () => {
    render(
      <PlotImagesStepPanel
        {...base}
        hasFrames={false}
        queued={{ source: "frames" }}
      />,
    )
    expect(screen.getByTestId("plot-images-which")).toBeInTheDocument()
  })
})
