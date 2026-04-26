/**
 * Unit tests for AdminEntityPage's wiring against an EntityConfig.
 *
 * We don't drive the Radix Dialog directly (it's tested elsewhere); instead
 * we click the trigger, fill the form via aria-labels, and observe the
 * mocked SDK functions on the config get called with the right shape.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

import { AdminEntityPage } from "./AdminEntityPage"
import type { EntityConfig } from "@/features/admin/lib/types"

type Row = { id: string; name: string }
type Input = { name: string }

function makeConfig() {
  const list = vi.fn(async (): Promise<Row[]> => [
    { id: "1", name: "Alpha" },
    { id: "2", name: "Beta" },
  ])
  const create = vi.fn(
    async (_: Input): Promise<Row> => ({ id: "3", name: "Gamma" }),
  )
  const update = vi.fn(
    async (_row: Row, _input: Input): Promise<Row> => ({
      id: "1",
      name: "Renamed",
    }),
  )
  const remove = vi.fn(async (_: Row): Promise<unknown> => undefined)

  const config: EntityConfig<Row, Input> = {
    slug: "things",
    singular: "Thing",
    plural: "Things",
    queryKey: ["things"],
    rowId: (r) => r.id,
    list,
    create,
    update,
    delete: remove,
    fields: [{ key: "name", label: "Name", type: "text", required: true }],
    emptyInput: () => ({ name: "" }),
    toInput: (r) => ({ name: r.name }),
  }
  return { config, list, create, update, remove }
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe("AdminEntityPage", () => {
  it("renders the existing rows from list()", async () => {
    const { config, list } = makeConfig()
    render(<AdminEntityPage config={config} />, { wrapper })
    await waitFor(() => expect(list).toHaveBeenCalled())
    expect(await screen.findByText("Alpha")).toBeTruthy()
    expect(screen.getByText("Beta")).toBeTruthy()
  })

  it("adds a row via the Add dialog", async () => {
    const { config, create } = makeConfig()
    render(<AdminEntityPage config={config} />, { wrapper })
    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy())

    fireEvent.click(screen.getByTestId("entity-add"))
    const nameInput = await screen.findByLabelText(/Name/i)
    fireEvent.change(nameInput, { target: { value: "Gamma" } })
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }))

    await waitFor(() => expect(create).toHaveBeenCalledWith({ name: "Gamma" }))
  })

  it("deletes a row via the Delete confirm dialog", async () => {
    const { config, remove } = makeConfig()
    render(<AdminEntityPage config={config} />, { wrapper })
    await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy())

    const deleteButtons = screen.getAllByTestId("entity-delete")
    fireEvent.click(deleteButtons[0])
    fireEvent.click(await screen.findByTestId("entity-delete-confirm"))

    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith({ id: "1", name: "Alpha" }),
    )
  })
})
