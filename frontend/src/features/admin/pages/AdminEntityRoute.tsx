/**
 * Wraps AdminEntityPage. The shared admin tabs strip + auth guard are
 * provided by the parent layout route at /_layout/admin.tsx, so this
 * component is just the entity body.
 */
import { AdminEntityPage } from "@/features/admin/components/AdminEntityPage"
import type { EntityConfig } from "@/features/admin/lib/types"

export function AdminEntityRoute<TOut extends object, TIn extends Record<string, unknown>>({
  config,
}: {
  config: EntityConfig<TOut, TIn>
}) {
  return <AdminEntityPage config={config} />
}
