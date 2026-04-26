import { Outlet, createFileRoute, redirect } from "@tanstack/react-router"

import { AdminTabs } from "@/features/admin/components/AdminTabs"
import { isLoggedIn } from "@/hooks/useAuth"

export const Route = createFileRoute("/_layout/admin")({
  component: AdminLayout,
  beforeLoad: () => {
    if (!isLoggedIn()) throw redirect({ to: "/login" })
  },
  head: () => ({ meta: [{ title: "Admin — GEMINI" }] }),
})

function AdminLayout() {
  return (
    <div className="flex flex-col">
      <AdminTabs />
      <Outlet />
    </div>
  )
}
