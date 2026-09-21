/**
 * Backend capability preflight.
 *
 * GEMINIbase exposes `/api/utils/capabilities` and `/api/utils/docker-check`,
 * and both have been live this whole time with no UI caller — so a user could
 * submit a stitch job on a stack with no AgRowStitch, or an ODM job with no
 * Docker, and only find out when the job failed minutes later. Main warned
 * about this before running a step; this restores that.
 *
 * Failure here is never fatal: if the probe itself fails we return no warning
 * rather than blocking a step that might well work.
 */
import { useQuery } from "@tanstack/react-query"

import { UtilsService } from "@/client"

export interface Capabilities {
  agrowstitch: { available: boolean; path: string | null }
  torch_version: string | null
  cuda_available: boolean
  mps_available: boolean
  cpu_count: number | null
}

export interface DockerStatus {
  available: boolean
  reason?: string | null
}

/**
 * Both endpoints are declared in the OpenAPI schema with no response model,
 * so the generated types are bare `{[key: string]: unknown}`. Narrow by
 * reading the fields we need rather than asserting a shape the schema
 * doesn't promise — a backend change then degrades to "no warning" instead
 * of a runtime crash on a missing property.
 */
function asCapabilities(raw: Record<string, unknown>): Capabilities | null {
  const ag = raw.agrowstitch
  if (typeof ag !== "object" || ag === null) return null
  const agRec = ag as Record<string, unknown>
  return {
    agrowstitch: {
      available: agRec.available === true,
      path: typeof agRec.path === "string" ? agRec.path : null,
    },
    torch_version:
      typeof raw.torch_version === "string" ? raw.torch_version : null,
    cuda_available: raw.cuda_available === true,
    mps_available: raw.mps_available === true,
    cpu_count: typeof raw.cpu_count === "number" ? raw.cpu_count : null,
  }
}

function asDockerStatus(raw: Record<string, unknown>): DockerStatus | null {
  if (typeof raw.available !== "boolean") return null
  return {
    available: raw.available,
    reason: typeof raw.reason === "string" ? raw.reason : null,
  }
}

export function useCapabilities() {
  return useQuery<Capabilities | null>({
    queryKey: ["utils", "capabilities"],
    queryFn: async () =>
      asCapabilities(await UtilsService.apiUtilsCapabilitiesCapabilities()),
    staleTime: 5 * 60_000,
    retry: false,
  })
}

export function useDockerStatus() {
  return useQuery<DockerStatus | null>({
    queryKey: ["utils", "docker-check"],
    queryFn: async () =>
      asDockerStatus(await UtilsService.apiUtilsDockerCheckDockerCheck()),
    staleTime: 60_000,
    retry: false,
  })
}

/**
 * Warning text for a step, or undefined when there's nothing to say.
 *
 * Deliberately conservative: only warns when the backend positively reports
 * a missing capability. An unreachable probe yields no warning.
 */
export function capabilityWarningForStep(
  stepKey: string,
  caps: Capabilities | null | undefined,
  docker: DockerStatus | null | undefined,
): string | undefined {
  if (stepKey === "stitching" && caps && caps.agrowstitch.available === false) {
    return "AgRowStitch isn't installed in the stitch worker, so this job will fail. See the stitch worker setup in merge_plan.md Phase 3."
  }
  if (stepKey === "orthomosaic" && docker && docker.available === false) {
    return `Docker isn't reachable from the backend (${docker.reason ?? "unknown"}), so orthomosaic generation can't start.`
  }
  return undefined
}
