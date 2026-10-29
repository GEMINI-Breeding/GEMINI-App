/**
 * WhereSwitch — in the sidebar on every page: where the app's data and
 * processing are (this computer or a cluster session), whether that place
 * answers, and, in the desktop app, the switch to the other place.
 */
import { useNavigate } from "@tanstack/react-router"
import { Laptop, Server } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { agentApi } from "@/features/agent/lib/agentApi"
import { setStackMode } from "@/lib/stack"
import { useWhere, type Where } from "@/lib/where"

function dot(up: boolean | undefined) {
  return up === undefined
    ? "bg-muted-foreground/40"
    : up
      ? "bg-green-500"
      : "bg-amber-500"
}

/** Switching reloads the app on the other place's data (desktop app). */
async function switchTo(place: "computer" | "cluster") {
  if (place === "cluster") {
    setStackMode("cluster")
    // Open the tunnel to the session first; the app reconnects anyway if this fails.
    await agentApi.computeReconnect().catch(() => undefined)
  } else {
    setStackMode("local")
  }
  window.location.assign("/")
}

export function WhereMenuContent({ where }: { where: Where }) {
  const navigate = useNavigate()
  const other = where.place === "cluster" ? "computer" : "cluster"
  return (
    <>
      <DropdownMenuLabel className="space-y-1 font-normal">
        <p className="text-sm font-medium">Working on: {where.label}</p>
        <p className="text-muted-foreground text-xs">
          {where.detail ? `${where.detail}. ` : ""}
          {where.up === false
            ? "It is not answering right now."
            : "Experiments, runs and results shown in the app are the ones stored here, and new jobs run here."}
        </p>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      {where.canSwitch && (other === "computer" || where.cluster) ? (
        <DropdownMenuItem
          data-testid="where-switch"
          onClick={() => void switchTo(other)}
        >
          {other === "computer" ? (
            <Laptop className="mr-2 h-4 w-4" />
          ) : (
            <Server className="mr-2 h-4 w-4" />
          )}
          Switch to{" "}
          {other === "computer" ? "this computer" : `cluster ${where.cluster}`}
        </DropdownMenuItem>
      ) : null}
      {!where.cluster && (
        <DropdownMenuItem
          data-testid="where-setup-cluster"
          onClick={() =>
            navigate({ to: "/settings", search: { section: "compute" } })
          }
        >
          <Server className="mr-2 h-4 w-4" />
          Set up a cluster…
        </DropdownMenuItem>
      )}
      <DropdownMenuItem
        onClick={() =>
          navigate({ to: "/settings", search: { section: "compute" } })
        }
      >
        Compute settings
      </DropdownMenuItem>
      <p className="text-muted-foreground px-2 pt-1 pb-1.5 text-[11px] leading-snug">
        {where.canSwitch
          ? "Switching reloads the app. Nothing is stopped or moved: each place keeps its own experiments and data."
          : "This page is served for one place; the desktop app can switch between this computer and a cluster."}
      </p>
    </>
  )
}

export function WhereSwitch() {
  const where = useWhere()
  if (!where.place) return null
  const Icon = where.place === "cluster" ? Server : Laptop
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              data-testid="where-current"
              tooltip={`Working on: ${where.label}`}
            >
              <span className="relative">
                <Icon className="h-4 w-4" />
                <span
                  className={`absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full ${dot(where.up)}`}
                />
              </span>
              <span className="flex min-w-0 flex-col text-left leading-tight">
                <span className="truncate text-sm">{where.label}</span>
                <span className="text-muted-foreground truncate text-[11px]">
                  {where.detail}
                </span>
              </span>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" className="w-72">
            <WhereMenuContent where={where} />
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

/** One line for page headers: which place's data the page shows. */
export function WhereLine({ className = "" }: { className?: string }) {
  const where = useWhere()
  if (!where.place) return null
  const Icon = where.place === "cluster" ? Server : Laptop
  return (
    <p
      className={`text-muted-foreground flex items-center gap-1.5 text-xs ${className}`}
      data-testid="where-line"
    >
      <Icon className="h-3.5 w-3.5" />
      Data on{" "}
      {where.place === "cluster"
        ? `the cluster ${where.cluster ?? ""}`.trim()
        : "this computer"}
      {where.sharedBy ? ` (shared session of ${where.sharedBy})` : ""}
      <span
        className={`ml-0.5 inline-block h-1.5 w-1.5 rounded-full ${dot(where.up)}`}
      />
    </p>
  )
}
