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
  const { user } = useAuth()
  const { experimentId, setExperimentId } = useExperimentScope()
  const isSuperuser = Boolean(user?.is_superuser)

  const { data: all, isLoading: loadingAll } = useAllExperiments()
  const { data: myIds } = useMyExperimentIds()

  const visible = useMemo(
    () => filterVisible(all ?? [], myIds ?? [], isSuperuser),
    [all, myIds, isSuperuser],
  )

  // Auto-select the first visible experiment on login if none is picked yet,
  // so downstream feature pages don't render an "empty" state unnecessarily.
  useEffect(() => {
    if (!experimentId && visible.length > 0 && visible[0].id != null) {
      setExperimentId(String(visible[0].id))
    }
  }, [experimentId, visible, setExperimentId])

  if (loadingAll) {
    return (
      <div className="text-xs text-muted-foreground px-2 py-1">
        Loading experiments…
      </div>
    )
  }

  if (visible.length === 0) {
    return (
      <div
        className="text-xs text-muted-foreground px-2 py-1"
        data-testid="experiment-selector-empty"
      >
        No experiments available.
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
