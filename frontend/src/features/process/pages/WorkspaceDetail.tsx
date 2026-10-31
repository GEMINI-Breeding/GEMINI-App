/**
 * WorkspaceDetail — pipelines + runs inside a workspace.
 *
 * R2 minimal version: lists pipelines from runStore, surfaces "Create a new
 * pipeline" cards (Aerial / Ground) → ProcessingPipeline route (R3) and
 * "New Run" → RunDetail route (R4). The richer reference-data panel + per-
 * pipeline run cards with status / upload picker on `main` will be folded
 * back in once RunDetail is restored.
 */
import { useNavigate, useParams } from "@tanstack/react-router"
import {
  ArrowLeft,
  Loader2,
  MoreVertical,
  Navigation,
  Plane,
  Plus,
  Trash2,
} from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { NewRunDialog } from "@/features/process/components/NewRunDialog"
import { RunGroupList } from "@/features/process/components/RunGroupList"
import {
  deletePipeline,
  deleteRun,
  type Pipeline,
  type Run,
  usePipelines,
  useRunStoreReady,
  useRuns,
  useWorkspace,
} from "@/features/process/lib/runStore"

function PipelineCard({
  pipeline,
  workspaceId,
}: {
  pipeline: Pipeline
  workspaceId: string
}) {
  const navigate = useNavigate()
  const runs = useRuns(pipeline.id)
  const [confirmDeletePipeline, setConfirmDeletePipeline] = useState(false)
  const [confirmDeleteRun, setConfirmDeleteRun] = useState<Run | null>(null)
  const [newRunOpen, setNewRunOpen] = useState(false)

  const isAerial = pipeline.type === "aerial"
  const Icon = isAerial ? Plane : Navigation

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                  isAerial ? "bg-blue-500/10" : "bg-green-500/10"
                }`}
              >
                <Icon
                  className={`h-5 w-5 ${isAerial ? "text-blue-600" : "text-green-600"}`}
                />
              </div>
              <div>
                <CardTitle className="text-base">{pipeline.name}</CardTitle>
                <CardDescription className="capitalize">
                  {pipeline.type} pipeline
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  navigate({
                    to: "/process/$workspaceId/pipeline",
                    params: { workspaceId },
                    search: { pipelineId: pipeline.id, type: pipeline.type },
                  })
                }
              >
                Settings
              </Button>
              <Button
                size="sm"
                data-onboarding="process-new-run"
                onClick={() => setNewRunOpen(true)}
              >
                <Plus className="mr-1 h-4 w-4" />
                New Run
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="Pipeline actions"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    className="text-red-600"
                    onClick={() => setConfirmDeletePipeline(true)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete Pipeline
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </CardHeader>
        {runs.length > 0 && (
          <CardContent data-onboarding="process-run-groups">
            {/* One row per flight day (every sensor flown); a day with several runs
                — diurnal flights, treatments, thermal beside RGB — expands to them. */}
            <RunGroupList
              runs={runs}
              experiment={
                runs.find((r) => r.uploadScope?.experiment)?.uploadScope
                  ?.experiment
              }
              typeOf={() => pipeline.type}
              onOpen={(run) =>
                navigate({
                  to: "/process/$workspaceId/run/$runId",
                  params: { workspaceId, runId: run.id },
                })
              }
              actions={(run) => (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label="Run actions"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreVertical className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <DropdownMenuItem
                      className="text-red-600"
                      onClick={(e) => {
                        e.stopPropagation()
                        setConfirmDeleteRun(run)
                      }}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete Run
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            />
          </CardContent>
        )}
      </Card>

      <NewRunDialog
        pipeline={pipeline}
        workspaceId={workspaceId}
        open={newRunOpen}
        onClose={() => setNewRunOpen(false)}
      />

      <Dialog
        open={confirmDeletePipeline}
        onOpenChange={(v) => !v && setConfirmDeletePipeline(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Pipeline</DialogTitle>
            <DialogDescription>
              Delete <strong>{pipeline.name}</strong>? All its runs will be
              lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDeletePipeline(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                deletePipeline(pipeline.id)
                setConfirmDeletePipeline(false)
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!confirmDeleteRun}
        onOpenChange={(v) => !v && setConfirmDeleteRun(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Run</DialogTitle>
            <DialogDescription>
              Delete this run? Its job records on the backend stay; only the
              wizard's run record is removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteRun(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirmDeleteRun) deleteRun(confirmDeleteRun.id)
                setConfirmDeleteRun(null)
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** The two big choices, for a workspace that has no pipeline yet. */
function NewPipelineCards({ workspaceId }: { workspaceId: string }) {
  const navigate = useNavigate()
  return (
    <div className="mb-8">
      <h2 className="mb-1 text-lg font-medium">Create a new pipeline</h2>
      <p className="text-muted-foreground mb-4 text-sm">
        Choose the type of sensing data you want to process
      </p>
      <div
        className="grid grid-cols-1 gap-4 md:grid-cols-2"
        data-onboarding="process-pipeline-cards"
      >
        <Card
          role="button"
          tabIndex={0}
          aria-label="Create Aerial Pipeline"
          className="hover:border-primary cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          onClick={() =>
            navigate({
              to: "/process/$workspaceId/pipeline",
              params: { workspaceId },
              search: { type: "aerial" },
            })
          }
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              navigate({
                to: "/process/$workspaceId/pipeline",
                params: { workspaceId },
                search: { type: "aerial" },
              })
            }
          }}
        >
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                <Plane className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <CardTitle>Aerial Pipeline</CardTitle>
                <CardDescription>Process drone imagery</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              GCP selection → Orthomosaic → Plot boundaries → Train → Traits
            </p>
          </CardContent>
        </Card>

        <Card
          role="button"
          tabIndex={0}
          aria-label="Create Ground Pipeline"
          className="hover:border-primary cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          onClick={() =>
            navigate({
              to: "/process/$workspaceId/pipeline",
              params: { workspaceId },
              search: { type: "ground" },
            })
          }
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              navigate({
                to: "/process/$workspaceId/pipeline",
                params: { workspaceId },
                search: { type: "ground" },
              })
            }
          }}
        >
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
                <Navigation className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <CardTitle>Ground Pipeline</CardTitle>
                <CardDescription>Process Amiga rover data</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              Plot marking → AgRowStitch → Plot boundaries → Train → Traits
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export function WorkspaceDetail() {
  const { workspaceId } = useParams({ from: "/_layout/process/$workspaceId/" })
  const navigate = useNavigate()
  const workspace = useWorkspace(workspaceId)
  const storeReady = useRunStoreReady()
  const pipelines = usePipelines(workspaceId)

  if (!workspace) {
    return (
      <div className="bg-background">
        <div className="mx-auto max-w-5xl p-8 flex flex-col items-center justify-center py-24 text-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground text-sm">
            {storeReady
              ? "Workspace not found. It may have been deleted."
              : "Loading…"}
          </p>
          <Button
            variant="outline"
            onClick={() => navigate({ to: "/process" })}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to workspaces
          </Button>
        </div>
      </div>
    )
  }

  const description = workspace.description

  return (
    <div className="bg-background">
      <div className="mx-auto max-w-5xl p-8">
        <div className="mb-8 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back to workspaces"
            onClick={() => navigate({ to: "/process" })}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">{workspace.name}</h1>
            <p className="text-muted-foreground text-sm">{description}</p>
          </div>
        </div>

        {pipelines.length === 0 ? (
          <>
            <NewPipelineCards workspaceId={workspaceId} />
            <div className="mb-10">
              <h2 className="mb-4 text-lg font-medium">Pipelines</h2>
              {pipelines.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No pipelines yet. Create one above to get started.
                </p>
              ) : (
                <div className="space-y-3">
                  {pipelines.map((pipeline) => (
                    <PipelineCard
                      key={pipeline.id}
                      pipeline={pipeline}
                      workspaceId={workspaceId}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="mb-6">
              <h2 className="mb-4 text-lg font-medium">Pipelines</h2>
              <div className="space-y-3">
                {pipelines.map((pipeline) => (
                  <PipelineCard
                    key={pipeline.id}
                    pipeline={pipeline}
                    workspaceId={workspaceId}
                  />
                ))}
              </div>
            </div>
            {/* Pipelines exist: making another is rare, so it waits at the bottom, small. */}
            <div
              className="text-muted-foreground flex flex-wrap items-center gap-2 border-t pt-4 text-sm"
              data-onboarding="process-pipeline-cards"
            >
              <span>Add another pipeline:</span>
              {(
                [
                  ["aerial", "Aerial (drone imagery)", Plane, "text-blue-600"],
                  [
                    "ground",
                    "Ground (Amiga rover)",
                    Navigation,
                    "text-green-600",
                  ],
                ] as const
              ).map(([type, label, Icon, color]) => (
                <Button
                  key={type}
                  variant="outline"
                  size="sm"
                  aria-label={`Create ${type === "aerial" ? "Aerial" : "Ground"} Pipeline`}
                  onClick={() =>
                    navigate({
                      to: "/process/$workspaceId/pipeline",
                      params: { workspaceId },
                      search: { type },
                    })
                  }
                >
                  <Icon className={`mr-1.5 h-4 w-4 ${color}`} />
                  {label}
                </Button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
