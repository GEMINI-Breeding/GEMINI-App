import { createFileRoute } from "@tanstack/react-router"
import { DatasetsDashboard } from "@/features/datasets/pages/DatasetsDashboard"

type DatasetsSearch = {
  ml_task?: string
}

export const Route = createFileRoute("/_layout/datasets/")({
  component: DatasetsPage,
  validateSearch: (search: Record<string, unknown>): DatasetsSearch => ({
    ml_task: typeof search.ml_task === "string" ? search.ml_task : undefined,
  }),
  head: () => ({ meta: [{ title: "Datasets - GEMI" }] }),
})

function DatasetsPage() {
  const { ml_task } = Route.useSearch()
  return <DatasetsDashboard initialMlTask={ml_task} />
}
