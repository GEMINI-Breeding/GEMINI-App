import { createFileRoute, Link as RouterLink, redirect } from "@tanstack/react-router"

import { AuthLayout } from "@/components/Common/AuthLayout"
import { isLoggedIn } from "@/hooks/useAuth"

/**
 * Password recovery placeholder.
 *
 * GEMINIbase has no SMTP / email flow today — the upstream `LoginService`
 * methods that the old FastAPI backend exposed (`recover_password`,
 * `reset_password`) don't exist. Rather than remove the route (which would
 * 404 the "Forgot your password?" link) we keep the page and render a
 * clear "not available — ask your admin" notice. Flip this to a real flow
 * once SMTP / password-reset lands upstream.
 */
export const Route = createFileRoute("/recover-password")({
  component: RecoverPassword,
  beforeLoad: async () => {
    if (isLoggedIn()) {
      throw redirect({ to: "/" })
    }
  },
  head: () => ({
    meta: [{ title: "Recover Password — GEMINI" }],
  }),
})

function RecoverPassword() {
  return (
    <AuthLayout>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-2xl font-bold">Password Recovery</h1>
        </div>

        <div className="rounded-md border border-border bg-muted/40 p-4 text-sm leading-relaxed">
          <p className="mb-2 font-medium">Not available in this deployment.</p>
          <p className="text-muted-foreground">
            This GEMINI instance does not send password-reset emails. Ask an
            administrator to update your password from the Admin page, or
            create a new account.
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

export default RecoverPassword
