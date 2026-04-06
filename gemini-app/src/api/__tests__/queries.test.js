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

describe("getInferenceProgress", () => {
    test("queries running jobs from framework", async () => {
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
    test("returns presigned URL", async () => {
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
