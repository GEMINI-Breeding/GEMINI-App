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
export const SettingsService = makeThrowingService("SettingsService")
// LoginService and PrivateService had no callers left after Phase 5
// (recover/reset-password only reference the name in comments; the
// tests/utils/privateApi.ts seeder was deleted in the same pass).

// Deliberately permissive type aliases — real shapes live elsewhere once
// the rewrite of each page lands (Phases 6–11).
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
export type PipelinePublic = any
export type PipelineRunPublic = any
export type FileUploadPublic = any
export type ReferenceDatasetWithMatch = any
export type ReferenceDatasetPublic = any

// ──────────────────────────────────────────────────────────────────────────
// Runtime augmentation of regenerated services with legacy method names.
//
// Pre-migration feature pages call methods that don't exist on the new SDK
// (e.g. FilesService.readFiles, ReferenceDataService.listDatasets). Rather
// than rewrite every call site (Phase 6/10 work), attach throwing stubs
// and declare the method names via module augmentation so TS accepts them.
// Every attached method fails loudly at runtime; compilation passes.
// ──────────────────────────────────────────────────────────────────────────
import {
  FilesService as _FilesService,
  ReferenceDataService as _ReferenceDataService,
  UtilsService as _UtilsService,
} from "./sdk.gen"

function _attach(svc: any, methods: string[], label: string): void {
  for (const m of methods) {
    if (typeof svc[m] !== "function") {
      svc[m] = () => NOT_IMPL(`${label}.${m}`)
    }
  }
}

_attach(
  _FilesService,
  [
    "readFiles",
    "readFieldValues",
    "deleteFile",
    "updateFile",
    "syncFiles",
    "extractMetadata",
  ],
  "FilesService",
)
_attach(
  _ReferenceDataService,
  [
    "listDatasets",
    "listWorkspaceDatasets",
    "matchPlot",
    "associateDataset",
    "removeDatasetFromWorkspace",
  ],
  "ReferenceDataService",
)
_attach(_UtilsService, ["capabilities", "dockerCheck"], "UtilsService")

declare module "./sdk.gen" {
  namespace FilesService {
    function readFiles(...args: any[]): Promise<any>
    function readFieldValues(...args: any[]): Promise<any>
    function deleteFile(...args: any[]): Promise<any>
    function updateFile(...args: any[]): Promise<any>
    function syncFiles(...args: any[]): Promise<any>
    function extractMetadata(...args: any[]): Promise<any>
  }
  namespace ReferenceDataService {
    function listDatasets(...args: any[]): Promise<any>
    function listWorkspaceDatasets(...args: any[]): Promise<any>
    function matchPlot(...args: any[]): Promise<any>
    function associateDataset(...args: any[]): Promise<any>
    function removeDatasetFromWorkspace(...args: any[]): Promise<any>
  }
  namespace UtilsService {
    function capabilities(...args: any[]): Promise<any>
    function dockerCheck(...args: any[]): Promise<any>
  }
}
