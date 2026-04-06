/**
 * Tests for the files.js API module.
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

describe("getTileFileUrl", () => {
    test("returns S3 URL with bucket and object path", () => {
        process.env.REACT_APP_STORAGE_BUCKET = "gemini";
        const { getTileFileUrl } = require("../files");
        const result = getTileFileUrl(
            "files/Processed/2024/exp1/loc1/pop1/2024-06-01/Drone/RGB/2024-06-01-RGB-Pyramid.tif"
        );
        expect(result).toBe(
            "s3://gemini/Processed/2024/exp1/loc1/pop1/2024-06-01/Drone/RGB/2024-06-01-RGB-Pyramid.tif"
        );
    });

    test("strips files/ prefix from path", () => {
        const { getTileFileUrl } = require("../files");
        const result = getTileFileUrl("files/some/path.tif");
        expect(result).toMatch(/^s3:\/\/gemini\/some\/path\.tif$/);
    });

    test("handles path without files/ prefix", () => {
        const { getTileFileUrl } = require("../files");
        const result = getTileFileUrl("Processed/path.tif");
        expect(result).toBe("s3://gemini/Processed/path.tif");
    });

    test("uses custom bucket from env", () => {
        process.env.REACT_APP_STORAGE_BUCKET = "my-bucket";
        const { getTileFileUrl } = require("../files");
        const result = getTileFileUrl("files/test.tif");
        expect(result).toBe("s3://my-bucket/test.tif");
    });

    test("STORAGE_BUCKET exported from config defaults to gemini", () => {
        const { STORAGE_BUCKET } = require("../config");
        expect(STORAGE_BUCKET).toBe("gemini");
    });

    test("STORAGE_BUCKET from RUNTIME_CONFIG", () => {
        window.RUNTIME_CONFIG = {
            TILE_SERVER_PORT: "8091",
            TILE_SERVER_HOST: "localhost",
            STORAGE_BUCKET: "custom-bucket",
        };
        const { STORAGE_BUCKET } = require("../config");
        expect(STORAGE_BUCKET).toBe("custom-bucket");
    });
});

describe("getFileUrl", () => {
    test("returns framework download URL", () => {
        const { getFileUrl } = require("../files");
        const result = getFileUrl("Processed/2024/test.tif");
        expect(result).toContain("/api/files/download/Processed/2024/test.tif");
    });
});

describe("getImageUrl", () => {
    test("returns framework download URL", () => {
        const { getImageUrl } = require("../files");
        const result = getImageUrl("some/image.jpg");
        expect(result).toContain("/api/files/download/some/image.jpg");
    });
});

describe("getPngFile", () => {
    test("returns download URL object", async () => {
        const { getPngFile } = require("../files");
        const result = await getPngFile({ filePath: "Processed/2024/test.png" });
        expect(result).toHaveProperty("url");
        expect(result.url).toContain("/api/files/download/gemini/Processed/2024/test.png");
    });
});

describe("deleteOrtho", () => {
    test("builds correct delete path for ortho file", async () => {
        // Mock fetch globally
        const mockFetch = jest.fn()
            .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) }) // list
            .mockResolvedValueOnce({ ok: true }); // delete
        global.fetch = mockFetch;

        const { deleteOrtho } = require("../files");
        await deleteOrtho({
            year: "2024", experiment: "Exp1", location: "Davis",
            population: "Pop1", date: "2024-06-15", platform: "Drone",
            sensor: "RGB", fileName: "2024-06-15-RGB.tif", deleteType: "ortho",
        });

        // First call should be list, path should include the file name
        expect(mockFetch).toHaveBeenCalled();
        const listUrl = mockFetch.mock.calls[0][0];
        expect(listUrl).toContain("files/list/gemini/Processed/2024/Exp1/Davis/Pop1/2024-06-15/Drone/RGB/2024-06-15-RGB.tif");

        delete global.fetch;
    });
});
