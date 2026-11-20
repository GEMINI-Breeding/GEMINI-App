import {
  createFileRoute,
  Link as RouterLink,
  redirect,
} from "@tanstack/react-router"

import { AuthLayout } from "@/components/Common/AuthLayout"
import { isLoggedIn } from "@/hooks/useAuth"

/**
 * Password recovery without email.
 *
 * GEMINI runs without an email server, so there are no reset links.
 * Two ways back in instead: an admin resets the password in Admin → Users,
 * and when the locked-out user *is* the only admin, a one-line command on
 * the machine running the stack (gemini/rest_api/reset_password.py). Only
 * someone with access to that machine can run it.
 */
const RESET_COMMAND =
  "docker exec geminibase-rest-api poetry run python -m gemini.rest_api.reset_password you@example.com"

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

        <div
          className="space-y-3 rounded-md border border-border bg-muted/40 p-4 text-sm leading-relaxed"
          data-testid="password-recovery-help"
        >
          <p className="text-muted-foreground">
            GEMINI doesn't send reset emails. To get back in:
          </p>
          <p>
            <span className="font-medium">Ask an administrator</span> to set a
            new password for you under Admin → Users.
          </p>
          <div>
            <p>
              <span className="font-medium">If you are the only admin</span>,
              run this on the computer running GEMINI, with your email:
            </p>
            <pre className="mt-2 overflow-x-auto rounded bg-background p-2 text-xs">
              <code data-testid="password-reset-command">{RESET_COMMAND}</code>
            </pre>
            <p className="text-muted-foreground mt-2 text-xs">
              It prints a new password. Sign in with it, then change it under
              Settings → Account.
            </p>
          </div>
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
