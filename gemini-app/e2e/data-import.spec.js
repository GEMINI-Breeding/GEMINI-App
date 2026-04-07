const { test, expect } = require("@playwright/test");
const {
    navigateToUpload,
    selectDataType,
    fillFormFields,
    dropFiles,
    submitUpload,
    waitForUploadComplete,
    waitForExtractionStarted,
    clickDone,
    clickReturn,
    fixturePath,
} = require("./helpers/upload-helpers");
const {
    verifyFileInMinIO,
    cleanupMinIOPrefix,
    clearUploadCache,
    getJobsByType,
    cancelJob,
    deleteJob,
    listFilesInMinIO,
} = require("./helpers/api-helpers");

/**
 * E2E tests for data import in framework mode.
 *
 * These tests run against the real framework backend (PostgreSQL, MinIO, Redis).
 * No mocking whatsoever — files are uploaded to real MinIO storage and verified
 * via the real REST API.
 *
 * Prerequisites:
 *   - Framework backend running at port 7777 (docker compose up)
 *   - Frontend running at port 3000 with REACT_APP_BACKEND_MODE=framework
 */

// Use a unique prefix per test run to avoid collisions
const TEST_RUN_ID = `E2E-${Date.now()}`;

// Common form field values for tests
const BINARY_FIELDS = {
    year: "2024",
    experiment: TEST_RUN_ID,
    location: "Davis",
    population: "TestPop",
    date: "2024-07-15",
};

const ORTHO_FIELDS = {
    year: "2024",
    experiment: TEST_RUN_ID,
    location: "Davis",
    population: "TestPop",
    date: "2024-07-15",
    platform: "Drone",
    sensor: "RGB",
};

// ─── Binary (.bin) Upload ────────────────────────────────────────────────────
//
// Binary uploads have two phases: (1) chunked file upload to MinIO,
// (2) extraction job submission. The FLIR worker is NOT running in the test
// Docker stack, so extraction will never complete. Tests verify upload + job
// submission, then cancel extraction to clean up.

test.describe("Binary (.bin) upload", () => {
    test.setTimeout(60_000);

    const binaryFixture = fixturePath("binary", "test_amiga.0000.bin");
    // Expected MinIO path: {year}/{experiment}/{location}/{population}/{date}/Amiga/
    const expectedDir = `${BINARY_FIELDS.year}/${TEST_RUN_ID}/${BINARY_FIELDS.location}/${BINARY_FIELDS.population}/${BINARY_FIELDS.date}/Amiga`;

    test.afterEach(async ({ page, request }) => {
        // Click Cancel Upload to properly close the WebSocket for extraction
        // progress tracking. The Litestar backend becomes unresponsive if
        // WebSocket connections are abandoned without a clean close.
        const cancelBtn = page.locator("button:has-text('Cancel Upload')");
        if (await cancelBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
            await cancelBtn.click();
            // Wait for React to process the cancellation (closes WebSocket)
            await page.waitForTimeout(1_000);
        }
        // Now safe to navigate away
        await page.goto("about:blank");
        // Clean up uploaded files and jobs
        await cleanupMinIOPrefix(request, expectedDir);
        const jobs = await getJobsByType(request, "EXTRACT_BINARY");
        for (const job of jobs) {
            await cancelJob(request, job.id);
            await deleteJob(request, job.id);
        }
        await clearUploadCache(request, "test_amiga.0000.bin");
    });

    test("uploads binary file to MinIO and submits extraction job", async ({
        page,
        request,
    }) => {
        // Combined test: upload + verify file in MinIO + verify job submitted.
        // Consolidated into one test because each binary upload opens a WebSocket
        // for extraction progress tracking, and abandoned WebSockets cause the
        // backend to become unresponsive.

        const beforeJobs = await getJobsByType(request, "EXTRACT_BINARY");
        const beforeCount = beforeJobs.length;

        await navigateToUpload(page);
        await selectDataType(page, "Amiga File");
        await fillFormFields(page, BINARY_FIELDS);
        await dropFiles(page, [binaryFixture]);

        // Verify file appears in dropzone
        await expect(page.locator("text=test_amiga.0000.bin")).toBeVisible();

        await submitUpload(page);

        // Progress bar should appear
        await expect(page.locator("role=progressbar")).toBeVisible({
            timeout: 15_000,
        });

        // "Uploading..." text should appear
        await expect(
            page.locator("text=Uploading...").or(
                page.locator("text=Extracting Binary File...")
            )
        ).toBeVisible({ timeout: 15_000 });

        // Poll MinIO for the file (upload is fast for 1.2MB)
        await expect
            .poll(
                async () =>
                    verifyFileInMinIO(
                        request,
                        expectedDir,
                        "test_amiga.0000.bin"
                    ),
                { timeout: 30_000, intervals: [500, 1_000, 2_000] }
            )
            .toBeTruthy();

        // Poll for extraction job submission
        await expect
            .poll(
                async () => {
                    const jobs = await getJobsByType(
                        request,
                        "EXTRACT_BINARY"
                    );
                    return jobs.length > beforeCount;
                },
                { timeout: 30_000, intervals: [500, 1_000, 2_000] }
            )
            .toBeTruthy();

        // Verify job was submitted (PENDING if no worker, RUNNING if worker picked it up)
        const afterJobs = await getJobsByType(request, "EXTRACT_BINARY");
        const newJob = afterJobs[afterJobs.length - 1];
        // PENDING if no worker, RUNNING if worker picked it up, FAILED if worker crashed
        expect(["PENDING", "RUNNING", "FAILED"]).toContain(newJob.status);
    });
});

