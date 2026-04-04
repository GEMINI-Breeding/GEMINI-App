import { geojsonToCSV } from "../GeojsonUtils";

describe("geojsonToCSV", () => {
    it("converts a standard GeoJSON to CSV", () => {
        const geojson = {
            type: "FeatureCollection",
            features: [
                { type: "Feature", properties: { name: "Plot1", value: 42 }, geometry: {} },
                { type: "Feature", properties: { name: "Plot2", value: 88 }, geometry: {} },
            ],
        };

        const csv = geojsonToCSV(geojson);
        const lines = csv.trim().split("\n");

        expect(lines[0]).toBe("name,value");
        expect(lines[1]).toBe("Plot1,42");
        expect(lines[2]).toBe("Plot2,88");
    });

    it("returns empty string for null input", () => {
        expect(geojsonToCSV(null)).toBe("");
    });

    it("returns empty string for undefined input", () => {
        expect(geojsonToCSV(undefined)).toBe("");
    });

    it("returns empty string for empty features array", () => {
        expect(geojsonToCSV({ features: [] })).toBe("");
    });

    it("uses headers from the first feature's properties", () => {
        const geojson = {
            features: [
                { properties: { a: 1, b: 2, c: 3 } },
            ],
        };

        const csv = geojsonToCSV(geojson);
        const header = csv.trim().split("\n")[0];

        expect(header).toBe("a,b,c");
    });

    it("produces empty field when a property is missing from a feature", () => {
        const geojson = {
            features: [
                { properties: { x: 1, y: 2 } },
                { properties: { x: 3 } }, // missing y
            ],
        };

        const csv = geojsonToCSV(geojson);
        const lines = csv.trim().split("\n");

        expect(lines[1]).toBe("1,2");
        expect(lines[2]).toBe("3,");
    });

    it("preserves property value of 0", () => {
        const geojson = {
            features: [
                { properties: { count: 0, name: "Plot1" } },
            ],
        };

        const csv = geojsonToCSV(geojson);
        const lines = csv.trim().split("\n");

        expect(lines[1]).toBe("0,Plot1");
    });

    it("preserves property value of false", () => {
        const geojson = {
            features: [
                { properties: { flag: false, name: "Plot1" } },
            ],
        };

        const csv = geojsonToCSV(geojson);
        const lines = csv.trim().split("\n");

        expect(lines[1]).toBe("false,Plot1");
    });

    it("preserves empty string property value", () => {
        const geojson = {
            features: [
                { properties: { label: "", name: "Plot1" } },
            ],
        };

        const csv = geojsonToCSV(geojson);
        const lines = csv.trim().split("\n");

        expect(lines[1]).toBe(",Plot1");
    });
});
