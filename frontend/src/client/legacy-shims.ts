/**
 * Phase 4 transition shims.
 *
 * The pre-migration FastAPI backend had services/types that don't exist in
 * GEMINIbase: Items (FastAPI template cruft), Workspaces (folded into
 * Experiments), Analyze/Pipelines/Processing (whole feature areas being
 * rebuilt in Phase 5). Feature pages that reference those names are still
 * in the tree and need to import *something* so Vite can resolve the
 * module graph — they just shouldn't actually run.
 *
 * This file exports:
 *   - Placeholder service classes whose methods throw a clear error at
 *     runtime if a Phase-5 code path is accidentally entered.
 *   - Empty type aliases so `type X` imports compile.
 *
 * Every symbol exported here is a Phase 5 TODO. Do not build new code
 * against them. Do not rely on their runtime behaviour.
 */

const NOT_IMPL = (what: string): never => {
  throw new Error(
    `[legacy-shim] ${what} is from the pre-migration FastAPI backend ` +
      `and has no GEMINIbase equivalent yet. This code path is scheduled ` +
      `for rewrite in Phase 5 of the migration.`,
  )
}

// Make every method on the shim throw. We don't try to type each method
// individually — callers will compile against whatever they import and
// fail at runtime if exercised.
function makeThrowingService(name: string): any {
  return new Proxy(
    {},
    {
      get(_target, method) {
        return () => NOT_IMPL(`${name}.${String(method)}`)
      },
    },
  )
}

export const ItemsService = makeThrowingService("ItemsService")
export const WorkspacesService = makeThrowingService("WorkspacesService")
export const AnalyzeService = makeThrowingService("AnalyzeService")
export const PipelinesService = makeThrowingService("PipelinesService")
export const ProcessingService = makeThrowingService("ProcessingService")
export const LoginService = makeThrowingService("LoginService")

// Deliberately permissive type aliases — real shapes live elsewhere once
// the Phase 5 rewrite of each page lands.
export type ItemPublic = any
export type ItemCreate = any
export type ItemUpdate = any
export type WorkspacePublic = any
export type WorkspaceCreate = any
export type WorkspaceUpdate = any
export type Body_login_login_access_token = { username: string; password: string }
export type NewPassword = any
export type UserPublic = any
export type UsersPublic = any
