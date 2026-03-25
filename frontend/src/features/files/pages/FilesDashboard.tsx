import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ManageData } from "./ManageData"
import { UploadData } from "./UploadData"

export function FilesDashboard() {
  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 64px)" }}>
      <div className="flex-shrink-0 px-6 pt-5 pb-3">
        <h1 className="text-2xl font-semibold">Files</h1>
      </div>
      <div className="flex-1 overflow-auto px-6 pb-6">
        <Tabs defaultValue="upload">
          <TabsList className="mb-4">
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
    </div>
  )
}
