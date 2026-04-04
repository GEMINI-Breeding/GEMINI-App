import { parseCsv, mergeCsvDataWithGeoJson, fillPolygonWithRectangles } from "../PlotProposalSwitcher";

describe("parseCsv", () => {
    it("parses a basic CSV string into an array of objects", () => {
        const csv = "name,age\nAlice,30\nBob,25";
        const result = parseCsv(csv);
        expect(result).toEqual([
            { name: "Alice", age: "30" },
            { name: "Bob", age: "25" },
        ]);
    });

    it("parses a single-row CSV", () => {
        const csv = "col1,col2\nval1,val2";
        const result = parseCsv(csv);
        expect(result).toEqual([{ col1: "val1", col2: "val2" }]);
    });

    it("handles CSV with trailing newline", () => {
        const csv = "a,b\n1,2\n";
        const result = parseCsv(csv);
        // trim() removes the trailing newline, so no empty row should appear
        expect(result).toEqual([{ a: "1", b: "2" }]);
    });

    it("handles empty values in fields", () => {
        const csv = "x,y,z\n1,,3";
        const result = parseCsv(csv);
        expect(result).toEqual([{ x: "1", y: "", z: "3" }]);
    });

    it("returns all values as strings", () => {
        const csv = "row,col\n1,2";
        const result = parseCsv(csv);
        expect(typeof result[0].row).toBe("string");
        expect(typeof result[0].col).toBe("string");
    });
});

describe("mergeCsvDataWithGeoJson", () => {
    it("merges matching CSV data into feature properties", () => {
        const fc = {
            type: "FeatureCollection",
            features: [
                { type: "Feature", properties: { row: 1, column: 2 }, geometry: {} },
            ],
        };
        const csvData = [{ row: "1", col: "2", trait: "tall", accession: "A1" }];

        mergeCsvDataWithGeoJson(fc, csvData);

        expect(fc.features[0].properties.trait).toBe("tall");
        expect(fc.features[0].properties.accession).toBe("A1");
        // row and col from CSV should not overwrite existing properties
        expect(fc.features[0].properties.row).toBe(1);
        expect(fc.features[0].properties.column).toBe(2);
    });

    it("handles loose equality between string and number types", () => {
        const fc = {
            type: "FeatureCollection",
            features: [
                { type: "Feature", properties: { row: 3, column: 4 }, geometry: {} },
            ],
        };
        // CSV data has string values (as produced by parseCsv)
        const csvData = [{ row: "3", col: "4", value: "matched" }];

        mergeCsvDataWithGeoJson(fc, csvData);

        expect(fc.features[0].properties.value).toBe("matched");
    });

    it("sets default properties for unmatched features", () => {
        const fc = {
            type: "FeatureCollection",
            features: [
                { type: "Feature", properties: { row: 5, column: 6 }, geometry: {} },
            ],
        };
        const csvData = [{ row: "1", col: "1", trait: "short" }];

        mergeCsvDataWithGeoJson(fc, csvData);

        expect(fc.features[0].properties.plot).toBe("5_6");
        expect(fc.features[0].properties.Plot).toBe("5_6");
    });

    it("mutates the input featureCollection in place", () => {
        const fc = {
            type: "FeatureCollection",
            features: [
                { type: "Feature", properties: { row: 1, column: 1 }, geometry: {} },
            ],
        };
        const csvData = [{ row: "1", col: "1", x: "y" }];
        const originalRef = fc;

        mergeCsvDataWithGeoJson(fc, csvData);

        expect(fc).toBe(originalRef);
        expect(fc.features[0].properties.x).toBe("y");
    });
});

describe("fillPolygonWithRectangles", () => {
    // Create a simple polygon roughly 100m x 100m centered around (0, 0)
    const makePolygon = (centerX, centerY) => ({
        type: "Feature",
        properties: {},
        geometry: {
            type: "Polygon",
            coordinates: [[
                [centerX - 0.001, centerY - 0.001],
                [centerX + 0.001, centerY - 0.001],
                [centerX + 0.001, centerY + 0.001],
                [centerX - 0.001, centerY + 0.001],
                [centerX - 0.001, centerY - 0.001],
            ]],
        },
    });

    it("generates the correct number of rectangles for a 2x3 grid", () => {
        const polygon = makePolygon(-90, 40);
        const result = fillPolygonWithRectangles(polygon, {
            width: 2,
            length: 3,
            rows: 2,
            columns: 3,
            verticalSpacing: 0.5,
            horizontalSpacing: 0.5,
            angle: 0,
        });

        expect(result.type).toBe("FeatureCollection");
        expect(result.features).toHaveLength(6);
    });

    it("assigns correct row and column properties (1-indexed)", () => {
        const polygon = makePolygon(-90, 40);
        const result = fillPolygonWithRectangles(polygon, {
            width: 1,
            length: 1,
            rows: 2,
            columns: 2,
            verticalSpacing: 0,
            horizontalSpacing: 0,
            angle: 0,
        });

        const props = result.features.map((f) => ({
            row: f.properties.row,
            column: f.properties.column,
        }));

        expect(props).toContainEqual({ row: 1, column: 1 });
        expect(props).toContainEqual({ row: 1, column: 2 });
        expect(props).toContainEqual({ row: 2, column: 1 });
        expect(props).toContainEqual({ row: 2, column: 2 });
    });

    it("generates a single rectangle for a 1x1 grid", () => {
        const polygon = makePolygon(-90, 40);
        const result = fillPolygonWithRectangles(polygon, {
            width: 5,
            length: 5,
            rows: 1,
            columns: 1,
            verticalSpacing: 0,
            horizontalSpacing: 0,
            angle: 0,
        });

        expect(result.features).toHaveLength(1);
        expect(result.features[0].properties.row).toBe(1);
        expect(result.features[0].properties.column).toBe(1);
    });

    it("produces different coordinates when angle is non-zero", () => {
        const polygon = makePolygon(-90, 40);
        const opts = {
            width: 2,
            length: 2,
            rows: 1,
            columns: 1,
            verticalSpacing: 0,
            horizontalSpacing: 0,
        };

        const noRotation = fillPolygonWithRectangles(polygon, { ...opts, angle: 0 });
        const withRotation = fillPolygonWithRectangles(polygon, { ...opts, angle: 45 });

        const coords0 = noRotation.features[0].geometry.coordinates[0];
        const coords45 = withRotation.features[0].geometry.coordinates[0];

        // Coordinates should differ when rotated
        expect(coords0).not.toEqual(coords45);
    });

    it("each feature has a valid Polygon geometry", () => {
        const polygon = makePolygon(-90, 40);
        const result = fillPolygonWithRectangles(polygon, {
            width: 1,
            length: 1,
            rows: 2,
            columns: 2,
            verticalSpacing: 0.5,
            horizontalSpacing: 0.5,
            angle: 0,
        });

        result.features.forEach((feature) => {
            expect(feature.geometry.type).toBe("Polygon");
            // A polygon ring should have 5 coordinates (closed ring)
            expect(feature.geometry.coordinates[0]).toHaveLength(5);
        });
    });
});
