const { test, expect } = require("@playwright/test");
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
    verifyFileInMinIO,
    cleanupMinIOPrefix,
    clearUploadCache,
    getExperimentByName,
    getExperimentHierarchy,
    deleteExperiment,
} = require("./helpers/api-helpers");

/**
 * E2E tests for all non-binary, non-ortho upload types in framework mode.
 *
 * Tests image, weather, CSV (GCP Locations), and platform log uploads.
 * Also verifies entity registration (experiment, season, site, population,
 * sensor platform, sensor, dataset) and the Manage tab.
 *
 * Prerequisites:
 *   - Framework backend running at port 7777 (docker compose up)
 *   - Frontend running at port 3000 with REACT_APP_BACKEND_MODE=framework
 */

const TEST_RUN_ID = `E2E-TYPES-${Date.now()}`;

// ─── Image Upload ───────────────────────────────────────────────────────────

test.describe("Image upload", () => {
    test.setTimeout(60_000);

    const IMAGE_FIELDS = {
        year: "2024",
        experiment: TEST_RUN_ID,
        location: "Davis",
        population: "TestPop",
        date: "2024-07-15",
        platform: "Rover",
        sensor: "RGB-Cam",
    };

    // Expected: {year}/{experiment}/{location}/{population}/{date}/{platform}/{sensor}/Images/
    const expectedDir = `${IMAGE_FIELDS.year}/${TEST_RUN_ID}/${IMAGE_FIELDS.location}/${IMAGE_FIELDS.population}/${IMAGE_FIELDS.date}/${IMAGE_FIELDS.platform}/${IMAGE_FIELDS.sensor}/Images`;

    test.afterEach(async ({ page, request }) => {
        await page.goto("about:blank");
        await cleanupMinIOPrefix(request, expectedDir);
        await clearUploadCache(request, "test_image_001.jpg");
        await clearUploadCache(request, "test_image_002.jpg");
    });

    test("uploads image files to MinIO via chunked upload", async ({
        page,
        request,
    }) => {
        await navigateToUpload(page);
        await selectDataType(page, "Image Data");
        await fillFormFields(page, IMAGE_FIELDS);
        await dropFiles(page, [
            fixturePath("images", "test_image_001.jpg"),
            fixturePath("images", "test_image_002.jpg"),
        ]);

        // Both files visible in dropzone
        await expect(page.locator("text=test_image_001.jpg")).toBeVisible();
        await expect(page.locator("text=test_image_002.jpg")).toBeVisible();

        await submitUpload(page);
        await waitForUploadComplete(page);

        // Verify files in MinIO
        const img1 = await verifyFileInMinIO(request, expectedDir, "test_image_001.jpg");
        const img2 = await verifyFileInMinIO(request, expectedDir, "test_image_002.jpg");
        expect(img1).toBeTruthy();
        expect(img2).toBeTruthy();
    });

    test("can upload another batch after clicking Done", async ({
        page,
        request,
    }) => {
        await navigateToUpload(page);
        await selectDataType(page, "Image Data");
        await fillFormFields(page, IMAGE_FIELDS);
        await dropFiles(page, [fixturePath("images", "test_image_001.jpg")]);
        await submitUpload(page);
        await waitForUploadComplete(page);

        // Click Done — form should reset
        await clickDone(page);

        // Form should be back to initial state with Data Type selector visible
        await expect(
            page.locator("label:has-text('Data Type')")
        ).toBeVisible({ timeout: 5_000 });
    });
});

// ─── Weather CSV Upload ─────────────────────────────────────────────────────

