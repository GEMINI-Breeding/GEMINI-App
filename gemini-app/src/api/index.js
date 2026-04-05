/**
 * GEMINI API abstraction layer.
 *
 * Re-exports all API modules for convenient imports:
 *   import { FLASK_URL, getExperiments, trainModel } from '../api';
 */

export { BACKEND_MODE, FLASK_URL, FRAMEWORK_URL, TILE_SERVER_URL, STORAGE_BUCKET, getBaseUrl, registerFrameworkDomain } from './config';
export { fetchJson, postJson, postFormData } from './client';
export * from './entities';
export * from './files';
export * from './processing';
export * from './jobs';
export * from './queries';
export * from './gcp';
export * from './plots';
