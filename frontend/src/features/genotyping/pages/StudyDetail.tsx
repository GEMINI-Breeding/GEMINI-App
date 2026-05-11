/**
 * Genotyping study detail page.
 *
 * Phase 9a: Experiments tab (associated experiments list).
 * Phase 9b: Records tab (paginated records browser).
 * Phase 9c: Variants tab — placeholder.
 * Phase 9d: GWAS tab — submit form + recent runs panel.
 *
 * The tab values are URL-stable via `?tab=` so the GWAS job-detail page
 * can route back via Link with the tab preserved, and so the E2E can
 * deep-link any tab.
 */

import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { ArrowLeft } from "lucide-react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { GwasTab } from "@/features/genotyping/components/GwasTab"
import { RecordsTab } from "@/features/genotyping/components/RecordsTab"
import {
  useGenotypingStudy,
  useGenotypingStudyExperiments,
} from "@/features/genotyping/hooks/useGenotypingStudies"

export const STUDY_TABS = ["experiments", "records", "variants", "gwas"] as const
export type StudyTab = (typeof STUDY_TABS)[number]

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
  const navigate = useNavigate()
  const search = useSearch({ from: "/_layout/genotyping/$studyId" }) as {
    tab?: StudyTab
  }
  const activeTab: StudyTab = search.tab ?? "experiments"

  function setTab(next: string) {
    if (!STUDY_TABS.includes(next as StudyTab)) return
    navigate({
      to: "/genotyping/$studyId",
      params: { studyId },
      search: { tab: next as StudyTab },
      replace: true,
    })
  }

  return (
    <div className="container max-w-6xl space-y-6 px-4 py-6">
      <Link
        to="/genotyping"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to studies
      </Link>

      <StudyInfoBlock studyId={studyId} />

      <Tabs value={activeTab} onValueChange={setTab}>
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
          <GwasTab studyId={studyId} />
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
