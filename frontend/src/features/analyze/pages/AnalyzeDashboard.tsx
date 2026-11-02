import { useQuery } from "@tanstack/react-query"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { type TraitOutput, TraitsService } from "@/client"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AnalyzeMap } from "./AnalyzeMap"
import { AnalyzeQuery } from "./AnalyzeQuery"
import { AnalyzeTable } from "./AnalyzeTable"
import { MultivariateAnalyze } from "./MultivariateAnalyze"
import { SingleTrait } from "./SingleTrait"

type View = "table" | "query" | "single" | "multi" | "map"

export function AnalyzeDashboard() {
  const navigate = useNavigate()
  const search = useSearch({ from: "/_layout/analyze/" })
  // The table first; a link to a trait opens that trait.
  const view: View = search.view ?? (search.trait ? "single" : "table")

  const traitsQuery = useQuery({
    queryKey: ["analyze", "traits"],
    queryFn: () =>
      TraitsService.apiTraitsAllGetAllTraits({ limit: 500, offset: 0 }),
  })
  const traits: TraitOutput[] = (traitsQuery.data as TraitOutput[] | null) ?? []
  const link = search.trait ? search : null

  return (
    <div
      className="flex flex-col gap-6 p-6"
      style={{ minHeight: "calc(100vh - 64px)" }}
    >
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Analyze</h1>
        <p className="text-muted-foreground">
          Trait readings plot by plot through the season, plot images by date,
          and comparisons across genotypes, seasons and sites.
        </p>
      </div>

      <Tabs
        value={view}
        onValueChange={(v) =>
          navigate({
            to: "/analyze",
            search: { view: v === "table" ? undefined : (v as View) },
            replace: false,
          })
        }
      >
        <TabsList>
          <TabsTrigger value="table" data-testid="analyze-tab-table">
            Table
          </TabsTrigger>
          <TabsTrigger value="query" data-testid="analyze-tab-query">
            Query
          </TabsTrigger>
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

        <TabsContent value="table" className="mt-6">
          <AnalyzeTable />
        </TabsContent>
        <TabsContent value="query" className="mt-6">
          <AnalyzeQuery />
        </TabsContent>
        <TabsContent value="single" className="mt-6">
          <SingleTrait
            traits={traits}
            traitsLoading={traitsQuery.isLoading}
            link={link}
          />
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
