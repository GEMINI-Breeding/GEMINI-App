import { SidebarAppearance } from "@/components/Common/Appearance"
import { Logo } from "@/components/Common/Logo"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
} from "@/components/ui/sidebar"
import { sidebarItems } from "@/config/navigation"
import { CreateExperimentDialog } from "@/features/experiments/components/CreateExperimentDialog"
import { ExperimentSelector } from "@/features/experiments/components/ExperimentSelector"
import { ScopeChildSelectors } from "@/features/experiments/components/ScopeChildSelectors"
import useAuth from "@/hooks/useAuth"
import { Main } from "./Main"
import { User } from "./User"

export function AppSidebar() {
  const { user } = useAuth()
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-4 py-6 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:items-center">
        <Logo variant="responsive" />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel className="flex items-center justify-between">
            <span>Experiment</span>
            <CreateExperimentDialog />
          </SidebarGroupLabel>
          <SidebarGroupContent className="space-y-2 px-2">
            <ExperimentSelector />
            <ScopeChildSelectors />
          </SidebarGroupContent>
        </SidebarGroup>
        <Main items={sidebarItems} />
      </SidebarContent>
      <SidebarFooter>
        <User user={user} />
        <SidebarAppearance />
      </SidebarFooter>
    </Sidebar>
  )
}

export default AppSidebar
