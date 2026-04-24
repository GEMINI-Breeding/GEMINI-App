// Auto-generated base (regenerate via `npm run generate-client`).
export { ApiError } from './core/ApiError';
export { CancelablePromise, CancelError } from './core/CancelablePromise';
export { OpenAPI, type OpenAPIConfig } from './core/OpenAPI';
export * from './sdk.gen';
export * from './types.gen';

// Phase 4 transition: re-export shims for services/types that existed in
// the old FastAPI backend but have no GEMINIbase equivalent yet. Every
// symbol here is a Phase 5 TODO — see `./legacy-shims.ts`.
export * from './legacy-shims';