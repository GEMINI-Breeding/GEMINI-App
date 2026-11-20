import { useQuery } from "@tanstack/react-query"
import { Database, Dna, FlaskConical, Radio, Ruler, Users } from "lucide-react"

import {
  DatasetsService,
  ExperimentsService,
  GenotypingStudiesService,
  PopulationsService,
  SensorsService,
  TraitsService,
} from "@/client"
import { StatCard } from "./StatCard"

const STAT_LIMIT = 500

function formatCount(arr: unknown[] | undefined): string | number {
  if (!arr) return 0
  return arr.length > STAT_LIMIT ? `${STAT_LIMIT}+` : arr.length
}

export function StatsDashboard() {
  const experiments = useQuery({
    queryKey: ["stats", "experiments"],
    queryFn: () =>
      ExperimentsService.apiExperimentsAllGetAllExperiments({
        limit: STAT_LIMIT,
        offset: 0,
      }),
  })
  const datasets = useQuery({
    queryKey: ["stats", "datasets"],
    queryFn: () =>
      DatasetsService.apiDatasetsAllGetAllDatasets({
        limit: STAT_LIMIT,
        offset: 0,
      }),
  })
  const traits = useQuery({
    queryKey: ["stats", "traits"],
    queryFn: () =>
      TraitsService.apiTraitsAllGetAllTraits({
        limit: STAT_LIMIT,
        offset: 0,
      }),
  })
  const sensors = useQuery({
    queryKey: ["stats", "sensors"],
    queryFn: () =>
      SensorsService.apiSensorsAllGetAllSensors({
        limit: STAT_LIMIT,
        offset: 0,
      }),
  })
  const populations = useQuery({
    queryKey: ["stats", "populations"],
    queryFn: () =>
      PopulationsService.apiPopulationsAllGetAllPopulations({
        limit: STAT_LIMIT,
        offset: 0,
      }),
  })
  const studies = useQuery({
    queryKey: ["stats", "genotyping-studies"],
    queryFn: () =>
      GenotypingStudiesService.apiGenotypingStudiesAllGetAllStudies({
        limit: STAT_LIMIT,
        offset: 0,
      }),
  })

  return (
    <div
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      data-testid="stats-dashboard"
    >
      <StatCard
        title="Experiments"
        value={formatCount(experiments.data ?? undefined)}
        icon={FlaskConical}
        loading={experiments.isLoading}
      />
      <StatCard
        title="Datasets"
        value={formatCount(datasets.data ?? undefined)}
        icon={Database}
        loading={datasets.isLoading}
      />
      <StatCard
        title="Traits"
        value={formatCount(traits.data ?? undefined)}
        icon={Ruler}
        loading={traits.isLoading}
        href="/admin/traits"
      />
      <StatCard
        title="Sensors"
        value={formatCount(sensors.data ?? undefined)}
        icon={Radio}
        loading={sensors.isLoading}
        href="/admin/sensors"
      />
      <StatCard
        title="Populations"
        value={formatCount(populations.data ?? undefined)}
        icon={Users}
        loading={populations.isLoading}
        href="/admin/populations"
      />
      <StatCard
        title="Genotyping Studies"
        value={formatCount(studies.data ?? undefined)}
        icon={Dna}
        loading={studies.isLoading}
        href="/genotyping"
      />
    </div>
  )
}
