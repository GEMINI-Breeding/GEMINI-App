/**
 * /admin landing page — Users CRUD (preserved from Phase 5).
 *
 * This was previously /_layout/admin.tsx; moved here so that admin.tsx can
 * become a pure layout route that renders <Outlet /> for every child
 * /admin/{entity} page. The Phase 5 admin.spec.ts tests this URL and is
 * unchanged.
 */
import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import {
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { Suspense } from "react"

import { type UserOutput, UsersService } from "@/client"
import AddUser from "@/components/Admin/AddUser"
import { columns, type UserTableData } from "@/components/Admin/columns"
import { DataTable } from "@/components/Common/DataTable"
import PendingUsers from "@/components/Pending/PendingUsers"
import useAuth from "@/hooks/useAuth"

function getUsersQueryOptions() {
  return {
    queryFn: () =>
      UsersService.apiUsersAllGetAllUsers({ limit: 100, offset: 0 }),
    queryKey: ["users"],
  }
}

export const Route = createFileRoute("/_layout/admin/")({
  component: AdminIndex,
  head: () => ({ meta: [{ title: "Users — GEMINI" }] }),
})

function UsersTableContent() {
  const { user: currentUser } = useAuth()
  const { data: users } = useSuspenseQuery(getUsersQueryOptions())

  const tableData: UserTableData[] = (users ?? []).map((user: UserOutput) => ({
    ...user,
    isCurrentUser: currentUser?.id === user.id,
  }))

  const table = useReactTable({
    data: tableData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: { pageIndex: 0, pageSize: 50 },
    },
  })

  return <DataTable table={table} />
}

function UsersTable() {
  return (
    <Suspense fallback={<PendingUsers />}>
      <UsersTableContent />
    </Suspense>
  )
}

function AdminIndex() {
  return (
    <div className="container max-w-6xl space-y-6 px-4 py-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Users</h1>
          <p className="text-muted-foreground">
            Manage user accounts and permissions
          </p>
        </div>
        <AddUser />
      </div>
      <UsersTable />
    </div>
  )
}
