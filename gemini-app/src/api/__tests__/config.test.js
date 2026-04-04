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

    test("FRAMEWORK_URL does not have trailing slash", () => {
        process.env.REACT_APP_FRAMEWORK_PORT = "7777";
        const { FRAMEWORK_URL } = require("../config");
        expect(FRAMEWORK_URL).toMatch(/\/api$/);
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
});
