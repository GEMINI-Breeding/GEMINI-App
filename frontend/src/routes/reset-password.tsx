import { createFileRoute, Link as RouterLink, redirect } from "@tanstack/react-router"

import { AuthLayout } from "@/components/Common/AuthLayout"
import { isLoggedIn } from "@/hooks/useAuth"

/**
 * Password reset placeholder.
 *
 * The old `/reset-password?token=...` flow relied on the FastAPI
 * `LoginService.resetPassword` endpoint which GEMINIbase does not expose.
 * We keep the route (in case an external mailer still points users here)
 * and render a clear "not available" notice.
 */
export const Route = createFileRoute("/reset-password")({
  component: ResetPassword,
  beforeLoad: async () => {
    if (isLoggedIn()) {
      throw redirect({ to: "/" })
    }
  },
  head: () => ({
    meta: [{ title: "Reset Password — GEMINI" }],
  }),
})

function ResetPassword() {
  return (
    <AuthLayout>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-2xl font-bold">Reset Password</h1>
        </div>

        <div className="rounded-md border border-border bg-muted/40 p-4 text-sm leading-relaxed">
          <p className="mb-2 font-medium">Not available in this deployment.</p>
          <p className="text-muted-foreground">
            Password reset links are not supported on this server. Ask an
            administrator to update your password from the Admin page.
          </p>
        </div>

        <div className="text-center text-sm">
          <RouterLink to="/login" className="underline underline-offset-4">
            Back to log in
          </RouterLink>
        </div>
      </div>
    </AuthLayout>
  )
}

export default ResetPassword
