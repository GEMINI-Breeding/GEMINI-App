/**
 * Tests for the gcp.js API module.
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

describe("getGcpSelectedImages", () => {
    test("flask mode calls Flask endpoint", async () => {
        process.env.REACT_APP_BACKEND_MODE = "flask";
        const mockFetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ images: [{ fileName: "img1.jpg" }] }),
        });
        global.fetch = mockFetch;

        const { getGcpSelectedImages } = require("../gcp");
        const result = await getGcpSelectedImages({
            year: "2024",
            experiment: "Exp1",
            location: "Davis",
            population: "Pop1",
            date: "2024-06-15",
            platform: "Drone",
            sensor: "RGB",
        });

        expect(mockFetch).toHaveBeenCalled();
        const callUrl = mockFetch.mock.calls[0][0];
        expect(callUrl).toContain("flask_app/get_gcp_selcted_images");

        delete global.fetch;
    });

    test("framework mode lists images from MinIO", async () => {
        process.env.REACT_APP_BACKEND_MODE = "framework";
        const mockFetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([
                { object_name: "2024/Exp1/Davis/Pop1/2024-06-15/Drone/RGB/Images/img1.jpg" },
                { object_name: "2024/Exp1/Davis/Pop1/2024-06-15/Drone/RGB/Images/img2.png" },
            ]),
        });
        global.fetch = mockFetch;

        const { getGcpSelectedImages } = require("../gcp");
        const result = await getGcpSelectedImages({
            year: "2024",
            experiment: "Exp1",
            location: "Davis",
            population: "Pop1",
            date: "2024-06-15",
            platform: "Drone",
            sensor: "RGB",
        });

        expect(result.images).toHaveLength(2);
        expect(result.images[0].fileName).toBe("img1.jpg");
        expect(result.images[1].fileName).toBe("img2.png");

        delete global.fetch;
    });
});

describe("saveGcpArray", () => {
    test("flask mode calls save_array endpoint", async () => {
        process.env.REACT_APP_BACKEND_MODE = "flask";
        const mockFetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ message: "saved" }),
        });
        global.fetch = mockFetch;

        const { saveGcpArray } = require("../gcp");
        await saveGcpArray({
            array: [{ x: 1, y: 2 }],
            platform: "Drone",
            sensor: "RGB",
        });

        expect(mockFetch).toHaveBeenCalled();
        const callUrl = mockFetch.mock.calls[0][0];
        expect(callUrl).toContain("flask_app/save_array");

        delete global.fetch;
    });

    test("framework mode uploads JSON to MinIO", async () => {
        process.env.REACT_APP_BACKEND_MODE = "framework";
        const mockFetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ object_name: "gcp_data/test.json" }),
        });
        global.fetch = mockFetch;

        const { saveGcpArray } = require("../gcp");
        await saveGcpArray({
            filePath: "gcp_data/Drone/RGB/gcp_points.json",
            content: { array: [{ x: 1, y: 2 }] },
        });

        expect(mockFetch).toHaveBeenCalled();
        const callUrl = mockFetch.mock.calls[0][0];
        expect(callUrl).toContain("/api/files/upload");

        delete global.fetch;
    });
});

describe("initializeGcpFile", () => {
    test("framework mode tries to read existing file first", async () => {
        process.env.REACT_APP_BACKEND_MODE = "framework";
        const mockFetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ existing_data: [] }),
        });
        global.fetch = mockFetch;

        const { initializeGcpFile } = require("../gcp");
        const result = await initializeGcpFile({
            filePath: "gcp_data/test.json",
            defaultContent: { array: [] },
        });

        expect(mockFetch).toHaveBeenCalled();
        const callUrl = mockFetch.mock.calls[0][0];
        expect(callUrl).toContain("/api/files/download/gemini/gcp_data/test.json");
        expect(result).toEqual({ existing_data: [] });

        delete global.fetch;
    });
});
