/**
 * Settings → People: everyone with an account and the experiments they are
 * linked to, each experiment's owner and whether everyone sees it, and (for
 * an administrator) adding a person — without a password where the server
 * allows sign-in by email alone.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Globe, Lock, UserPlus } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { useAllExperiments } from "@/features/experiments/hooks/useExperimentData"
import useAuth from "@/hooks/useAuth"
import { loginOptions } from "@/lib/auth"
import { peopleApi, shortName, useExperimentPeople } from "./api"

export function PeopleSettings() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const admin = Boolean(user?.is_superuser)
  const people = useQuery({
    queryKey: ["people"],
    queryFn: peopleApi.people,
    retry: false,
  })
  const linked = useExperimentPeople()
  const experiments = useAllExperiments()
  const options = useQuery({
    queryKey: ["login-options"],
    queryFn: loginOptions,
    staleTime: 60_000,
  })
  const names = new Map(
    (experiments.data ?? []).map((e) => [String(e.id), e.experiment_name]),
  )
  const visibility = useMutation({
    mutationFn: (v: { id: string; private: boolean }) =>
      peopleApi.setVisibility(v.id, v.private ? "private" : "public"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["experiments"] })
      queryClient.invalidateQueries({ queryKey: ["experiment-people"] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  })

  return (
    <div className="space-y-8" data-testid="people-settings">
      <section className="space-y-2">
        <h2 className="text-base font-medium">Experiments</h2>
        <p className="text-muted-foreground text-sm">
          Who each experiment belongs to. Public experiments are in everyone's
          lists; a private one only in the lists of the people linked to it (its
          data is not locked).
        </p>
        <div
          className="divide-y rounded-md border"
          data-testid="people-experiments"
        >
          {(experiments.data ?? []).map((e) => {
            const id = String(e.id)
            const rows = linked.data?.[id] ?? []
            const mine =
              admin ||
              rows.some(
                (r) => r.user_id === String(user?.id) && r.role === "owner",
              )
            const isPrivate =
              (e.experiment_info as { visibility?: string } | null)
                ?.visibility === "private"
            return (
              <div
                key={id}
                className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"
              >
                <span className="font-medium">{e.experiment_name}</span>
                {rows.length === 0 ? (
                  <span className="text-muted-foreground text-xs">
                    no owner recorded
                  </span>
                ) : (
                  rows.map((r) => (
                    <Badge
                      key={r.user_id}
                      variant={r.role === "owner" ? "default" : "secondary"}
                      title={`${r.email} · ${r.role}`}
                    >
                      {shortName(r)}
                      {r.role !== "owner" ? ` · ${r.role}` : ""}
                    </Badge>
                  ))
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto h-7"
                  disabled={!mine || visibility.isPending}
                  title={
                    mine
                      ? "Change who sees it"
                      : "Only its owner (or an administrator) can change this"
                  }
                  onClick={() => visibility.mutate({ id, private: !isPrivate })}
                  data-testid={`visibility-${e.experiment_name}`}
                >
                  {isPrivate ? (
                    <>
                      <Lock className="mr-1 h-3.5 w-3.5" /> Private
                    </>
                  ) : (
                    <>
                      <Globe className="mr-1 h-3.5 w-3.5" /> Public
                    </>
                  )}
                </Button>
              </div>
            )
          })}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-medium">People</h2>
        <div className="divide-y rounded-md border" data-testid="people-list">
          {(people.data ?? []).map((p) => (
            <div
              key={p.id}
              className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"
            >
              <span className="font-medium">{shortName(p)}</span>
              <span className="text-muted-foreground text-xs">{p.email}</span>
              {p.is_superuser && <Badge variant="secondary">admin</Badge>}
              {p.guest && <Badge variant="outline">guest</Badge>}
              {p.passwordless && !p.guest && (
                <Badge variant="outline">no password</Badge>
              )}
              <span className="text-muted-foreground ml-auto text-xs">
                {p.experiments.length
                  ? p.experiments
                      .map(
                        (x) =>
                          `${names.get(x.experiment_id) ?? "?"}${x.role === "owner" ? " (owner)" : ""}`,
                      )
                      .join(", ")
                  : "no experiments"}
              </span>
            </div>
          ))}
          {people.error && (
            <p className="text-destructive px-3 py-2 text-sm">
              {String(people.error)}
            </p>
          )}
        </div>
        {admin && (
          <AddPerson
            passwordless={options.data?.passwordless ?? false}
            onAdded={() =>
              queryClient.invalidateQueries({ queryKey: ["people"] })
            }
          />
        )}
      </section>
    </div>
  )
}

function AddPerson({
  passwordless,
  onAdded,
}: {
  passwordless: boolean
  onAdded: () => void
}) {
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [admin, setAdmin] = useState(false)
  const add = useMutation({
    mutationFn: () =>
      peopleApi.addPerson({
        email: email.trim(),
        full_name: name.trim() || undefined,
        password: password || undefined,
        is_superuser: admin,
      }),
    onSuccess: () => {
      toast.success(`Added ${email.trim()}`)
      setEmail("")
      setName("")
      setPassword("")
      setAdmin(false)
      onAdded()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  })
  return (
    <div className="space-y-2 rounded-md border p-3" data-testid="add-person">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <UserPlus className="h-4 w-4" /> Add a person
      </p>
      <div className="flex flex-wrap gap-2">
        <Input
          className="w-64"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          className="w-48"
          placeholder="Name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          className="w-56"
          type="password"
          placeholder={passwordless ? "Password (optional)" : "Password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Checkbox
          id="add-person-admin"
          checked={admin}
          onCheckedChange={(v) => setAdmin(v === true)}
        />
        <label htmlFor="add-person-admin">Administrator</label>
      </div>
      <p className="text-muted-foreground text-xs">
        {passwordless
          ? "Without a password they sign in with their email alone (this session allows that, for testing)."
          : "A password is needed: sign-in without passwords is off for this session."}
      </p>
      <Button
        size="sm"
        disabled={
          !/^\S+@\S+$/.test(email.trim()) ||
          (!password && !passwordless) ||
          add.isPending
        }
        onClick={() => add.mutate()}
        data-testid="add-person-go"
      >
        Add
      </Button>
    </div>
  )
}