// ─── Orthomosaic (.tif) Upload ──────────────────────────────────────���────────

test.describe("Orthomosaic (.tif) upload", () => {
    test.setTimeout(120_000);

    const rgbFixture = fixturePath("ortho", "test-RGB.tif");
    const demFixture = fixturePath("ortho", "test-DEM.tif");
    const orphanDemFixture = fixturePath("invalid", "orphan-DEM.tif");

    // Expected MinIO path: Processed/{year}/{experiment}/{location}/{population}/{date}/{platform}/{sensor}/
    const expectedDir = `Processed/${ORTHO_FIELDS.year}/${TEST_RUN_ID}/${ORTHO_FIELDS.location}/${ORTHO_FIELDS.population}/${ORTHO_FIELDS.date}/${ORTHO_FIELDS.platform}/${ORTHO_FIELDS.sensor}`;

    test.afterEach(async ({ page, request }) => {
        await page.goto("about:blank");
        await cleanupMinIOPrefix(request, expectedDir);
        await clearUploadCache(request, `${ORTHO_FIELDS.date}-RGB.tif`);
        await clearUploadCache(request, `${ORTHO_FIELDS.date}-DEM.tif`);
    });

    test("can upload paired RGB and DEM TIFF files", async ({
        page,
        request,
    }) => {
        await navigateToUpload(page);
        await selectDataType(page, "Orthomosaics");
        await fillFormFields(page, ORTHO_FIELDS);
        await dropFiles(page, [rgbFixture, demFixture]);

        // Both files should appear in the dropzone
        await expect(page.locator("text=test-RGB.tif")).toBeVisible();
        await expect(page.locator("text=test-DEM.tif")).toBeVisible();

        await submitUpload(page);
        await waitForUploadComplete(page);

        // Verify files in MinIO — they should be renamed to {date}-RGB.tif and {date}-DEM.tif
        const rgbExists = await verifyFileInMinIO(
            request,
            expectedDir,
            `${ORTHO_FIELDS.date}-RGB.tif`
        );
        const demExists = await verifyFileInMinIO(
            request,
            expectedDir,
            `${ORTHO_FIELDS.date}-DEM.tif`
        );
        expect(rgbExists).toBeTruthy();
        expect(demExists).toBeTruthy();
    });

    test("can upload RGB-only orthomosaic (DEM is optional)", async ({
        page,
        request,
    }) => {
        await navigateToUpload(page);
        await selectDataType(page, "Orthomosaics");
        await fillFormFields(page, ORTHO_FIELDS);
        await dropFiles(page, [rgbFixture]);
        await submitUpload(page);
        await waitForUploadComplete(page);

        const rgbExists = await verifyFileInMinIO(
            request,
            expectedDir,
            `${ORTHO_FIELDS.date}-RGB.tif`
        );
        expect(rgbExists).toBeTruthy();
    });

    test("allows DEM-only upload (pairing only enforced when both types present)", async ({
        page,
        request,
    }) => {
        await navigateToUpload(page);
        await selectDataType(page, "Orthomosaics");
        await fillFormFields(page, ORTHO_FIELDS);
        await dropFiles(page, [orphanDemFixture]);
        await submitUpload(page);

        // DEM-only is allowed — validation only rejects when DEM count != RGB count
        // and both are present. A single DEM with no RGB passes validation.
        await waitForUploadComplete(page);
    });

    test("shows orthomosaic info note when type selected", async ({ page }) => {
        await navigateToUpload(page);
        await selectDataType(page, "Orthomosaics");

        // The info note about RGB/DEM should be visible
        await expect(
            page.locator(
                "text=You can upload RGB.tif files alone for most processing"
            )
        ).toBeVisible();
    });
});
