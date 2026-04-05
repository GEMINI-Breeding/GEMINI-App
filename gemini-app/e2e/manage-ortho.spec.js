const { test, expect } = require("@playwright/test");
const {
    API_BASE,
    listFilesInMinIO,
    verifyFileInMinIO,
    cleanupMinIOPrefix,
} = require("./helpers/api-helpers");
const { seedFileToMinIO } = require("./helpers/manage-helpers");
const path = require("path");
const fs = require("fs");

/**
 * E2E tests for the Manage/Ortho table in framework mode.
 * Seeds processed data directly to MinIO, then verifies the UI
 * displays and operates on it correctly.
 *
 * Prerequisites:
 *   - Framework backend running at port 7777
 *   - Frontend running at port 3000 with REACT_APP_BACKEND_MODE=framework
 */

const TEST_RUN_ID = `E2E-ORTHO-${Date.now()}`;
const FIELDS = {
    year: "2024",
    experiment: TEST_RUN_ID,
    location: "Davis",
    population: "TestPop",
    date: "2024-07-15",
    platform: "Drone",
    sensor: "RGB",
};
const PROCESSED_PREFIX = `Processed/${FIELDS.year}/${TEST_RUN_ID}/${FIELDS.location}/${FIELDS.population}`;

test.describe("Manage ortho table", () => {
    test.setTimeout(60_000);

    test.afterAll(async ({ request }) => {
        await cleanupMinIOPrefix(request, PROCESSED_PREFIX);
    });

    test("seed ortho TIF and verify via API", async ({ request }) => {
        // Read real test ortho fixture
        const tifPath = path.resolve(__dirname, "fixtures/ortho/test-RGB.tif");
        const tifContent = fs.readFileSync(tifPath);

        const objectPath = `${PROCESSED_PREFIX}/${FIELDS.date}/${FIELDS.platform}/${FIELDS.sensor}/${FIELDS.date}-RGB.tif`;
        const resp = await seedFileToMinIO(request, objectPath, tifContent, "image/tiff");
        expect(resp.ok()).toBeTruthy();

        // Verify the file exists in MinIO
        const found = await verifyFileInMinIO(
            request,
            `${PROCESSED_PREFIX}/${FIELDS.date}/${FIELDS.platform}/${FIELDS.sensor}`,
            `${FIELDS.date}-RGB.tif`
        );
        expect(found).toBeTruthy();
    });

    test("seed AgRowStitch plots and verify via API", async ({ request }) => {
        const pngContent = Buffer.alloc(100, 0); // Minimal placeholder
        const agrowstitchDir = "AgRowStitch_v1";
        const basePath = `${PROCESSED_PREFIX}/${FIELDS.date}/${FIELDS.platform}/${FIELDS.sensor}/${agrowstitchDir}`;

        // Seed 3 plot images
        for (let i = 1; i <= 3; i++) {
            const objectPath = `${basePath}/full_res_mosaic_temp_plot_${i}.png`;
            await seedFileToMinIO(request, objectPath, pngContent, "image/png");
        }

        // Verify files exist
        const result = await listFilesInMinIO(request, basePath);
        expect(result.status).toBe(200);
        expect(result.body).toBeTruthy();
        expect(result.body.length).toBeGreaterThanOrEqual(3);
    });

    test("delete seeded ortho file via API", async ({ request }) => {
        // Seed a file to delete
        const objectPath = `${PROCESSED_PREFIX}/${FIELDS.date}/${FIELDS.platform}/${FIELDS.sensor}/delete-test.tif`;
        await seedFileToMinIO(request, objectPath, Buffer.alloc(50), "image/tiff");

        // Verify it exists
        const existsBefore = await verifyFileInMinIO(
            request,
            `${PROCESSED_PREFIX}/${FIELDS.date}/${FIELDS.platform}/${FIELDS.sensor}`,
            "delete-test.tif"
        );
        expect(existsBefore).toBeTruthy();

        // Delete it
        const deleteResp = await request.delete(`${API_BASE}/files/delete/gemini/${objectPath}`);
        expect(deleteResp.status()).toBeLessThan(300);

        // Verify it's gone
        const existsAfter = await verifyFileInMinIO(
            request,
            `${PROCESSED_PREFIX}/${FIELDS.date}/${FIELDS.platform}/${FIELDS.sensor}`,
            "delete-test.tif"
        );
        expect(existsAfter).toBeFalsy();
    });

    test("list directories returns correct hierarchy", async ({ request }) => {
        // The seeded files should create a directory hierarchy
        const datesResult = await listFilesInMinIO(request, PROCESSED_PREFIX);
        expect(datesResult.status).toBe(200);
        expect(datesResult.body).toBeTruthy();
        expect(datesResult.body.length).toBeGreaterThan(0);

        // Verify at least one item references our date
        const hasDate = datesResult.body.some((item) => {
            const name = item.object_name || item.name || item;
            return name.includes(FIELDS.date);
        });
        expect(hasDate).toBeTruthy();
    });
});
