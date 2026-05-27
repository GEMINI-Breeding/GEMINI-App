import { useQuery } from "@tanstack/react-query"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { useMemo, useState } from "react"

import { type TraitOutput, TraitsService } from "@/client"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { idAsString } from "@/features/admin/lib/ids"
import { TraitCharts } from "../components/TraitCharts"
import { AnalyzeMap } from "./AnalyzeMap"
import { MultivariateAnalyze } from "./MultivariateAnalyze"

export function AnalyzeDashboard() {
  const navigate = useNavigate()
  const search = useSearch({ from: "/_layout/analyze/" })
  const view = search.view ?? "single"

  const [traitId, setTraitId] = useState<string>("")

  const traitsQuery = useQuery({
    queryKey: ["analyze", "traits"],
    queryFn: () =>
      TraitsService.apiTraitsAllGetAllTraits({ limit: 500, offset: 0 }),
  })
  const traits: TraitOutput[] = (traitsQuery.data as TraitOutput[] | null) ?? []

  const selectedTrait = useMemo(
    () => traits.find((t) => idAsString(t.id) === traitId),
    [traits, traitId],
  )

  return (
    <div
      className="flex flex-col gap-6 p-6"
      style={{ minHeight: "calc(100vh - 64px)" }}
    >
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Analyze</h1>
        <p className="text-muted-foreground">
          Visualize trait records across experiments, seasons, sites, and
          genotypes.
        </p>
      </div>

      <Tabs
        value={view}
        onValueChange={(v) =>
          navigate({
            to: "/analyze",
            search: {
              view:
                v === "multi" || v === "map"
                  ? (v as "multi" | "map")
                  : undefined,
            },
            replace: false,
          })
        }
      >
        <TabsList>
          <TabsTrigger value="single" data-testid="analyze-tab-single">
            Single trait
          </TabsTrigger>
          <TabsTrigger value="multi" data-testid="analyze-tab-multivariate">
            Multivariate
          </TabsTrigger>
          <TabsTrigger value="map" data-testid="analyze-tab-map">
            Map
          </TabsTrigger>
        </TabsList>

        <TabsContent value="single" className="mt-6 flex flex-col gap-6">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <label
                htmlFor="analyze-trait"
                className="text-xs text-muted-foreground"
              >
                Trait
              </label>
              <Select value={traitId} onValueChange={setTraitId}>
                <SelectTrigger
                  id="analyze-trait"
                  className="w-72"
                  data-testid="analyze-trait-select"
                >
                  <SelectValue
                    placeholder={
                      traitsQuery.isLoading ? "Loading traits…" : "Pick a trait"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {traits.map((t) => (
                    <SelectItem key={idAsString(t.id)} value={idAsString(t.id)}>
                      {t.trait_name}
                      {t.trait_units ? ` (${t.trait_units})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {!traitId && (
            <p
              className="text-sm text-muted-foreground"
              data-testid="analyze-empty"
            >
              Pick a trait to see histograms, genotype-range, and per-season /
              per-site trends.
            </p>
          )}

          {traitId && selectedTrait && (
            <TraitCharts
              traitId={traitId}
              traitName={selectedTrait.trait_name}
              traitUnits={selectedTrait.trait_units ?? undefined}
            />
          )}
        </TabsContent>

        <TabsContent value="multi" className="mt-6">
          <MultivariateAnalyze
            traits={traits}
            traitsLoading={traitsQuery.isLoading}
          />
        </TabsContent>

        <TabsContent value="map" className="mt-6">
          <AnalyzeMap />
        </TabsContent>
      </Tabs>
    </div>
  )
}
