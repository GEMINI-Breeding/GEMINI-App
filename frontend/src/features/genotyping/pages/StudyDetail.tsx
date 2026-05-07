/**
 * Genotyping study detail page.
 *
 * Phase 9a: read-only header (study name + info JSON + linked-experiments
 * count) + tab strip with placeholders for the upcoming sub-phases:
 *
 *   - Records tab     → 9b (matrix ingest + paginated records browser)
 *   - Variants tab    → 9c (paginated variants table with filter)
 *   - Experiments tab → 9a (associated experiments list — already useful)
 *   - GWAS tab        → 9d (submit dialog + RUN_GWAS jobs panel)
 *
 * The tab values are URL-stable (`?tab=records` etc.) once 9b lands. For
 * 9a we keep them as plain Radix Tabs without router state.
 */

import { Link } from "@tanstack/react-router"
import { ArrowLeft } from "lucide-react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { RecordsTab } from "@/features/genotyping/components/RecordsTab"
import {
  useGenotypingStudy,
  useGenotypingStudyExperiments,
} from "@/features/genotyping/hooks/useGenotypingStudies"

function StudyInfoBlock({ studyId }: { studyId: string }) {
  const study = useGenotypingStudy(studyId)
  if (study.isLoading) {
    return <p className="text-muted-foreground text-sm">Loading study…</p>
  }
  if (study.isError || !study.data) {
    return (
      <p className="text-sm text-red-600" data-testid="genotyping-study-error">
        {study.error?.message ?? "Study not found."}
      </p>
    )
  }
  const info = study.data.study_info
  return (
    <div className="space-y-2">
      <h1
        className="text-2xl font-semibold"
        data-testid="genotyping-study-title"
      >
        {study.data.study_name ?? "(unnamed)"}
      </h1>
      {info != null && (
        <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs">
          {typeof info === "string" ? info : JSON.stringify(info, null, 2)}
        </pre>
      )}
    </div>
  )
}

function ExperimentsTab({ studyId }: { studyId: string }) {
  const experiments = useGenotypingStudyExperiments(studyId)
  if (experiments.isLoading) {
    return <p className="text-muted-foreground text-sm">Loading…</p>
  }
  const rows = experiments.data ?? []
  if (rows.length === 0) {
    // Empty state has its own testid so an E2E spec asserting
    // "experiment X is associated" can distinguish "list rendered but
    // empty" from "still loading" — the previous shape only had a
    // testid on the populated list, so a missing-association bug
    // looked indistinguishable from a slow render.
    return (
      <p
        className="text-muted-foreground text-sm"
        data-testid="genotyping-study-experiments-empty"
      >
        No experiments associated with this study yet.
      </p>
    )
  }
  return (
    <ul
      className="divide-y rounded-md border"
      data-testid="genotyping-study-experiments"
    >
      {rows.map((exp) => (
        <li
          key={String(exp.id ?? exp.experiment_name)}
          className="px-4 py-2 text-sm"
        >
          {exp.experiment_name ?? "(unnamed)"}
        </li>
      ))}
    </ul>
  )
}

function PlaceholderTab({ phase, kind }: { phase: string; kind: string }) {
  return (
    <div
      className="text-muted-foreground rounded-md border border-dashed px-4 py-8 text-center text-sm"
      data-testid={`genotyping-study-${kind}-placeholder`}
    >
      {kind} surface lands in Phase {phase}.
    </div>
  )
}

export function StudyDetail({ studyId }: { studyId: string }) {
  return (
    <div className="container max-w-6xl space-y-6 px-4 py-6">
      <Link
        to="/genotyping"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to studies
      </Link>

      <StudyInfoBlock studyId={studyId} />

      <Tabs defaultValue="experiments">
        <TabsList>
          <TabsTrigger value="experiments">Experiments</TabsTrigger>
          <TabsTrigger value="records">Records</TabsTrigger>
          <TabsTrigger value="variants">Variants</TabsTrigger>
          <TabsTrigger value="gwas">GWAS</TabsTrigger>
        </TabsList>
        <TabsContent value="experiments">
          <ExperimentsTab studyId={studyId} />
        </TabsContent>
        <TabsContent value="records">
          <RecordsTab studyId={studyId} />
        </TabsContent>
        <TabsContent value="variants">
          <PlaceholderTab phase="9c" kind="variants" />
        </TabsContent>
        <TabsContent value="gwas">
          <PlaceholderTab phase="9d" kind="gwas" />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default function StudyDetailRouteShim() {
  return (
    <div className="text-muted-foreground p-6 text-sm">
      Use the route component to inject the studyId param.
    </div>
  )
}
