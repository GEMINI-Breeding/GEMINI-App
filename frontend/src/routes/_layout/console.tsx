import { createFileRoute } from "@tanstack/react-router"
import { ConsolePage } from "@/features/console/pages/ConsolePage"

export const Route = createFileRoute("/_layout/console")({
  component: ConsolePage,
})
