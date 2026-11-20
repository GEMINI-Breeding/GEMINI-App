/**
 * A genotyping study as a card, like the Process workspaces: up to three
 * of its latest GWAS results as the picture (Manhattan plots), then what
 * the study holds (markers, samples, source file), the experiments it is
 * linked to, and its runs. Edit / Delete sit in the corner menu.
 */
import { Link } from "@tanstack/react-router"
import { Bot, Dna, MoreVertical, Pencil, Trash2 } from "lucide-react"

import type { GenotypingStudyOutput, JobOutput } from "@/client"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { idAsString } from "@/features/admin/lib/ids"
import { GwasManhattanThumb } from "@/features/genotyping/components/GwasRunTile"
import { useGenotypingStudyExperiments } from "@/features/genotyping/hooks/useGenotypingStudies"
import {
  jobTraitNames,
  useStudyGwasJobs,
  useTraitNameMap,
} from "@/features/genotyping/hooks/useGwas"
import {
  parseGwasResult,
  passingMarkers,
} from "@/features/genotyping/lib/gwasResult"
import { sizeLine, studyFacts } from "@/features/genotyping/lib/studyInfo"

function newestFirst(a: JobOutput, b: JobOutput): number {
  return String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
}

export function StudyCard({
  study,
  onEdit,
  onDelete,
}: {
  study: GenotypingStudyOutput
  onEdit: (s: GenotypingStudyOutput) => void
  onDelete: (s: GenotypingStudyOutput) => void
}) {
  const id = idAsString(study.id)
  const facts = studyFacts(study.study_info)
  const experiments = useGenotypingStudyExperiments(id)
  const jobs = useStudyGwasJobs(id, { refetchIntervalMs: 15_000 })
  const traitNames = useTraitNameMap()
  const runs = [...(jobs.data ?? [])].sort(newestFirst)
  const done = runs.filter(
    (j) => String(j.status ?? "").toLowerCase() === "completed",
  )
  const pictures = done.slice(0, 3)
  const latest = done[0]
  const latestPassing = latest ? passingMarkers(parseGwasResult(latest)) : null
  const live = runs.filter((j) =>
    ["pending", "running"].includes(String(j.status ?? "").toLowerCase()),
  ).length
  const expNames = (experiments.data ?? [])
    .map((e) => e.experiment_name)
    .filter(Boolean) as string[]

  return (
    <div
      className="bg-card group hover:border-primary/60 relative flex flex-col overflow-hidden rounded-lg border transition-all hover:shadow-md"
      data-testid="genotyping-study-row"
    >
      <Link
        to="/genotyping/$studyId"
        params={{ studyId: id }}
        className="flex flex-1 flex-col"
        data-testid="genotyping-study-link"
      >
        {pictures.length === 0 ? (
          <div className="bg-muted flex h-28 w-full items-center justify-center">
            <Dna className="text-muted-foreground/30 h-8 w-8" />
          </div>
        ) : (
          <div
            className={`bg-border grid h-28 w-full gap-px ${
              pictures.length === 1
                ? "grid-cols-1"
                : pictures.length === 2
                  ? "grid-cols-2"
                  : "grid-cols-3"
            }`}
            data-testid="genotyping-study-pictures"
          >
            {pictures.map((j) => (
              <GwasManhattanThumb
                key={idAsString(j.id)}
                job={j}
                size={pictures.length === 1 ? 600 : 300}
                className="h-28"
              />
            ))}
          </div>
        )}

        <div className="flex flex-1 flex-col gap-1.5 p-4">
          <p className="truncate pr-6 text-sm font-medium leading-tight">
            {study.study_name ?? "(unnamed)"}
          </p>
          {sizeLine(facts) && (
            <p className="text-muted-foreground text-xs">{sizeLine(facts)}</p>
          )}
          <div className="mt-1 space-y-0.5">
            <p className="text-muted-foreground truncate text-xs">
              <span className="text-foreground/70 font-medium">
                Experiments:
              </span>{" "}
              {expNames.length ? expNames.join(", ") : "none linked"}
            </p>
            <p className="text-muted-foreground text-xs">
              <span className="text-foreground/70 font-medium">GWAS runs:</span>{" "}
              {runs.length}
              {live ? ` (${live} running)` : ""}
            </p>
            {latest && (
              <p
                className="text-muted-foreground truncate text-xs"
                data-testid="genotyping-study-latest"
              >
                <span className="text-foreground/70 font-medium">Latest:</span>{" "}
                {jobTraitNames(latest, traitNames.data).join(", ")} ·{" "}
                {latestPassing
                  ? latestPassing === 1
                    ? "1 marker passes"
                    : `${latestPassing} markers pass`
                  : "no marker passes"}
              </p>
            )}
            <div className="flex flex-wrap gap-1 pt-1">
              {facts.sourceFile && (
                <span
                  className="bg-muted text-muted-foreground max-w-full truncate rounded px-1.5 py-0.5 text-[11px]"
                  title={facts.sourceFile}
                >
                  {facts.sourceFile}
                </span>
              )}
              {facts.mock && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                  made-up data
                </span>
              )}
              {facts.byAgent && (
                <span
                  className="text-muted-foreground flex items-center gap-1 text-[11px]"
                  title="Brought in by the agent"
                >
                  <Bot className="h-3 w-3" /> agent
                </span>
              )}
            </div>
          </div>
        </div>
      </Link>

      <div className="absolute top-2 right-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 bg-black/30 text-white hover:bg-black/50"
              aria-label="Study actions"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              data-testid="genotyping-study-edit"
              onClick={() => onEdit(study)}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-red-600"
              data-testid="genotyping-study-delete"
              onClick={() => onDelete(study)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
