/**
 * Tests for the queries.js API module.
 */

const originalEnv = process.env;

beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete window.RUNTIME_CONFIG;
});

afterAll(() => {
    process.env = originalEnv;
});

describe("getOrthomosaicVersions", () => {
    test("flask mode calls Flask endpoint", async () => {
        process.env.REACT_APP_BACKEND_MODE = "flask";
        const mockFetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([{ versionName: "v1", path: "test.geojson" }]),
        });
        global.fetch = mockFetch;

        const { getOrthomosaicVersions } = require("../queries");
        const result = await getOrthomosaicVersions({
            year: "2024",
            experiment: "Exp1",
            location: "Davis",
            population: "Pop1",
        });

        expect(mockFetch).toHaveBeenCalled();
        const callUrl = mockFetch.mock.calls[0][0];
        expect(callUrl).toContain("flask_app/get_orthomosaic_versions");
        expect(result).toEqual([{ versionName: "v1", path: "test.geojson" }]);

        delete global.fetch;
    });
});

describe("getPlotBordersData", () => {
    test("flask mode calls Flask endpoint with POST", async () => {
        process.env.REACT_APP_BACKEND_MODE = "flask";
        const mockFetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ plot_data: { 1: { plot: "A1" } } }),
        });
        global.fetch = mockFetch;

        const { getPlotBordersData } = require("../queries");
        const result = await getPlotBordersData({
            year: "2024",
            experiment: "Exp1",
            location: "Davis",
            population: "Pop1",
        });

        expect(mockFetch).toHaveBeenCalled();
        const callUrl = mockFetch.mock.calls[0][0];
        expect(callUrl).toContain("flask_app/get_plot_borders_data");
        expect(result.plot_data).toHaveProperty("1");

        delete global.fetch;
    });
});

describe("getInferenceProgress", () => {
    test("flask mode calls Flask endpoint", async () => {
        process.env.REACT_APP_BACKEND_MODE = "flask";
        const mockFetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ running: false }),
        });
        global.fetch = mockFetch;

        const { getInferenceProgress } = require("../queries");
        const result = await getInferenceProgress();

        expect(mockFetch).toHaveBeenCalled();
        const callUrl = mockFetch.mock.calls[0][0];
        expect(callUrl).toContain("flask_app/get_inference_progress");
        expect(result.running).toBe(false);

        delete global.fetch;
    });

    test("framework mode queries running jobs", async () => {
        process.env.REACT_APP_BACKEND_MODE = "framework";
        const mockFetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([]),
        });
        global.fetch = mockFetch;

        const { getInferenceProgress } = require("../queries");
        const result = await getInferenceProgress();

        expect(mockFetch).toHaveBeenCalled();
        const callUrl = mockFetch.mock.calls[0][0];
        expect(callUrl).toContain("/api/jobs/all?status=RUNNING");
        expect(result.running).toBe(false);

        delete global.fetch;
    });
});

describe("downloadInferenceCsv", () => {
    test("framework mode returns presigned URL", async () => {
        process.env.REACT_APP_BACKEND_MODE = "framework";
        const mockFetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ url: "http://minio/presigned-url", expires_in_seconds: 3600 }),
        });
        global.fetch = mockFetch;

        const { downloadInferenceCsv } = require("../queries");
        const result = await downloadInferenceCsv({ path: "Processed/2024/test.csv" });

        expect(result).toHaveProperty("url");
        expect(result).toHaveProperty("fileName", "test.csv");

        delete global.fetch;
    });
});
