/**
 * Submission form for a GWAS run.
 *
 * Mirrors the legacy gemini-ui form 1:1 in fields and testids; restyled
 * to shadcn / Tailwind. Lives inside the GWAS tab on StudyDetail so
 * `studyId` is injected as a prop (no study picker — the legacy
 * `gwas-study-select` testid stays on a disabled, decorative read-only
 * input so E2E parity holds).
 */
import { useNavigate } from "@tanstack/react-router"
import { ChevronDown, ChevronRight, Play } from "lucide-react"
import { useMemo, useState } from "react"

import { ExperimentsService, type GwasSubmitInput } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useProcess } from "@/contexts/ProcessContext"
import { idAsString } from "@/features/admin/lib/ids"
import {
  useDatasetTraits,
  useExperimentDatasets,
  useSubmitGwas,
} from "@/features/genotyping/hooks/useGwas"
import { useGenotypingStudy } from "@/features/genotyping/hooks/useGenotypingStudies"
import useCustomToast from "@/hooks/useCustomToast"
import { useQuery } from "@tanstack/react-query"

type Model = "lmm" | "mvlmm" | "bslmm"
type LmmTest = "wald" | "lrt" | "score" | "all"
type Agg = "mean" | "median" | "first"

const SELECT_CLS =
  "border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50"

export interface GwasSubmitFormProps {
  studyId: string
}

