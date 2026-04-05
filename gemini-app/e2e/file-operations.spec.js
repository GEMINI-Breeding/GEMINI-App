const { test, expect } = require("@playwright/test");
const {
    API_BASE,
    listFilesInMinIO,
    verifyFileInMinIO,
    cleanupMinIOPrefix,
    deleteFromMinIO,
} = require("./helpers/api-helpers");
const { seedFileToMinIO } = require("./helpers/manage-helpers");

/**
 * E2E tests for file operations against the framework backend.
 * Tests the MinIO file listing, upload, download, and delete operations
 * via the framework REST API — zero mocking.
 *
 * Prerequisites:
 *   - Framework backend running at port 7777
 */

const TEST_PREFIX = `E2E-FileOps-${Date.now()}`;
const BASE_PATH = `test-data/${TEST_PREFIX}`;

test.describe("File operations (framework API)", () => {
    test.setTimeout(30_000);

    test.afterAll(async ({ request }) => {
        await cleanupMinIOPrefix(request, BASE_PATH);
    });

    test("upload a file to MinIO and verify it exists", async ({ request }) => {
        const testContent = "Hello, this is test content for E2E file operations.";
        const objectPath = `${BASE_PATH}/test-file.txt`;

        const uploadResp = await seedFileToMinIO(request, objectPath, testContent, "text/plain");
        expect(uploadResp.ok()).toBeTruthy();

        // Verify the file exists
        const found = await verifyFileInMinIO(request, BASE_PATH, "test-file.txt");
        expect(found).toBeTruthy();
    });

    test("list files returns uploaded files", async ({ request }) => {
        // Seed two files
        await seedFileToMinIO(request, `${BASE_PATH}/list-test/file-a.txt`, "file a", "text/plain");
        await seedFileToMinIO(request, `${BASE_PATH}/list-test/file-b.txt`, "file b", "text/plain");

        const result = await listFilesInMinIO(request, `${BASE_PATH}/list-test`);
        expect(result.status).toBe(200);
        expect(result.body).toBeTruthy();
        expect(Array.isArray(result.body)).toBeTruthy();
        expect(result.body.length).toBeGreaterThanOrEqual(2);

        const names = result.body.map((item) => item.object_name || item.name || item);
        const hasFileA = names.some((n) => n.includes("file-a.txt"));
        const hasFileB = names.some((n) => n.includes("file-b.txt"));
        expect(hasFileA).toBeTruthy();
        expect(hasFileB).toBeTruthy();
    });

    test("download a file via presigned URL", async ({ request }) => {
        const testContent = "Presigned URL test content";
        const objectPath = `${BASE_PATH}/presign-test.txt`;
        await seedFileToMinIO(request, objectPath, testContent, "text/plain");

        // Get presigned URL
        const presignResp = await request.get(`${API_BASE}/files/presign/gemini/${objectPath}`);
        expect(presignResp.ok()).toBeTruthy();
        const presignData = await presignResp.json();
        expect(presignData.url).toBeTruthy();

        // Download via presigned URL
        const downloadResp = await request.get(presignData.url);
        expect(downloadResp.ok()).toBeTruthy();
        const body = await downloadResp.text();
        expect(body).toBe(testContent);
    });

    test("delete a file from MinIO and verify it is gone", async ({ request }) => {
        const objectPath = `${BASE_PATH}/delete-test.txt`;
        await seedFileToMinIO(request, objectPath, "to be deleted", "text/plain");

        // Verify it exists first
        const existsBefore = await verifyFileInMinIO(request, BASE_PATH, "delete-test.txt");
        expect(existsBefore).toBeTruthy();

        // Delete
        const deleteResp = await request.delete(`${API_BASE}/files/delete/gemini/${objectPath}`);
        expect(deleteResp.status()).toBeLessThan(300);

        // Verify it is gone
        const existsAfter = await verifyFileInMinIO(request, BASE_PATH, "delete-test.txt");
        expect(existsAfter).toBeFalsy();
    });
});
