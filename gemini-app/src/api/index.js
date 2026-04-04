/**
 * GEMINI API abstraction layer.
 *
 * Re-exports all API modules for convenient imports:
 *   import { FLASK_URL, getExperiments, trainModel } from '../api';
 */

export { BACKEND_MODE, FLASK_URL, FRAMEWORK_URL, TILE_SERVER_URL, getBaseUrl, registerFrameworkDomain } from './config';
export { fetchJson, postJson, postFormData } from './client';
export * from './entities';
export * from './files';
export * from './processing';
export * from './jobs';
