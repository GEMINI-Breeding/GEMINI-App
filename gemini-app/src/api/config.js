/**
 * API configuration for backend connections.
 *
 * Supports three modes via REACT_APP_BACKEND_MODE:
 *   - "flask"     : all calls go to Flask backend (default, current behavior)
 *   - "framework" : all calls go to gemini-framework backend
 *   - "hybrid"    : some calls go to framework, others to Flask (for incremental migration)
 */

const getBackendConfig = () => {
    // Runtime config (production/docker)
    if (window.RUNTIME_CONFIG) {
        return {
            flaskPort: window.RUNTIME_CONFIG.FLASK_PORT,
            flaskHost: window.RUNTIME_CONFIG.FLASK_HOST,
            frameworkPort: window.RUNTIME_CONFIG.FRAMEWORK_PORT || '7777',
            frameworkHost: window.RUNTIME_CONFIG.FRAMEWORK_HOST || window.RUNTIME_CONFIG.FLASK_HOST,
            tileServerPort: window.RUNTIME_CONFIG.TILE_SERVER_PORT,
            tileServerHost: window.RUNTIME_CONFIG.TILE_SERVER_HOST,
            storageBucket: window.RUNTIME_CONFIG.STORAGE_BUCKET || 'gemini',
            backendMode: window.RUNTIME_CONFIG.BACKEND_MODE || 'flask',
        };
    }
    // Development - use .env
    return {
        flaskPort: process.env.REACT_APP_FLASK_PORT || '5000',
        flaskHost: 'localhost',
        frameworkPort: process.env.REACT_APP_FRAMEWORK_PORT || '7777',
        frameworkHost: process.env.REACT_APP_FRAMEWORK_HOST || 'localhost',
        tileServerPort: process.env.REACT_APP_TILE_SERVER_PORT || '8091',
        tileServerHost: process.env.REACT_APP_TILE_SERVER_HOST || 'localhost',
        storageBucket: process.env.REACT_APP_STORAGE_BUCKET || 'gemini',
        backendMode: process.env.REACT_APP_BACKEND_MODE || 'flask',
    };
};

const config = getBackendConfig();

export const BACKEND_MODE = config.backendMode;
export const FLASK_URL = `http://${config.flaskHost}:${config.flaskPort}/flask_app/`;
export const FRAMEWORK_URL = `http://${config.frameworkHost}:${config.frameworkPort}/api/`;
export const TILE_SERVER_URL = `http://${config.tileServerHost}:${config.tileServerPort}`;
export const STORAGE_BUCKET = config.storageBucket;

/**
 * Returns the appropriate base URL for a given API domain.
 * In hybrid mode, this allows gradual migration of specific domains to the framework.
 */
const frameworkDomains = new Set();

export const getBaseUrl = (domain) => {
    if (BACKEND_MODE === 'framework') return FRAMEWORK_URL;
    if (BACKEND_MODE === 'hybrid' && frameworkDomains.has(domain)) return FRAMEWORK_URL;
    return FLASK_URL;
};

/**
 * Register a domain as migrated to the framework (used in hybrid mode).
 */
export const registerFrameworkDomain = (domain) => {
    frameworkDomains.add(domain);
};

export default config;
