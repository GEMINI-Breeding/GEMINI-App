import { createFileRoute } from "@tanstack/react-router"

import ApplicationSettings from "@/components/UserSettings/ApplicationSettings"
import ChangePassword from "@/components/UserSettings/ChangePassword"
import UserInformation from "@/components/UserSettings/UserInformation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export const Route = createFileRoute("/_layout/settings")({
  component: UserSettings,
  head: () => ({
    meta: [{ title: "Settings" }],
  }),
})

function UserSettings() {
  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 64px)" }}>
      <div className="flex-shrink-0 px-6 pt-5 pb-3 border-b">
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-muted-foreground text-sm">
          Manage your application settings, profile and password
        </p>
      </div>
      <Tabs defaultValue="application" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-6 mt-3 self-start">
          <TabsTrigger
            value="application"
            data-testid="settings-tab-application"
          >
            Application
          </TabsTrigger>
          {/* The profile and password forms existed but were mounted
              nowhere, so nobody could change their own password. */}
          <TabsTrigger value="account" data-testid="settings-tab-account">
            Account
          </TabsTrigger>
        </TabsList>
        <TabsContent value="application" className="min-h-0 flex-1">
          <ApplicationSettings />
        </TabsContent>
        <TabsContent
          value="account"
          className="space-y-6 overflow-y-auto px-6 pb-6"
        >
          <UserInformation />
          <ChangePassword />
        </TabsContent>
      </Tabs>
    </div>
  )
}
