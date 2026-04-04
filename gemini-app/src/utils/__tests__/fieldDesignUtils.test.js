import { calculateMaxMinusMin, convertToMeters } from "../fieldDesignUtils";

describe("calculateMaxMinusMin", () => {
    it("calculates range + 1 for numeric values", () => {
        const data = [{ row: 1 }, { row: 5 }, { row: 3 }];
        expect(calculateMaxMinusMin(data, "row")).toBe(5);
    });

    it("returns 1 for a single element", () => {
        const data = [{ row: 3 }];
        expect(calculateMaxMinusMin(data, "row")).toBe(1);
    });

    it("filters out null values", () => {
        const data = [{ row: 2 }, { row: null }, { row: 4 }];
        expect(calculateMaxMinusMin(data, "row")).toBe(3);
    });

    it("filters out undefined values", () => {
        const data = [{ row: 1 }, {}, { row: 3 }];
        expect(calculateMaxMinusMin(data, "row")).toBe(3);
    });

    it("works with string number values (as produced by parseCsv)", () => {
        // parseCsv returns all values as strings — Math.max/min coerce them
        const data = [{ row: "1" }, { row: "5" }, { row: "3" }];
        const result = calculateMaxMinusMin(data, "row");
        // If JS coercion works: max("5") - min("1") + 1 = 5
        // If it doesn't: result will be NaN
        expect(result).toBe(5);
    });
});

describe("convertToMeters", () => {
    it("converts feet to meters", () => {
        expect(convertToMeters(1, "feet")).toBeCloseTo(0.3048);
    });

    it("converts 100 feet to meters", () => {
        expect(convertToMeters(100, "feet")).toBeCloseTo(30.48);
    });

    it("returns value unchanged for meters", () => {
        expect(convertToMeters(1, "meters")).toBe(1);
    });

    it("returns value unchanged for zero", () => {
        expect(convertToMeters(0, "feet")).toBe(0);
    });

    it("returns value unchanged for unknown unit", () => {
        expect(convertToMeters(42, "cubits")).toBe(42);
    });
});
