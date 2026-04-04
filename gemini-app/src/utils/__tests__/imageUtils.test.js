import { mergeLists } from "../imageUtils";

describe("mergeLists", () => {
    it("appends pointX and pointY from matching existing data", () => {
        const imageList = [
            { image_path: "/data/images/photo1.jpg", label: "A" },
        ];
        const existingData = [
            { image_path: "/old/path/photo1.jpg", pointX: 100, pointY: 200 },
        ];

        const result = mergeLists(imageList, existingData);

        expect(result[0].pointX).toBe(100);
        expect(result[0].pointY).toBe(200);
        // Original properties should be preserved
        expect(result[0].label).toBe("A");
        expect(result[0].image_path).toBe("/data/images/photo1.jpg");
    });

    it("returns image unchanged when no match exists", () => {
        const imageList = [
            { image_path: "/data/images/photo1.jpg", label: "A" },
        ];
        const existingData = [
            { image_path: "/old/path/other.jpg", pointX: 100, pointY: 200 },
        ];

        const result = mergeLists(imageList, existingData);

        expect(result[0]).toEqual({ image_path: "/data/images/photo1.jpg", label: "A" });
        expect(result[0].pointX).toBeUndefined();
    });

    it("matches by filename only, ignoring directory path", () => {
        const imageList = [
            { image_path: "/completely/different/path/IMG_001.jpg" },
        ];
        const existingData = [
            { image_path: "/some/other/path/IMG_001.jpg", pointX: 50, pointY: 75 },
        ];

        const result = mergeLists(imageList, existingData);

        expect(result[0].pointX).toBe(50);
        expect(result[0].pointY).toBe(75);
    });

    it("returns empty array when imageList is empty", () => {
        const result = mergeLists([], [{ image_path: "/x/y.jpg", pointX: 1, pointY: 2 }]);
        expect(result).toEqual([]);
    });

    it("returns images unchanged when existingData is empty", () => {
        const imageList = [
            { image_path: "/a/b.jpg", label: "B" },
        ];
        const result = mergeLists(imageList, []);
        expect(result).toEqual(imageList);
    });

    it("handles multiple images with partial matches", () => {
        const imageList = [
            { image_path: "/data/a.jpg" },
            { image_path: "/data/b.jpg" },
            { image_path: "/data/c.jpg" },
        ];
        const existingData = [
            { image_path: "/old/a.jpg", pointX: 10, pointY: 20 },
            { image_path: "/old/c.jpg", pointX: 30, pointY: 40 },
        ];

        const result = mergeLists(imageList, existingData);

        expect(result[0].pointX).toBe(10);
        expect(result[1].pointX).toBeUndefined();
        expect(result[2].pointX).toBe(30);
    });
});
