import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"

import { FilesDashboard } from "@/features/files/pages/FilesDashboard"

// Optional deep-link into a specific Guided Upload sub-view (platform +
// option, e.g. DJI → Thermal Images) — lets the bottom-right Process panel
// link straight back to an in-progress thermal conversion instead of just
// dropping the user on the Files page's default tab.
const filesSearchSchema = z.object({
  section: z.enum(["upload", "guided", "manage"]).optional(),
  platform: z.string().optional(),
  option: z.string().optional(),
})

export const Route = createFileRoute("/_layout/files/")({
  validateSearch: filesSearchSchema,
  component: FilesDashboard,
  head: () => ({
    meta: [{ title: "Files - GEMI" }],
  }),
})
