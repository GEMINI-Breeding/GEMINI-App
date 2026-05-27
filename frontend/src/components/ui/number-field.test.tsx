import { act, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { NumberField } from "./number-field"

function Harness(props: {
  initial: number
  min?: number
  max?: number
  step?: number
  integer?: boolean
  allowNegative?: boolean
  onCommit?: (n: number) => void
}) {
  const [v, setV] = useState(props.initial)
  return (
    <NumberField
      value={v}
      onCommit={(n) => {
        setV(n)
        props.onCommit?.(n)
      }}
      min={props.min}
      max={props.max}
      step={props.step}
      integer={props.integer}
      allowNegative={props.allowNegative}
      data-testid="nf"
    />
  )
}

describe("NumberField", () => {
  it("renders the initial value as a string", () => {
    render(<Harness initial={42} />)
    expect(screen.getByTestId("nf")).toHaveValue("42")
  })

  it("allows clearing the field while typing without committing 0", async () => {
    const onCommit = vi.fn()
    render(<Harness initial={7} onCommit={onCommit} />)
    const el = screen.getByTestId("nf") as HTMLInputElement
    await userEvent.clear(el)
    expect(el).toHaveValue("")
    expect(onCommit).not.toHaveBeenCalled()
  })

  it("reverts to last valid value on blur when draft is empty", async () => {
    const onCommit = vi.fn()
    render(<Harness initial={7} onCommit={onCommit} />)
    const el = screen.getByTestId("nf") as HTMLInputElement
    await userEvent.clear(el)
    fireEvent.blur(el)
    expect(el).toHaveValue("7")
    expect(onCommit).not.toHaveBeenCalled()
  })

  it("accepts intermediate states like '-' and '1.' while typing", async () => {
    render(<Harness initial={0} allowNegative />)
    const el = screen.getByTestId("nf") as HTMLInputElement
    await userEvent.clear(el)
    await userEvent.type(el, "-")
    expect(el).toHaveValue("-")
    await userEvent.type(el, "1")
    expect(el).toHaveValue("-1")
    await userEvent.type(el, ".")
    expect(el).toHaveValue("-1.")
    await userEvent.type(el, "5")
    expect(el).toHaveValue("-1.5")
  })

  it("rejects a leading minus when allowNegative is false", async () => {
    render(<Harness initial={0} />)
    const el = screen.getByTestId("nf") as HTMLInputElement
    await userEvent.clear(el)
    await userEvent.type(el, "-5")
    expect(el).toHaveValue("5")
  })

  it("rejects decimals when integer is true", async () => {
    render(<Harness initial={1} integer />)
    const el = screen.getByTestId("nf") as HTMLInputElement
    await userEvent.clear(el)
    await userEvent.type(el, "3.14")
    expect(el).toHaveValue("314")
  })

  it("commits negative values on blur", async () => {
    const onCommit = vi.fn()
    render(<Harness initial={0} allowNegative onCommit={onCommit} />)
    const el = screen.getByTestId("nf") as HTMLInputElement
    await userEvent.clear(el)
    await userEvent.type(el, "-12.5")
    fireEvent.blur(el)
    expect(onCommit).toHaveBeenCalledWith(-12.5)
    expect(el).toHaveValue("-12.5")
  })

  it("clamps to min on commit", async () => {
    const onCommit = vi.fn()
    render(<Harness initial={5} min={1} integer onCommit={onCommit} />)
    const el = screen.getByTestId("nf") as HTMLInputElement
    await userEvent.clear(el)
    await userEvent.type(el, "0")
    fireEvent.blur(el)
    expect(onCommit).toHaveBeenCalledWith(1)
    expect(el).toHaveValue("1")
  })

  it("clamps to max on commit", async () => {
    const onCommit = vi.fn()
    render(<Harness initial={5} max={10} onCommit={onCommit} />)
    const el = screen.getByTestId("nf") as HTMLInputElement
    await userEvent.clear(el)
    await userEvent.type(el, "100")
    fireEvent.blur(el)
    expect(onCommit).toHaveBeenCalledWith(10)
  })

  it("commits on Enter", async () => {
    const onCommit = vi.fn()
    render(<Harness initial={0} onCommit={onCommit} />)
    const el = screen.getByTestId("nf") as HTMLInputElement
    await userEvent.clear(el)
    await userEvent.type(el, "9{Enter}")
    expect(onCommit).toHaveBeenCalledWith(9)
  })

  it("reverts on Escape", async () => {
    const onCommit = vi.fn()
    render(<Harness initial={3} onCommit={onCommit} />)
    const el = screen.getByTestId("nf") as HTMLInputElement
    await userEvent.clear(el)
    await userEvent.type(el, "99{Escape}")
    expect(el).toHaveValue("3")
    expect(onCommit).not.toHaveBeenCalled()
  })

  it("ArrowUp increments by step", async () => {
    const onCommit = vi.fn()
    render(<Harness initial={5} step={2} onCommit={onCommit} />)
    const el = screen.getByTestId("nf") as HTMLInputElement
    act(() => el.focus())
    fireEvent.keyDown(el, { key: "ArrowUp" })
    expect(onCommit).toHaveBeenCalledWith(7)
  })

  it("ArrowDown decrements by step and clamps", async () => {
    const onCommit = vi.fn()
    render(<Harness initial={1} step={5} min={0} onCommit={onCommit} />)
    const el = screen.getByTestId("nf") as HTMLInputElement
    act(() => el.focus())
    fireEvent.keyDown(el, { key: "ArrowDown" })
    expect(onCommit).toHaveBeenCalledWith(0)
  })

  it("does not resync the draft while the input is focused", () => {
    function ExternalUpdate() {
      const [v, setV] = useState(1)
      return (
        <>
          <NumberField value={v} onCommit={setV} data-testid="nf" />
          <button onClick={() => setV(99)} data-testid="bump">
            bump
          </button>
        </>
      )
    }
    render(<ExternalUpdate />)
    const el = screen.getByTestId("nf") as HTMLInputElement
    act(() => el.focus())
    fireEvent.change(el, { target: { value: "3" } })
    fireEvent.click(screen.getByTestId("bump"))
    // While focused, the draft "3" survives the external value change.
    expect(el).toHaveValue("3")
  })

  it("resyncs the draft when value changes externally while unfocused", () => {
    function ExternalUpdate() {
      const [v, setV] = useState(1)
      return (
        <>
          <NumberField value={v} onCommit={setV} data-testid="nf" />
          <button onClick={() => setV(42)} data-testid="bump">
            bump
          </button>
        </>
      )
    }
    render(<ExternalUpdate />)
    fireEvent.click(screen.getByTestId("bump"))
    expect(screen.getByTestId("nf")).toHaveValue("42")
  })

  it("does not call onCommit when committing the same value", async () => {
    const onCommit = vi.fn()
    render(<Harness initial={5} onCommit={onCommit} />)
    const el = screen.getByTestId("nf") as HTMLInputElement
    fireEvent.blur(el)
    expect(onCommit).not.toHaveBeenCalled()
  })
})
