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
 * E2E tests for image management operations (move to Removed, restore).
 * Tests the full file move workflow via the framework API — zero mocking.
 *
 * Prerequisites:
 *   - Framework backend running at port 7777
 */

const TEST_RUN_ID = `E2E-IMG-${Date.now()}`;
const RAW_BASE = `Raw/2024/${TEST_RUN_ID}/Davis/TestPop/2024-07-15/Drone/RGB`;

test.describe("Image management operations", () => {
    test.setTimeout(30_000);

    test.afterAll(async ({ request }) => {
        await cleanupMinIOPrefix(request, `Raw/2024/${TEST_RUN_ID}`);
    });

    test("seed images to Images/ directory", async ({ request }) => {
        // Seed test images
        const imgContent = fs.readFileSync(
            path.resolve(__dirname, "fixtures/images/test_image_001.jpg")
        );
        await seedFileToMinIO(
            request,
            `${RAW_BASE}/Images/test_img_001.jpg`,
            imgContent,
            "image/jpeg"
        );
        await seedFileToMinIO(
            request,
            `${RAW_BASE}/Images/test_img_002.jpg`,
            imgContent,
            "image/jpeg"
        );

        // Verify both files exist
        const found1 = await verifyFileInMinIO(request, `${RAW_BASE}/Images`, "test_img_001.jpg");
        const found2 = await verifyFileInMinIO(request, `${RAW_BASE}/Images`, "test_img_002.jpg");
        expect(found1).toBeTruthy();
        expect(found2).toBeTruthy();
    });

    test("move image to Removed/ via copy+delete pattern", async ({ request }) => {
        // Seed image to Images/
        const imgContent = fs.readFileSync(
            path.resolve(__dirname, "fixtures/images/test_image_001.jpg")
        );
        const srcPath = `${RAW_BASE}/Images/move_test.jpg`;
        await seedFileToMinIO(request, srcPath, imgContent, "image/jpeg");

        // Download the file
        const downloadResp = await request.get(`${API_BASE}/files/download/gemini/${srcPath}`);
        expect(downloadResp.ok()).toBeTruthy();
        const fileData = await downloadResp.body();

        // Upload to Removed/
        const dstPath = `${RAW_BASE}/Removed/move_test.jpg`;
        const uploadResp = await request.post(`${API_BASE}/files/upload`, {
            multipart: {
                file: {
                    name: "move_test.jpg",
                    mimeType: "image/jpeg",
                    buffer: fileData,
                },
                bucket_name: "gemini",
                object_name: dstPath,
            },
        });
        expect(uploadResp.ok()).toBeTruthy();

        // Delete from Images/
        await request.delete(`${API_BASE}/files/delete/gemini/${srcPath}`);

        // Verify: gone from Images/, present in Removed/
        const inImages = await verifyFileInMinIO(request, `${RAW_BASE}/Images`, "move_test.jpg");
        const inRemoved = await verifyFileInMinIO(request, `${RAW_BASE}/Removed`, "move_test.jpg");
        expect(inImages).toBeFalsy();
        expect(inRemoved).toBeTruthy();
    });

    test("restore image from Removed/ back to Images/", async ({ request }) => {
        // Seed image directly to Removed/
        const imgContent = fs.readFileSync(
            path.resolve(__dirname, "fixtures/images/test_image_002.jpg")
        );
        const srcPath = `${RAW_BASE}/Removed/restore_test.jpg`;
        await seedFileToMinIO(request, srcPath, imgContent, "image/jpeg");

        // Download from Removed/
        const downloadResp = await request.get(`${API_BASE}/files/download/gemini/${srcPath}`);
        expect(downloadResp.ok()).toBeTruthy();
        const fileData = await downloadResp.body();

        // Upload to Images/
        const dstPath = `${RAW_BASE}/Images/restore_test.jpg`;
        const uploadResp = await request.post(`${API_BASE}/files/upload`, {
            multipart: {
                file: {
                    name: "restore_test.jpg",
                    mimeType: "image/jpeg",
                    buffer: fileData,
                },
                bucket_name: "gemini",
                object_name: dstPath,
            },
        });
        expect(uploadResp.ok()).toBeTruthy();

        // Delete from Removed/
        await request.delete(`${API_BASE}/files/delete/gemini/${srcPath}`);

        // Verify: present in Images/, gone from Removed/
        const inImages = await verifyFileInMinIO(request, `${RAW_BASE}/Images`, "restore_test.jpg");
        const inRemoved = await verifyFileInMinIO(request, `${RAW_BASE}/Removed`, "restore_test.jpg");
        expect(inImages).toBeTruthy();
        expect(inRemoved).toBeFalsy();
    });
});
