import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ManageData } from "./ManageData"
import { UploadData } from "./UploadData"

export function FilesDashboard() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <Tabs defaultValue="upload">
        <TabsList>
          <TabsTrigger value="upload">Upload</TabsTrigger>
          <TabsTrigger value="manage">Manage</TabsTrigger>
        </TabsList>
        <TabsContent value="upload">
          <UploadData />
        </TabsContent>
        <TabsContent value="manage">
          <ManageData />
        </TabsContent>
      </Tabs>
    </div>
  )
}
