/**
 * Genotyping study page.
 *
 * Opens on an overview: what the study holds (markers, samples, source
 * file, linked experiments) and every GWAS run as a tile with its
 * Manhattan plot, so results are visible without clicking in. "New GWAS"
 * holds the run form and the full runs table; "Records" browses the
 * genotype calls.
 *
 * The tab is kept in `?tab=` so links (the run page's "Back to study",
 * tests) can open a given tab. Older links (`experiments`, `variants`)
 * open the overview.
 */

import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import {
  ArrowLeft,
  Bot,
  Dna,
  FileText,
  FileUp,
  FlaskConical,
  Play,
} from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { idAsString } from "@/features/admin/lib/ids"
import { GwasRunTile } from "@/features/genotyping/components/GwasRunTile"
import { GwasTab } from "@/features/genotyping/components/GwasTab"
import { RecordsTab } from "@/features/genotyping/components/RecordsTab"
import { TasselImportDialog } from "@/features/genotyping/components/TasselImportDialog"
import {
  useGenotypingStudy,
  useGenotypingStudyExperiments,
} from "@/features/genotyping/hooks/useGenotypingStudies"
import {
  useStudyGwasJobs,
  useTraitNameMap,
} from "@/features/genotyping/hooks/useGwas"
import { sizeLine, studyFacts } from "@/features/genotyping/lib/studyInfo"

export const STUDY_TABS = ["overview", "gwas", "records"] as const
export type StudyTab = (typeof STUDY_TABS)[number]

function Fact({
  icon: Icon,
  children,
  title,
}: {
  icon: typeof Dna
  children: React.ReactNode
  title?: string
}) {
  return (
    <span
      className="bg-muted text-muted-foreground inline-flex max-w-full items-center gap-1.5 truncate rounded-md px-2 py-1 text-xs"
      title={title}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{children}</span>
    </span>
  )
}

function StudyHeader({ studyId }: { studyId: string }) {
  const study = useGenotypingStudy(studyId)
  const experiments = useGenotypingStudyExperiments(studyId)
  if (study.isLoading) {
    return <div className="bg-muted h-16 w-2/3 animate-pulse rounded-md" />
  }
  if (study.isError || !study.data) {
    return (
      <p className="text-sm text-red-600" data-testid="genotyping-study-error">
        {study.error?.message ?? "Study not found."}
      </p>
    )
  }
  const facts = studyFacts(study.data.study_info)
  const expNames = (experiments.data ?? [])
    .map((e) => e.experiment_name)
    .filter(Boolean) as string[]
  return (
    <div className="space-y-2">
      <h1
        className="text-2xl font-bold tracking-tight"
        data-testid="genotyping-study-title"
      >
        {study.data.study_name ?? "(unnamed)"}
      </h1>
      <div
        className="flex flex-wrap gap-1.5"
        data-testid="genotyping-study-facts"
      >
        {sizeLine(facts) && <Fact icon={Dna}>{sizeLine(facts)}</Fact>}
        {facts.sourceFile && (
          <Fact icon={FileText} title={facts.sourceFile}>
            {facts.sourceFile}
          </Fact>
        )}
        <span data-testid="genotyping-study-experiments">
          <Fact icon={FlaskConical} title="Experiments whose lines these are">
            {expNames.length ? expNames.join(", ") : "No experiment linked"}
          </Fact>
        </span>
        {facts.byAgent && <Fact icon={Bot}>Brought in by the agent</Fact>}
        {facts.mock && (
          <span className="rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
            Made-up data: nothing found in it is a result
          </span>
        )}
        {facts.notes.map(([k, v]) => (
          <Fact key={k} icon={FileText}>
            {k}: {v}
          </Fact>
        ))}
      </div>
    </div>
  )
}

function Overview({
  studyId,
  onNewRun,
}: {
  studyId: string
  onNewRun: () => void
}) {
  const jobs = useStudyGwasJobs(studyId)
  const traitNames = useTraitNameMap()
  const [importing, setImporting] = useState(false)
  const importButton = (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setImporting(true)}
        data-testid="tassel-import-open"
      >
        <FileUp className="mr-1.5 h-4 w-4" /> Import TASSEL results
      </Button>
      <TasselImportDialog
        studyId={studyId}
        open={importing}
        onOpenChange={setImporting}
      />
    </>
  )
  const runs = [...(jobs.data ?? [])].sort((a, b) =>
    String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")),
  )
  if (jobs.isLoading)
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-muted h-52 animate-pulse rounded-lg" />
        ))}
      </div>
    )
  if (runs.length === 0)
    return (
      <div
        className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center"
        data-testid="genotyping-overview-empty"
      >
        <Dna className="text-muted-foreground h-9 w-9" />
        <p className="font-medium">No GWAS yet</p>
        <p className="text-muted-foreground max-w-md text-sm">
          Test a measured trait against these markers: pick the experiment and
          trait, and the results (Manhattan and QQ plots, strongest markers)
          appear here. Runs already done in TASSEL can be imported too.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={onNewRun}>
            <Play className="mr-1.5 h-4 w-4" /> New GWAS
          </Button>
          {importButton}
        </div>
      </div>
    )
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          {runs.length} GWAS run{runs.length === 1 ? "" : "s"}, newest first.
          Open one for its plots and strongest markers.
        </p>
        <div className="flex gap-2">
          {importButton}
          <Button size="sm" onClick={onNewRun}>
            <Play className="mr-1.5 h-4 w-4" /> New GWAS
          </Button>
        </div>
      </div>
      <div
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        data-testid="genotyping-overview-runs"
      >
        {runs.map((j) => (
          <GwasRunTile
            key={idAsString(j.id)}
            job={j}
            studyId={studyId}
            traitNames={traitNames.data}
          />
        ))}
      </div>
    </div>
  )
}

export function StudyDetail({ studyId }: { studyId: string }) {
  const navigate = useNavigate()
  const search = useSearch({ from: "/_layout/genotyping/$studyId" }) as {
    tab?: StudyTab
  }
  const activeTab: StudyTab = search.tab ?? "overview"

  function setTab(next: string) {
    if (!STUDY_TABS.includes(next as StudyTab)) return
    navigate({
      to: "/genotyping/$studyId",
      params: { studyId },
      search: { tab: next === "overview" ? undefined : (next as StudyTab) },
      replace: true,
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <Link
        to="/genotyping"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Genotyping
      </Link>

      <StudyHeader studyId={studyId} />

      <Tabs value={activeTab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="gwas">New GWAS</TabsTrigger>
          <TabsTrigger value="records">Records</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-4">
          <Overview studyId={studyId} onNewRun={() => setTab("gwas")} />
        </TabsContent>
        <TabsContent value="gwas" className="mt-4">
          <GwasTab studyId={studyId} />
        </TabsContent>
        <TabsContent value="records" className="mt-4">
          <RecordsTab studyId={studyId} />
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
