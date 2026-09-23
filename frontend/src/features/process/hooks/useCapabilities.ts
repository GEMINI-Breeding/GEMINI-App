/**
 * Backend capability preflight.
 *
 * `/api/utils/capabilities` says which job types have a live worker (the API
 * notes when each type was last polled for) and whether NodeODM answers, so
 * a step whose worker isn't running warns before its job sits in the queue.
 * Main warned about missing capabilities before running a step; this is the
 * compose-stack equivalent. (It used to look for AgRowStitch inside the API
 * container and for a Docker socket — neither is there in this stack, so it
 * warned on every stitch.)
 *
 * Failure here is never fatal: if the probe itself fails we return no warning
 * rather than blocking a step that might well work.
 */
import { useQuery } from "@tanstack/react-query"

import { UtilsService } from "@/client"

export interface Capabilities {
  agrowstitch: { available: boolean; path: string | null }
  /** Absent from older backends — then no ODM warning. */
  odm: { worker: boolean; nodeodm: boolean } | null
  torch_version: string | null
  cuda_available: boolean
  mps_available: boolean
  cpu_count: number | null
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
  const odm =
    typeof raw.odm === "object" && raw.odm !== null
      ? (raw.odm as Record<string, unknown>)
      : null
  return {
    agrowstitch: {
      available: agRec.available === true,
      path: typeof agRec.path === "string" ? agRec.path : null,
    },
    odm: odm
      ? { worker: odm.worker === true, nodeodm: odm.nodeodm === true }
      : null,
    torch_version:
      typeof raw.torch_version === "string" ? raw.torch_version : null,
    cuda_available: raw.cuda_available === true,
    mps_available: raw.mps_available === true,
    cpu_count: typeof raw.cpu_count === "number" ? raw.cpu_count : null,
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

/**
 * Warning text for a step, or undefined when there's nothing to say.
 *
 * Deliberately conservative: only warns when the backend positively reports
 * a missing capability. An unreachable probe yields no warning.
 */
export function capabilityWarningForStep(
  stepKey: string,
  caps: Capabilities | null | undefined,
): string | undefined {
  if (stepKey === "stitching" && caps && caps.agrowstitch.available === false) {
    return "No stitch worker is running, so this job would wait in the queue. Start the stack's stitch service (geminibase-worker-stitch)."
  }
  if (stepKey === "orthomosaic" && caps?.odm) {
    if (!caps.odm.worker)
      return "No ODM worker is running, so this job would wait in the queue. Start the stack's ODM service (geminibase-worker-odm)."
    if (!caps.odm.nodeodm)
      return "NodeODM isn't answering, so orthomosaic generation can't start. Start the stack's geminibase-nodeodm service."
  }
  return undefined
}
