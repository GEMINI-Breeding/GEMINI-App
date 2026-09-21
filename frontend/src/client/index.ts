// Auto-generated base (regenerate via `npm run generate-client`).
export { ApiError } from './core/ApiError';
export { CancelablePromise, CancelError } from './core/CancelablePromise';
export { OpenAPI, type OpenAPIConfig } from './core/OpenAPI';
export * from './sdk.gen';
export * from './types.gen';

// legacy-shims.ts is gone. It re-exported throwing stubs for services that
// existed in the old FastAPI backend (ItemsService, WorkspacesService,
// AnalyzeService, PipelinesService, ProcessingService, SettingsService) plus
// `any`-typed aliases, so call sites compiled and failed at runtime instead.
// Every consumer has been removed or repointed; anything this file exports
// now is generated from the live OpenAPI schema and actually exists.
