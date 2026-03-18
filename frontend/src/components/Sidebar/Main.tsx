import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@radix-ui/react-collapsible";
import { Link as RouterLink, useRouterState } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import type { NavItem } from "@/config/navigation";

interface MainProps {
  items: NavItem[];
}

export function Main({ items }: MainProps) {
  const { isMobile, setOpenMobile, state, setOpen } = useSidebar();
  const router = useRouterState();
  const currentPath = router.location.pathname;

  const handleMenuClick = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  const handleCollapsibleClick = () => {
    if (state === "collapsed") {
      setOpen(true);
    }
  };

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const isActive = currentPath === item.path;
            const isSubItemActive = item.subItems?.some(
              (subItem) => currentPath === subItem.path
            );

            // Items WITH subItems - toggle dropdown only
            if (item.subItems) {
              return (
                <Collapsible
                  asChild
                  defaultOpen={false}
                  className="group/collapsible"
                  key={item.title}
                >
                  <SidebarMenuItem>
                    <CollapsibleTrigger
                      asChild
                      onClick={handleCollapsibleClick}
                    >
                      <SidebarMenuButton
                        tooltip={item.title}
                        isActive={isActive || isSubItemActive}
                      >
                        <item.icon />
                        <span>{item.title}</span>
                        <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {item.subItems.map((subItem) => (
                          <SidebarMenuSubItem key={subItem.title}>
                            <SidebarMenuSubButton
                              asChild
                              isActive={currentPath === subItem.path}
                            >
                              <RouterLink
                                to={subItem.path}
                                onClick={handleMenuClick}
                              >
                                {subItem.title}
                              </RouterLink>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              );
            }

            // Items WITHOUT subItems - navigate
            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  tooltip={item.title}
                  isActive={isActive}
                  asChild
                >
                  <RouterLink to={item.path} onClick={handleMenuClick}>
                    <item.icon />
                    <span>{item.title}</span>
                  </RouterLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
