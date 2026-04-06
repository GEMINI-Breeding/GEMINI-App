/**
 * Tests for API config module.
 * Tests URL construction for the framework backend.
 */

// Save original env
const originalEnv = process.env;

beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    // Clear any runtime config
    delete window.RUNTIME_CONFIG;
});

afterAll(() => {
    process.env = originalEnv;
});

describe("API config", () => {
    test("FRAMEWORK_URL has trailing slash", () => {
        process.env.REACT_APP_FRAMEWORK_PORT = "7777";
        const { FRAMEWORK_URL } = require("../config");
        expect(FRAMEWORK_URL).toMatch(/\/api\/$/);
    });

    test("TILE_SERVER_URL uses configured port", () => {
        process.env.REACT_APP_TILE_SERVER_PORT = "9999";
        const { TILE_SERVER_URL } = require("../config");
        expect(TILE_SERVER_URL).toContain("9999");
    });

    test("RUNTIME_CONFIG overrides env vars when present", () => {
        window.RUNTIME_CONFIG = {
            FRAMEWORK_PORT: "8888",
            FRAMEWORK_HOST: "fw-host",
            TILE_SERVER_PORT: "9999",
            TILE_SERVER_HOST: "tile-host",
        };
        const { FRAMEWORK_URL, TILE_SERVER_URL } = require("../config");
        expect(FRAMEWORK_URL).toContain("fw-host:8888");
        expect(TILE_SERVER_URL).toContain("tile-host:9999");
    });

    test("RUNTIME_CONFIG defaults for framework port when not set", () => {
        window.RUNTIME_CONFIG = {
            FLASK_HOST: "myhost",
            TILE_SERVER_PORT: "8091",
            TILE_SERVER_HOST: "myhost",
        };
        const { FRAMEWORK_URL } = require("../config");
        // Should default to port 7777
        expect(FRAMEWORK_URL).toContain("7777");
    });

    test("FRAMEWORK_URL ends with trailing slash", () => {
        const { FRAMEWORK_URL } = require("../config");
        expect(FRAMEWORK_URL.endsWith("/")).toBe(true);
    });
});
