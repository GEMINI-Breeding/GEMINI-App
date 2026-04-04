/**
 * Tests for API config module.
 * These test the URL construction and backend mode logic.
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
    test("defaults to flask backend mode", () => {
        process.env.REACT_APP_BACKEND_MODE = "flask";
        const { BACKEND_MODE } = require("../config");
        expect(BACKEND_MODE).toBe("flask");
    });

    test("FLASK_URL includes trailing slash", () => {
        process.env.REACT_APP_FLASK_PORT = "5050";
        const { FLASK_URL } = require("../config");
        expect(FLASK_URL).toMatch(/\/flask_app\/$/);
    });

    test("FRAMEWORK_URL has trailing slash", () => {
        process.env.REACT_APP_FRAMEWORK_PORT = "7777";
        const { FRAMEWORK_URL } = require("../config");
        expect(FRAMEWORK_URL).toMatch(/\/api\/$/);
    });

    test("getBaseUrl returns FLASK_URL in flask mode", () => {
        process.env.REACT_APP_BACKEND_MODE = "flask";
        const { getBaseUrl, FLASK_URL } = require("../config");
        expect(getBaseUrl("files")).toBe(FLASK_URL);
    });

    test("getBaseUrl returns FRAMEWORK_URL in framework mode", () => {
        process.env.REACT_APP_BACKEND_MODE = "framework";
        const { getBaseUrl, FRAMEWORK_URL } = require("../config");
        expect(getBaseUrl("files")).toBe(FRAMEWORK_URL);
    });

    test("hybrid mode returns FLASK_URL for unregistered domains", () => {
        process.env.REACT_APP_BACKEND_MODE = "hybrid";
        const { getBaseUrl, FLASK_URL } = require("../config");
        expect(getBaseUrl("unregistered")).toBe(FLASK_URL);
    });

    test("hybrid mode returns FRAMEWORK_URL for registered domains", () => {
        process.env.REACT_APP_BACKEND_MODE = "hybrid";
        const { getBaseUrl, registerFrameworkDomain, FRAMEWORK_URL } = require("../config");
        registerFrameworkDomain("files");
        expect(getBaseUrl("files")).toBe(FRAMEWORK_URL);
    });

    test("TILE_SERVER_URL uses configured port", () => {
        process.env.REACT_APP_TILE_SERVER_PORT = "9999";
        const { TILE_SERVER_URL } = require("../config");
        expect(TILE_SERVER_URL).toContain("9999");
    });

    test("RUNTIME_CONFIG overrides env vars when present", () => {
        window.RUNTIME_CONFIG = {
            FLASK_PORT: "6000",
            FLASK_HOST: "flask-host",
            FRAMEWORK_PORT: "8888",
            FRAMEWORK_HOST: "fw-host",
            TILE_SERVER_PORT: "9999",
            TILE_SERVER_HOST: "tile-host",
            BACKEND_MODE: "framework",
        };
        const { FLASK_URL, FRAMEWORK_URL, TILE_SERVER_URL, BACKEND_MODE } = require("../config");
        expect(FLASK_URL).toContain("flask-host:6000");
        expect(FRAMEWORK_URL).toContain("fw-host:8888");
        expect(TILE_SERVER_URL).toContain("tile-host:9999");
        expect(BACKEND_MODE).toBe("framework");
    });

    test("RUNTIME_CONFIG defaults for framework when not set", () => {
        window.RUNTIME_CONFIG = {
            FLASK_PORT: "5000",
            FLASK_HOST: "myhost",
            TILE_SERVER_PORT: "8091",
            TILE_SERVER_HOST: "myhost",
        };
        const { FRAMEWORK_URL, BACKEND_MODE } = require("../config");
        // Should default to port 7777 and flask mode
        expect(FRAMEWORK_URL).toContain("7777");
        expect(BACKEND_MODE).toBe("flask");
    });

    test("both FLASK_URL and FRAMEWORK_URL end with trailing slash", () => {
        process.env.REACT_APP_BACKEND_MODE = "flask";
        const { FLASK_URL, FRAMEWORK_URL } = require("../config");
        expect(FLASK_URL.endsWith("/")).toBe(true);
        expect(FRAMEWORK_URL.endsWith("/")).toBe(true);
    });
});
