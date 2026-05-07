import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  createFileRoute,
  Link as RouterLink,
  redirect,
  useNavigate,
} from "@tanstack/react-router"
import { AxiosError } from "axios"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import { ApiError } from "@/client"
import { AuthLayout } from "@/components/Common/AuthLayout"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import { PasswordInput } from "@/components/ui/password-input"
import { isLoggedIn } from "@/hooks/useAuth"
import { login } from "@/lib/auth"

const formSchema = z.object({
  username: z.email(),
  password: z.string().min(1, { message: "Password is required" }),
})

type FormData = z.infer<typeof formSchema>

export const Route = createFileRoute("/login")({
  component: Login,
  beforeLoad: async () => {
    if (isLoggedIn()) {
      throw redirect({ to: "/" })
    }
  },
  head: () => ({
    meta: [{ title: "Log In — GEMINI" }],
  }),
})

interface LoginError {
  title: string
  hint?: string
}

function describeLoginError(err: unknown): LoginError {
  let status: number | undefined
  let detail: string | undefined
  if (err instanceof ApiError) {
    status = err.status
    detail = typeof err.body === "string" ? err.body : undefined
  } else if (err instanceof AxiosError && err.response) {
    status = err.response.status
    detail =
      typeof err.response.data === "string"
        ? err.response.data
        : err.response.data?.detail
  }
  if (status === 400 || status === 401) {
    return { title: "Incorrect email or password." }
  }
  if (status === 404) {
    return {
      title:
        "Login endpoint not found on the backend (HTTP 404 at /api/users/login/access-token).",
      hint:
        "The running REST API doesn't have the JWT auth controller. " +
        "Make sure the backend you're running was built from the migration submodule " +
        "(GEMINIbase dev/gemini-app-migration branch); older images don't ship this endpoint.",
    }
  }
  if (status === 503) {
    return {
      title: "Auth is disabled on the backend.",
      hint: "Set GEMINI_JWT_SECRET on the backend's .env and restart the REST API container.",
    }
  }
  if (status !== undefined) {
    return {
      title: `Login failed (HTTP ${status}).${detail ? ` ${detail}` : ""}`,
    }
  }
  // No status → likely a network error (fetch threw) or a logic bug.
  const message = err instanceof Error ? err.message : String(err)
  return {
    title: "Login failed — could not reach the backend.",
    hint: message ? `Underlying error: ${message}` : undefined,
  }
}

function Login() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [loginError, setLoginError] = useState<LoginError | null>(null)
  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    criteriaMode: "all",
    defaultValues: {
      username: "",
      password: "",
    },
  })

  const loginMutation = useMutation({
    mutationFn: ({ username, password }: FormData) => login(username, password),
    onSuccess: async () => {
      setLoginError(null)
      await queryClient.invalidateQueries({ queryKey: ["currentUser"] })
      navigate({ to: "/" })
    },
    onError: (err: unknown) => {
      const described = describeLoginError(err)
      setLoginError(described)
      toast.error(described.title)
    },
  })

  const isPending = loginMutation.isPending

  const onSubmit = (data: FormData) => {
    setLoginError(null)
    loginMutation.mutate(data)
  }

  return (
    <AuthLayout>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-6"
        >
          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-2xl font-bold">Login to your account</h1>
          </div>

          <div className="grid gap-4">
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      data-testid="email-input"
                      placeholder="user@example.com"
                      type="email"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage className="text-xs" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center">
                    <FormLabel>Password</FormLabel>
                    <RouterLink
                      to="/recover-password"
                      className="ml-auto text-sm underline-offset-4 hover:underline"
                    >
                      Forgot your password?
                    </RouterLink>
                  </div>
                  <FormControl>
                    <PasswordInput
                      data-testid="password-input"
                      placeholder="Password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage className="text-xs" />
                </FormItem>
              )}
            />

            {loginError && (
              <div
                role="alert"
                data-testid="login-error"
                className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-left text-sm"
              >
                <p className="font-medium text-destructive">
                  {loginError.title}
                </p>
                {loginError.hint && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {loginError.hint}
                  </p>
                )}
              </div>
            )}

            <LoadingButton type="submit" loading={isPending}>
              Log In
            </LoadingButton>
          </div>

          <div className="text-center text-sm">
            Don't have an account yet?{" "}
            <RouterLink to="/signup" className="underline underline-offset-4">
              Sign up
            </RouterLink>
          </div>
        </form>
      </Form>
    </AuthLayout>
  )
}