export function GwasSubmitForm({ studyId }: GwasSubmitFormProps) {
  const navigate = useNavigate()
  const study = useGenotypingStudy(studyId)
  const { addProcess } = useProcess()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const [experimentId, setExperimentId] = useState<string>("")
  const [datasetId, setDatasetId] = useState<string>("")
  const [selectedTraits, setSelectedTraits] = useState<Set<string>>(new Set())

  const [model, setModel] = useState<Model>("lmm")
  const [lmmTest, setLmmTest] = useState<LmmTest>("wald")
  const [nPcs, setNPcs] = useState<number>(3)
  const [phenotypeAgg, setPhenotypeAgg] = useState<Agg>("mean")
  const [maf, setMaf] = useState<number>(0.05)
  const [geno, setGeno] = useState<number>(0.1)
  const [mind, setMind] = useState<number>(0.1)
  // HWE filtering defaults OFF. The standard p<1e-6 threshold is calibrated
  // for natural-mating populations; on the inbred / RIL / MAGIC panels
  // typical of crop breeding it removes essentially every variant
  // (Wright's F statistic ≫ 0 by design). Users with outbred natural
  // panels can re-enable by setting a non-zero threshold in the
  // Advanced panel.
  const [hwe, setHwe] = useState<number>(0)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const experimentsQuery = useQuery({
    queryKey: ["experiments", "all"],
    queryFn: () =>
      ExperimentsService.apiExperimentsAllGetAllExperiments({
        limit: 500,
        offset: 0,
      }),
  })
  const datasetsQuery = useExperimentDatasets(experimentId || null)
  const traitsQuery = useDatasetTraits(datasetId || null)

  const submitMutation = useSubmitGwas()
  const submitError = submitMutation.error?.message ?? null

  const traitIds = useMemo(() => Array.from(selectedTraits), [selectedTraits])
  const canSubmit =
    Boolean(experimentId) &&
    Boolean(datasetId) &&
    traitIds.length > 0 &&
    !submitMutation.isPending &&
    (model !== "mvlmm" || traitIds.length >= 2)

  function toggleTrait(id: string) {
    setSelectedTraits((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    const payload: GwasSubmitInput = {
      study_id: studyId,
      experiment_id: experimentId,
      dataset_id: datasetId,
      model,
      lmm_test: lmmTest,
      n_pcs: nPcs,
      phenotype_agg: phenotypeAgg,
      qc: { maf, geno, mind, hwe },
      ...(model === "mvlmm"
        ? { trait_ids: traitIds }
        : traitIds.length === 1
          ? { trait_id: traitIds[0] }
          : { trait_ids: traitIds }),
    }
    submitMutation.mutate(payload, {
      onSuccess: (jobs) => {
        // Pop each spawned job into the global ProcessPanel so it
        // tracks alongside ODM / trait-extract jobs. The `link` brings
        // the user back to the GWAS job-detail page from the panel.
        // Note: rehydration on page reload won't re-register these
        // (findRunByJobId only matches Process-Wizard runs), but the
        // Recent Runs table on this tab covers cross-reload visibility.
        for (const job of jobs) {
          if (job?.id == null) continue
          const jobIdStr = idAsString(job.id)
          addProcess({
            type: "processing",
            title: `GWAS — ${study.data?.study_name ?? "study"}`,
            status: "running",
            items: [],
            runId: jobIdStr,
            link: `/genotyping/${studyId}/gwas/${jobIdStr}`,
          })
        }
        if (jobs.length === 1) {
          showSuccessToast("GWAS job submitted")
        } else {
          showSuccessToast(
            `${jobs.length} GWAS jobs submitted (one per trait)`,
          )
        }

        const first = jobs[0]
        if (jobs.length === 1 && first?.id != null) {
          navigate({
            to: "/genotyping/$studyId/gwas/$jobId",
            params: { studyId, jobId: idAsString(first.id) },
          })
        } else {
          setSelectedTraits(new Set())
        }
      },
      onError: (err) => {
        showErrorToast(
          err instanceof Error ? err.message : "Failed to submit GWAS job",
        )
      },
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Source data */}
      <section className="space-y-4 rounded-md border p-5">
        <h2 className="text-muted-foreground text-sm font-semibold uppercase tracking-wider">
          Source data
        </h2>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">Experiment</label>
            <select
              data-testid="gwas-experiment-select"
              value={experimentId}
              onChange={(e) => {
                setExperimentId(e.target.value)
                setDatasetId("")
                setSelectedTraits(new Set())
              }}
              className={SELECT_CLS}
            >
              <option value="">— select an experiment —</option>
              {experimentsQuery.data?.map((exp) => (
                <option key={idAsString(exp.id)} value={idAsString(exp.id)}>
                  {exp.experiment_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Genotyping study
            </label>
            <select
              data-testid="gwas-study-select"
              value={studyId}
              disabled
              className={SELECT_CLS}
            >
              <option value={studyId}>
                {study.data?.study_name ?? "(current study)"}
              </option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Trait dataset
            </label>
            <select
              data-testid="gwas-dataset-select"
              value={datasetId}
              onChange={(e) => {
                setDatasetId(e.target.value)
                setSelectedTraits(new Set())
              }}
              disabled={!experimentId}
              className={SELECT_CLS}
            >
              <option value="">
                {experimentId
                  ? "— select a dataset —"
                  : "pick an experiment first"}
              </option>
              {datasetsQuery.data?.map((d) => (
                <option key={idAsString(d.id)} value={idAsString(d.id)}>
                  {d.dataset_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              Traits{" "}
              <span className="text-muted-foreground text-xs">
                ({selectedTraits.size} selected
                {model === "mvlmm" && ", ≥2 required"})
              </span>
            </label>
            <div
              data-testid="gwas-trait-list"
              className="max-h-48 overflow-y-auto rounded-md border p-2 text-sm"
            >
              {!datasetId && (
                <p className="text-muted-foreground">Pick a dataset first</p>
              )}
              {datasetId &&
                (!traitsQuery.data || traitsQuery.data.length === 0) && (
                  <p className="text-muted-foreground">
                    No traits in this dataset
                  </p>
                )}
              {traitsQuery.data?.map((t) => {
                const id = idAsString(t.id)
                return (
                  <label
                    key={id}
                    className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded px-1 py-1"
                  >
                    <input
                      type="checkbox"
                      data-testid={`gwas-trait-checkbox-${t.trait_name}`}
                      checked={selectedTraits.has(id)}
                      onChange={() => toggleTrait(id)}
                    />
                    <span>{t.trait_name}</span>
                    {t.trait_units && (
                      <span className="text-muted-foreground text-xs">
                        ({t.trait_units})
                      </span>
                    )}
                  </label>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Model */}
      <section className="space-y-4 rounded-md border p-5">
        <h2 className="text-muted-foreground text-sm font-semibold uppercase tracking-wider">
          Model
        </h2>

        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium">
              Association model
            </label>
            <select
              data-testid="gwas-model-select"
              value={model}
              onChange={(e) => setModel(e.target.value as Model)}
              className={SELECT_CLS}
            >
              <option value="lmm">
                Linear mixed model (LMM) — kinship only
              </option>
              <option value="mvlmm">
                Multi-trait LMM (mvLMM) — requires ≥2 traits
              </option>
              <option value="bslmm">Bayesian sparse LMM (BSLMM)</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">LMM test</label>
            <select
              data-testid="gwas-lmm-test-select"
              value={lmmTest}
              onChange={(e) => setLmmTest(e.target.value as LmmTest)}
              disabled={model !== "lmm"}
              className={SELECT_CLS}
            >
              <option value="wald">Wald</option>
              <option value="lrt">LRT</option>
              <option value="score">Score</option>
              <option value="all">All three</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              PC covariates{" "}
              <span className="text-muted-foreground text-xs">({nPcs})</span>
            </label>
            <input
              data-testid="gwas-npcs-slider"
              type="range"
              min={0}
              max={10}
              step={1}
              value={nPcs}
              onChange={(e) => setNPcs(Number(e.target.value))}
              className="w-full"
            />
          </div>
        </div>
      </section>

      {/* Advanced (collapsible) */}
      <section className="space-y-4 rounded-md border p-5">
        <button
          data-testid="gwas-advanced-toggle"
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm font-semibold uppercase tracking-wider"
        >
          {showAdvanced ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          QC thresholds &amp; aggregation
        </button>
        {showAdvanced && (
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Min MAF</label>
              <Input
                data-testid="gwas-qc-maf"
                type="number"
                step="0.01"
                min="0"
                max="0.5"
                value={maf}
                onChange={(e) => setMaf(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Max variant missing rate
              </label>
              <Input
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={geno}
                onChange={(e) => setGeno(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Max sample missing rate
              </label>
              <Input
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={mind}
                onChange={(e) => setMind(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                HWE p-value min
              </label>
              <Input
                type="number"
                step="1e-6"
                min="0"
                max="1"
                value={hwe}
                onChange={(e) => setHwe(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Phenotype aggregation (per accession)
              </label>
              <select
                value={phenotypeAgg}
                onChange={(e) => setPhenotypeAgg(e.target.value as Agg)}
                className={SELECT_CLS}
              >
                <option value="mean">Mean</option>
                <option value="median">Median</option>
                <option value="first">First observation</option>
              </select>
            </div>
          </div>
        )}
      </section>

      {submitError && (
        <div className="border-destructive bg-destructive/10 text-destructive rounded-md border p-3 text-sm">
          {submitError}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          {model === "mvlmm" && traitIds.length >= 2 && (
            <>Will run 1 joint mvLMM job across {traitIds.length} traits.</>
          )}
          {model !== "mvlmm" && traitIds.length > 1 && (
            <>
              Will fan out into {traitIds.length} independent{" "}
              {model.toUpperCase()} jobs.
            </>
          )}
          {traitIds.length === 1 && <>Will run 1 {model.toUpperCase()} job.</>}
        </p>
        <Button data-testid="gwas-submit" type="submit" disabled={!canSubmit}>
          <Play className="mr-2 h-4 w-4" />
          {submitMutation.isPending ? "Submitting…" : "Run GWAS"}
        </Button>
      </div>
    </form>
  )
}
