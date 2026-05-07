import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ImageViewer } from "../components/ImageViewer"
import { StatsDashboard } from "../components/StatsDashboard"
import { TraitDataViewer } from "../components/TraitDataViewer"

export function ViewData() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">View Data</h1>
        <p className="text-muted-foreground">
          Browse tabular trait records and uploaded images, scoped to an
          experiment.
        </p>
      </div>

      <StatsDashboard />

      <Tabs defaultValue="traits" className="w-full">
        <TabsList>
          <TabsTrigger value="traits" data-testid="view-tab-traits">
            Trait records
          </TabsTrigger>
          <TabsTrigger value="images" data-testid="view-tab-images">
            Images
          </TabsTrigger>
        </TabsList>
        <TabsContent value="traits" className="mt-4">
          <TraitDataViewer />
        </TabsContent>
        <TabsContent value="images" className="mt-4">
          <ImageViewer />
        </TabsContent>
      </Tabs>
    </div>
  )
}