test.describe("Weather data upload", () => {
    test.setTimeout(60_000);

    const WEATHER_FIELDS = {
        year: "2024",
        experiment: TEST_RUN_ID,
        location: "Davis",
        population: "TestPop",
        date: "2024-07-15",
    };

    // Weather has no platform/sensor: {year}/{experiment}/{location}/{population}/{date}/
    const expectedDir = `${WEATHER_FIELDS.year}/${TEST_RUN_ID}/${WEATHER_FIELDS.location}/${WEATHER_FIELDS.population}/${WEATHER_FIELDS.date}`;

    test.afterEach(async ({ page, request }) => {
        await page.goto("about:blank");
        await cleanupMinIOPrefix(request, expectedDir);
        await clearUploadCache(request, "test_weather.csv");
    });

    test("uploads weather CSV to MinIO", async ({ page, request }) => {
        await navigateToUpload(page);
        await selectDataType(page, "Weather Data");
        await fillFormFields(page, WEATHER_FIELDS);
        await dropFiles(page, [fixturePath("csv", "test_weather.csv")]);

        await expect(page.locator("text=test_weather.csv")).toBeVisible();

        await submitUpload(page);
        await waitForUploadComplete(page);

        const exists = await verifyFileInMinIO(request, expectedDir, "test_weather.csv");
        expect(exists).toBeTruthy();
    });
});

// ─── GCP Locations CSV Upload ───────────────────────────────────────────────

test.describe("GCP Locations upload", () => {
    test.setTimeout(60_000);

    const GCP_FIELDS = {
        year: "2024",
        experiment: TEST_RUN_ID,
        location: "Davis",
        population: "TestPop",
    };

    // GCP Locations has no date/platform/sensor: {year}/{experiment}/{location}/{population}/
    const expectedDir = `${GCP_FIELDS.year}/${TEST_RUN_ID}/${GCP_FIELDS.location}/${GCP_FIELDS.population}`;

    test.afterEach(async ({ page, request }) => {
        await page.goto("about:blank");
        await cleanupMinIOPrefix(request, expectedDir);
        await clearUploadCache(request, "gcp_locations.csv");
    });

    test("uploads GCP locations CSV to MinIO", async ({ page, request }) => {
        await navigateToUpload(page);
        await selectDataType(page, "GCP Locations");
        await fillFormFields(page, GCP_FIELDS);
        await dropFiles(page, [fixturePath("csv", "gcp_locations.csv")]);

        await expect(page.locator("text=gcp_locations.csv")).toBeVisible();

        await submitUpload(page);
        await waitForUploadComplete(page);

        const exists = await verifyFileInMinIO(
            request,
            expectedDir,
            "gcp_locations.csv"
        );
        expect(exists).toBeTruthy();
    });
});

// ─── Platform Logs Upload ───────────────────────────────────────────────────

test.describe("Platform Logs upload", () => {
    test.setTimeout(60_000);

    const LOGS_FIELDS = {
        year: "2024",
        experiment: TEST_RUN_ID,
        location: "Davis",
        population: "TestPop",
        date: "2024-07-15",
        platform: "Rover",
        sensor: "IMU",
    };

    // Logs: {year}/{experiment}/{location}/{population}/{date}/{platform}/{sensor}/Metadata/
    const expectedDir = `${LOGS_FIELDS.year}/${TEST_RUN_ID}/${LOGS_FIELDS.location}/${LOGS_FIELDS.population}/${LOGS_FIELDS.date}/${LOGS_FIELDS.platform}/${LOGS_FIELDS.sensor}/Metadata`;

    test.afterEach(async ({ page, request }) => {
        await page.goto("about:blank");
        await cleanupMinIOPrefix(request, expectedDir);
        await clearUploadCache(request, "test_platform_log.txt");
    });

    test("uploads platform log file to MinIO", async ({ page, request }) => {
        await navigateToUpload(page);
        await selectDataType(page, "Platform Logs");
        await fillFormFields(page, LOGS_FIELDS);
        await dropFiles(page, [fixturePath("logs", "test_platform_log.txt")]);

        await expect(page.locator("text=test_platform_log.txt")).toBeVisible();

        await submitUpload(page);
        await waitForUploadComplete(page);

        const exists = await verifyFileInMinIO(
            request,
            expectedDir,
            "test_platform_log.txt"
        );
        expect(exists).toBeTruthy();
    });
});

// ─── Entity Registration ────────────────────────────────────────────────────
//
// Verifies that after a successful upload, the corresponding database entities
// (experiment, season, site, population, sensor platform, sensor, dataset)
// are created in the framework backend.

