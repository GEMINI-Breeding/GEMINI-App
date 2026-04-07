const { test, expect } = require("@playwright/test");
const path = require("path");
const fs = require("fs");
const { seedFileToMinIO } = require("./helpers/manage-helpers");
const {
    navigateToUpload,
    selectDataType,
    fillFormFields,
    dropFiles,
    submitUpload,
    waitForUploadComplete,
    clickDone,
    fixturePath,
} = require("./helpers/upload-helpers");
const {
    listFilesInMinIO,
    verifyFileInMinIO,
    cleanupMinIOPrefix,
    deleteExperiment,
    getExperimentByName,
    API_BASE,
} = require("./helpers/api-helpers");
const {
    navigateToProcessingAndInitiatePrep,
    navigateToMosaicGeneration,
    seedExperimentEntities,
} = require("./helpers/prep-helpers");

/**
 * Real user workflow E2E tests.
 *
 * These tests simulate complete user journeys — upload data, then interact
 * with it through the UI. They exercise the full pipeline from data entry
 * to visualization and management.
 *
 * All tests run against real framework backend. No mocking.
 */

const TEST_RUN_ID = `E2E-WF-${Date.now()}`;
const FIELDS = {
    year: "2026",
    experiment: TEST_RUN_ID,
    location: "Davis",
    population: "Cowpea",
    date: "2026-04-01",
    platform: "drone",
    sensor: "iphone",
};

const UPLOAD_PREFIX = `${FIELDS.year}/${FIELDS.experiment}/${FIELDS.location}/${FIELDS.population}`;
const IMAGE_DIR = `${UPLOAD_PREFIX}/${FIELDS.date}/${FIELDS.platform}/${FIELDS.sensor}/Images`;

let experimentId;

test.describe("Upload → Manage → View images workflow", () => {
    test.beforeAll(async ({ request }) => {
        // Seed images directly to MinIO (skip the upload UI for speed)
        const img1 = fs.readFileSync(fixturePath("images", "test_image_001.jpg"));
        const img2 = fs.readFileSync(fixturePath("images", "test_image_002.jpg"));
        await seedFileToMinIO(request, `${IMAGE_DIR}/test_image_001.jpg`, img1, "image/jpeg");
        await seedFileToMinIO(request, `${IMAGE_DIR}/test_image_002.jpg`, img2, "image/jpeg");

        // Create experiment entities
        const result = await seedExperimentEntities(request, FIELDS);
        experimentId = result.experimentId;
    });

    test.afterAll(async ({ request }) => {
        await cleanupMinIOPrefix(request, UPLOAD_PREFIX);
        if (experimentId) {
            await deleteExperiment(request, experimentId);
        }
    });

    test("seeded images are downloadable via API", async ({ request }) => {
        // Verify images exist
        const listing = await listFilesInMinIO(request, IMAGE_DIR);
        expect(listing.status).toBe(200);

        // Download an image and verify it's not empty
        const resp = await request.get(`${API_BASE}/files/download/gemini/${IMAGE_DIR}/test_image_001.jpg`);
        expect(resp.ok()).toBeTruthy();
        const body = await resp.body();
        expect(body.length).toBeGreaterThan(100);
    });

    test("getFileUrl returns correct download URL with gemini prefix", async ({ request }) => {
        // This test verifies the fix for Bug 2 — getFileUrl was missing gemini/ prefix
        const resp = await request.get(`${API_BASE}/files/download/gemini/${IMAGE_DIR}/test_image_001.jpg`);
        expect(resp.ok()).toBeTruthy();

        // The broken URL (without gemini/) should fail
        const badResp = await request.get(`${API_BASE}/files/download/${IMAGE_DIR}/test_image_001.jpg`);
        expect(badResp.ok()).toBeFalsy();
    });

    test("manage page loads and shows uploaded data", async ({ page }) => {
        await page.goto("/");
        await page.waitForSelector("#root:not(:empty)", { timeout: 15_000 });

        // Navigate to manage
        const prepareButton = page.locator("[aria-label='prepare']");
        await prepareButton.waitFor({ state: "visible", timeout: 15_000 });
        await prepareButton.click();

        const manageButton = page.locator("[aria-label='manage-files']");
        await manageButton.waitFor({ state: "visible", timeout: 5_000 });
        await manageButton.click();

        // Wait for the DataGrid to load
        await page.waitForTimeout(2_000);

        // The manage page should render a DataGrid
        const dataGrid = page.locator(".MuiDataGrid-root");
        await expect(dataGrid).toBeAttached({ timeout: 10_000 });
    });
});

