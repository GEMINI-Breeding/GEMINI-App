/**
 * Sidebar experiment selector.
 *
 * Shows the list of experiments the user has access to (filtered by
 * /api/users/me/experiments for non-superusers), falling back to the
 * full list for superusers. Writes the choice into ExperimentContext.
 */
import { useEffect, useMemo } from "react"

import type { ExperimentOutput } from "@/client"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useExperimentScope } from "@/contexts/ExperimentContext"
import {
  useAllExperiments,
  useMyExperimentIds,
} from "@/features/experiments/hooks/useExperimentData"
import useAuth from "@/hooks/useAuth"

function filterVisible(
  all: ExperimentOutput[],
  myIds: string[],
  isSuperuser: boolean,
): ExperimentOutput[] {
  if (isSuperuser) return all
  const mySet = new Set(myIds)
  return all.filter((e) => e.id != null && mySet.has(String(e.id)))
}

export function ExperimentSelector({
  size = "sm",
}: {
  size?: "sm" | "default"
}) {
  const { user, isUserLoading } = useAuth()
  const { experimentId, setExperimentId } = useExperimentScope()
  const isSuperuser = Boolean(user?.is_superuser)

  const { data: all, isLoading: loadingAll } = useAllExperiments()
  const { data: myIds, isLoading: loadingMyIds } = useMyExperimentIds()

  // While `user` is still loading the `isSuperuser` flag is necessarily
  // false, so a naive filter would temporarily hide *every* experiment
  // for a superuser and surface an "empty" state. Treat the user query
  // as a hard precondition for filtering.
  const stillLoading = loadingAll || isUserLoading || (!isSuperuser && loadingMyIds)

  const visible = useMemo(
    () => filterVisible(all ?? [], myIds ?? [], isSuperuser),
    [all, myIds, isSuperuser],
  )

  // Auto-select the first visible experiment on login if none is picked yet,
  // so downstream feature pages don't render an "empty" state unnecessarily.
  // Also re-fire if the previously stored experimentId no longer matches a
  // visible row (e.g. it was deleted, or my-experiments shrank).
  useEffect(() => {
    if (visible.length === 0) return
    const match = experimentId
      ? visible.find((e) => String(e.id) === experimentId)
      : null
    if (!match && visible[0].id != null) {
      setExperimentId(String(visible[0].id))
    }
  }, [experimentId, visible, setExperimentId])

  if (stillLoading) {
    return (
      <div className="text-xs text-muted-foreground px-2 py-1">
        Loading experiments…
      </div>
    )
  }

  if (visible.length === 0) {
    return (
      <div
        className="space-y-1 px-2 py-1 text-xs text-muted-foreground"
        data-testid="experiment-selector-empty"
      >
        <p>No experiments yet.</p>
        <p>
          Click <span className="font-medium">+</span> above to create one,
          or upload data on the <span className="font-medium">Files</span> tab —
          the upload form creates an experiment for you.
        </p>
      </div>
    )
  }

  return (
    <Select
      value={experimentId ?? undefined}
      onValueChange={(v) => setExperimentId(v || null)}
    >
      <SelectTrigger
        size={size}
        className="w-full"
        data-testid="experiment-selector"
      >
        <SelectValue placeholder="Select experiment" />
      </SelectTrigger>
      <SelectContent>
        {visible.map((e) => (
          <SelectItem key={String(e.id)} value={String(e.id)}>
            {e.experiment_name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