test.describe("Entity registration after upload", () => {
    test.setTimeout(60_000);

    // Use realistic field values — date picker produces ISO format,
    // multi-word names, hyphens, longer strings
    const ENTITY_FIELDS = {
        year: "2026",
        experiment: `${TEST_RUN_ID}-entity`,
        location: "WestDavis",
        population: "Cowpea-Accession42",
        date: "2026-09-09",
        platform: "AmigaRover",
        sensor: "OAK-D-LR",
    };

    const expectedDir = `${ENTITY_FIELDS.year}/${ENTITY_FIELDS.experiment}/${ENTITY_FIELDS.location}/${ENTITY_FIELDS.population}/${ENTITY_FIELDS.date}/${ENTITY_FIELDS.platform}/${ENTITY_FIELDS.sensor}/Images`;

    test.afterEach(async ({ page, request }) => {
        await page.goto("about:blank");
        await cleanupMinIOPrefix(request, expectedDir);
        await clearUploadCache(request, "test_image_001.jpg");
        // Clean up experiment and related entities
        const exp = await getExperimentByName(request, ENTITY_FIELDS.experiment);
        if (exp && exp.experiment_id) {
            await deleteExperiment(request, exp.experiment_id);
        }
    });

    test("creates experiment and associated entities after image upload with realistic field values", async ({
        page,
        request,
    }) => {
        await navigateToUpload(page);
        await selectDataType(page, "Image Data");
        await fillFormFields(page, ENTITY_FIELDS);
        await dropFiles(page, [fixturePath("images", "test_image_001.jpg")]);
        await submitUpload(page);
        await waitForUploadComplete(page);

        // Verify experiment was created
        const experiment = await getExperimentByName(
            request,
            ENTITY_FIELDS.experiment
        );
        expect(experiment).toBeTruthy();
        expect(experiment.experiment_name).toBe(ENTITY_FIELDS.experiment);

        // Verify hierarchy contains all expected entities
        const hierarchy = await getExperimentHierarchy(
            request,
            experiment.experiment_id
        );
        expect(hierarchy).toBeTruthy();

        // Season from year
        expect(hierarchy.seasons).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ season_name: ENTITY_FIELDS.year }),
            ])
        );

        // Site from location
        expect(hierarchy.sites).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ site_name: ENTITY_FIELDS.location }),
            ])
        );

        // Population
        expect(hierarchy.populations).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    population_name: ENTITY_FIELDS.population,
                }),
            ])
        );

        // Sensor platform
        expect(hierarchy.sensor_platforms).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    sensor_platform_name: ENTITY_FIELDS.platform,
                }),
            ])
        );

        // Sensor
        expect(hierarchy.sensors).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    sensor_name: ENTITY_FIELDS.sensor,
                }),
            ])
        );

        // Dataset — date may be normalized by backend (e.g., "9-9-2026" → "2026-09-09")
        expect(hierarchy.datasets.length).toBeGreaterThan(0);
        expect(hierarchy.datasets).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    dataset_name: expect.stringContaining(ENTITY_FIELDS.experiment),
                }),
            ])
        );
    });

    test("entity registration is idempotent (re-upload does not duplicate)", async ({
        page,
        request,
    }) => {
        test.setTimeout(120_000);
        // First upload
        await navigateToUpload(page);
        await selectDataType(page, "Image Data");
        await fillFormFields(page, ENTITY_FIELDS);
        await dropFiles(page, [fixturePath("images", "test_image_001.jpg")]);
        await submitUpload(page);
        await waitForUploadComplete(page);
        await clickDone(page);

        // Second upload with same fields
        await selectDataType(page, "Image Data");
        await fillFormFields(page, ENTITY_FIELDS);
        await dropFiles(page, [fixturePath("images", "test_image_001.jpg")]);
        await submitUpload(page);
        await waitForUploadComplete(page);

        // Verify only one experiment exists with this name
        const experiment = await getExperimentByName(
            request,
            ENTITY_FIELDS.experiment
        );
        expect(experiment).toBeTruthy();

        const hierarchy = await getExperimentHierarchy(
            request,
            experiment.experiment_id
        );

        // Should have exactly one of each entity (not duplicated)
        const seasons = hierarchy.seasons.filter(
            (s) => s.season_name === ENTITY_FIELDS.year
        );
        expect(seasons).toHaveLength(1);

        const sites = hierarchy.sites.filter(
            (s) => s.site_name === ENTITY_FIELDS.location
        );
        expect(sites).toHaveLength(1);

        const populations = hierarchy.populations.filter(
            (p) => p.population_name === ENTITY_FIELDS.population
        );
        expect(populations).toHaveLength(1);
    });
});

