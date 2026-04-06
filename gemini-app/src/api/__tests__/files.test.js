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
    test("flask mode returns flask URL with file path", () => {
        process.env.REACT_APP_BACKEND_MODE = "flask";
        process.env.REACT_APP_FLASK_PORT = "5000";
        const { getTileFileUrl } = require("../files");
        const result = getTileFileUrl(
            "files/Processed/2024/exp1/loc1/pop1/2024-06-01/Drone/RGB/2024-06-01-RGB-Pyramid.tif"
        );
        expect(result).toBe(
            "http://localhost:5000/flask_app/files/Processed/2024/exp1/loc1/pop1/2024-06-01/Drone/RGB/2024-06-01-RGB-Pyramid.tif"
        );
    });

    test("framework mode returns S3 URL with bucket and object path", () => {
        process.env.REACT_APP_BACKEND_MODE = "framework";
        process.env.REACT_APP_STORAGE_BUCKET = "gemini";
        const { getTileFileUrl } = require("../files");
        const result = getTileFileUrl(
            "files/Processed/2024/exp1/loc1/pop1/2024-06-01/Drone/RGB/2024-06-01-RGB-Pyramid.tif"
        );
        expect(result).toBe(
            "s3://gemini/Processed/2024/exp1/loc1/pop1/2024-06-01/Drone/RGB/2024-06-01-RGB-Pyramid.tif"
        );
    });

    test("framework mode strips files/ prefix from path", () => {
        process.env.REACT_APP_BACKEND_MODE = "framework";
        const { getTileFileUrl } = require("../files");
        const result = getTileFileUrl("files/some/path.tif");
        expect(result).toMatch(/^s3:\/\/gemini\/some\/path\.tif$/);
    });

    test("framework mode handles path without files/ prefix", () => {
        process.env.REACT_APP_BACKEND_MODE = "framework";
        const { getTileFileUrl } = require("../files");
        const result = getTileFileUrl("Processed/path.tif");
        expect(result).toBe("s3://gemini/Processed/path.tif");
    });

    test("framework mode uses custom bucket from env", () => {
        process.env.REACT_APP_BACKEND_MODE = "framework";
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
            FLASK_PORT: "5000",
            FLASK_HOST: "localhost",
            TILE_SERVER_PORT: "8091",
            TILE_SERVER_HOST: "localhost",
            STORAGE_BUCKET: "custom-bucket",
        };
        const { STORAGE_BUCKET } = require("../config");
        expect(STORAGE_BUCKET).toBe("custom-bucket");
    });
});

describe("getFileUrl", () => {
    test("flask mode returns flask file URL", () => {
        process.env.REACT_APP_BACKEND_MODE = "flask";
        const { getFileUrl } = require("../files");
        const result = getFileUrl("Processed/2024/test.tif");
        expect(result).toContain("flask_app/files/Processed/2024/test.tif");
    });

    test("framework mode returns framework download URL", () => {
        process.env.REACT_APP_BACKEND_MODE = "framework";
        const { getFileUrl } = require("../files");
        const result = getFileUrl("Processed/2024/test.tif");
        expect(result).toContain("/api/files/download/Processed/2024/test.tif");
    });
});

describe("getImageUrl", () => {
    test("flask mode returns flask images URL", () => {
        process.env.REACT_APP_BACKEND_MODE = "flask";
        const { getImageUrl } = require("../files");
        const result = getImageUrl("some/image.jpg");
        expect(result).toContain("flask_app/images/some/image.jpg");
    });

    test("framework mode returns framework download URL", () => {
        process.env.REACT_APP_BACKEND_MODE = "framework";
        const { getImageUrl } = require("../files");
        const result = getImageUrl("some/image.jpg");
        expect(result).toContain("/api/files/download/some/image.jpg");
    });
});

describe("getPngFile", () => {
    test("framework mode returns download URL object", async () => {
        process.env.REACT_APP_BACKEND_MODE = "framework";
        const { getPngFile } = require("../files");
        const result = await getPngFile({ filePath: "Processed/2024/test.png" });
        expect(result).toHaveProperty("url");
        expect(result.url).toContain("/api/files/download/gemini/Processed/2024/test.png");
    });
});

describe("deleteOrtho", () => {
    test("framework mode builds correct delete path for ortho file", async () => {
        process.env.REACT_APP_BACKEND_MODE = "framework";
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
