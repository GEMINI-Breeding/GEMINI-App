/**
 * API configuration for backend connections.
 *
 * All calls go to the gemini-framework backend.
 */

const getBackendConfig = () => {
    // Runtime config (production/docker)
    if (window.RUNTIME_CONFIG) {
        return {
            frameworkPort: window.RUNTIME_CONFIG.FRAMEWORK_PORT || '7777',
            frameworkHost: window.RUNTIME_CONFIG.FRAMEWORK_HOST || window.RUNTIME_CONFIG.FLASK_HOST || 'localhost',
            tileServerPort: window.RUNTIME_CONFIG.TILE_SERVER_PORT,
            tileServerHost: window.RUNTIME_CONFIG.TILE_SERVER_HOST,
            storageBucket: window.RUNTIME_CONFIG.STORAGE_BUCKET || 'gemini',
        };
    }
    // Development - use .env
    return {
        frameworkPort: process.env.REACT_APP_FRAMEWORK_PORT || '7777',
        frameworkHost: process.env.REACT_APP_FRAMEWORK_HOST || 'localhost',
        tileServerPort: process.env.REACT_APP_TILE_SERVER_PORT || '8091',
        tileServerHost: process.env.REACT_APP_TILE_SERVER_HOST || 'localhost',
        storageBucket: process.env.REACT_APP_STORAGE_BUCKET || 'gemini',
    };
};

const config = getBackendConfig();

export const FRAMEWORK_URL = `http://${config.frameworkHost}:${config.frameworkPort}/api/`;
export const TILE_SERVER_URL = `http://${config.tileServerHost}:${config.tileServerPort}`;
export const STORAGE_BUCKET = config.storageBucket;

export default config;