// ─── Manage Tab ─────────────────────────────────────────────────────────────
//
// Verifies that after uploading data, the Manage tab can display it.

test.describe("Manage tab after upload", () => {
    test.setTimeout(60_000);

    const MANAGE_FIELDS = {
        year: "2024",
        experiment: `${TEST_RUN_ID}-manage`,
        location: "Davis",
        population: "TestPop",
        date: "2024-07-15",
        platform: "Rover",
        sensor: "RGB-Cam",
    };

    const expectedDir = `${MANAGE_FIELDS.year}/${MANAGE_FIELDS.experiment}/${MANAGE_FIELDS.location}/${MANAGE_FIELDS.population}/${MANAGE_FIELDS.date}/${MANAGE_FIELDS.platform}/${MANAGE_FIELDS.sensor}/Images`;

    test.afterEach(async ({ page, request }) => {
        await page.goto("about:blank");
        await cleanupMinIOPrefix(request, expectedDir);
        await clearUploadCache(request, "test_image_001.jpg");
        const exp = await getExperimentByName(request, MANAGE_FIELDS.experiment);
        if (exp && exp.experiment_id) {
            await deleteExperiment(request, exp.experiment_id);
        }
    });

    test("Manage page shows uploaded data in the table", async ({
        page,
        request,
    }) => {
        // Upload a file first
        await navigateToUpload(page);
        await selectDataType(page, "Image Data");
        await fillFormFields(page, MANAGE_FIELDS);
        await dropFiles(page, [fixturePath("images", "test_image_001.jpg")]);
        await submitUpload(page);
        await waitForUploadComplete(page);
        await clickDone(page);

        // Navigate to Manage page
        const manageButton = page.locator("[aria-label='manage-files']");
        await manageButton.waitFor({ state: "visible", timeout: 5_000 });
        await manageButton.click();

        // Wait for the DataGrid to load with actual data rows
        await page.locator(".MuiDataGrid-row").first().waitFor({ state: "visible", timeout: 10_000 });

        // Verify data rows are present (at least one row with our location)
        // Cell text may be truncated in narrow columns, so check the row's full text
        const dataRow = page.locator(`.MuiDataGrid-row:has-text("${MANAGE_FIELDS.location}")`).first();
        await expect(dataRow).toBeVisible({ timeout: 5_000 });
    });
});

// ─── Error Dialog ───────────────────────────────────────────────────────────
//
// Verifies that the error dialog surfaces when the backend is unreachable.

test.describe("Error dialog on backend failure", () => {
    test.setTimeout(30_000);

    test("shows error dialog when backend health check fails", async ({
        page,
    }) => {
        await navigateToUpload(page);
        await selectDataType(page, "Image Data");
        await fillFormFields(page, {
            year: "2024",
            experiment: "ErrorTest",
            location: "Davis",
            population: "TestPop",
            date: "2024-07-15",
            platform: "Rover",
            sensor: "RGB-Cam",
        });
        await dropFiles(page, [fixturePath("images", "test_image_001.jpg")]);

        // Block the backend by intercepting the health check request
        await page.route("**/api/files/list/**", (route) => route.abort());

        await submitUpload(page);

        // Error dialog should appear
        await expect(
            page.locator("role=dialog")
        ).toBeVisible({ timeout: 10_000 });

        await expect(
            page.locator("text=Backend Not Reachable")
        ).toBeVisible();

        // Dialog should have an OK button to dismiss
        const okButton = page.locator("role=dialog >> button:has-text('OK')");
        await expect(okButton).toBeVisible();
        await okButton.click();

        // Dialog should close
        await expect(
            page.locator("role=dialog")
        ).not.toBeVisible();
    });
});