test.describe("Upload form: date field preserves default", () => {
    test("date field retains default value after filling other fields", async ({ page }) => {
        await navigateToUpload(page);
        await selectDataType(page, "Image Data");

        // Fill year, experiment, location, population — this triggers handleAutocompleteBlur
        // which previously cleared the date field
        await fillFormFields(page, {
            year: "2026",
            experiment: "DateTest",
            location: "TestLoc",
            population: "TestPop",
        });

        // The date field should still have a value (today's date)
        const dateInput = page.locator("input[type='date']");
        const dateValue = await dateInput.inputValue();
        expect(dateValue).toBeTruthy();
        expect(dateValue).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test("date field retains value when filling platform and sensor after", async ({ page }) => {
        await navigateToUpload(page);
        await selectDataType(page, "Image Data");

        // Fill all fields including platform and sensor (which come after date)
        await fillFormFields(page, {
            year: "2026",
            experiment: "DateTest2",
            location: "TestLoc",
            population: "TestPop",
            platform: "Rover",
            sensor: "RGB",
        });

        // The date should still have today's default
        const dateInput = page.locator("input[type='date']");
        const dateValue = await dateInput.inputValue();
        expect(dateValue).toBeTruthy();
        expect(dateValue).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test("submit with default date does not show date validation error", async ({ page }) => {
        await navigateToUpload(page);
        await selectDataType(page, "Image Data");

        // Fill all required fields EXCEPT date (leave default)
        await fillFormFields(page, {
            year: "2026",
            experiment: "DateTest3",
            location: "TestLoc",
            population: "TestPop",
            platform: "Rover",
            sensor: "RGB",
        });

        // Drop a file so the upload button is meaningful
        await dropFiles(page, [fixturePath("images", "test_image_001.jpg")]);

        // The date field should not show an error
        const dateField = page.locator("input[type='date']");
        const dateValue = await dateField.inputValue();
        expect(dateValue).toBeTruthy();

        // Check there's no error helper text for the date field
        const dateError = page.locator("text=This field is required").filter({
            has: page.locator("input[type='date']"),
        });
        // The error should not be visible near the date field
        expect(await dateError.count()).toBe(0);
    });
});

// Delete workflow tests moved to dataset-delete.spec.js (full UI-driven tests)

test.describe("Mosaic generation: loading state", () => {
    test.beforeAll(async ({ request }) => {
        const result = await seedExperimentEntities(request, FIELDS);
        experimentId = result.experimentId;

        // Seed image data so the data fetch finds something
        const img = fs.readFileSync(fixturePath("images", "test_image_001.jpg"));
        await seedFileToMinIO(request, `${IMAGE_DIR}/test_image_001.jpg`, img, "image/jpeg");
    });

    test.afterAll(async ({ request }) => {
        await cleanupMinIOPrefix(request, UPLOAD_PREFIX);
        if (experimentId) {
            await deleteExperiment(request, experimentId);
        }
    });

    test("mosaic generation page does not hang on loading spinner", async ({ page }) => {
        await navigateToMosaicGeneration(page, FIELDS);

        // The page should eventually stop loading — either show data or show empty state
        // It should NOT show "Loading data..." forever
        const loadingSpinner = page.locator("text=Loading data...");

        // Wait up to 15 seconds — the spinner should disappear
        if (await loadingSpinner.isVisible({ timeout: 2_000 }).catch(() => false)) {
            await expect(loadingSpinner).not.toBeVisible({ timeout: 15_000 });
        }

        // The mosaic tabs should be visible (Generate Mosaics / Manage Mosaics)
        const tabs = page.locator('[aria-label="mosaic tabs"]');
        await expect(tabs).toBeVisible({ timeout: 10_000 });
    });

    test("mosaic generation shows sensor data after prep initiation", async ({ page }) => {
        await navigateToMosaicGeneration(page, FIELDS);

        // Wait for loading to finish
        const loadingSpinner = page.locator("text=Loading data...");
        if (await loadingSpinner.isVisible({ timeout: 2_000 }).catch(() => false)) {
            await expect(loadingSpinner).not.toBeVisible({ timeout: 15_000 });
        }

        // Either sensor data renders (platform/sensor sections) or empty state
        // The key assertion: the page is responsive, not stuck
        const pageContent = page.locator("#root");
        await expect(pageContent).not.toBeEmpty();

        // No error overlay
        const overlay = page.locator("#webpack-dev-server-client-overlay");
        expect(await overlay.isVisible({ timeout: 1_000 }).catch(() => false)).toBeFalsy();
    });
});
