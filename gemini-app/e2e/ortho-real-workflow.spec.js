const { test, expect } = require("@playwright/test");
const {
    cleanupMinIOPrefix,
    deleteExperiment,
    getExperimentByName,
    cancelJob,
    deleteJob,
    API_BASE,
} = require("./helpers/api-helpers");
const path = require("path");
const fs = require("fs");

/**
 * REAL end-to-end orthomosaic generation test.
 *
 * Drives the actual UI — clicking buttons, filling forms, dropping
 * files — exactly as a user would. NO API shortcuts, NO mocking.
 *
 * Full workflow:
 *   1. Upload drone images via Prepare → Upload
 *   2. Navigate to Process → Mosaic Generation
 *   3. Select experiment/year/location/population, click Begin Data Preparation
 *   4. Expand the platform/sensor accordion, click "Start" on a date row
 *   5. In the ImageViewer, click "Generate Orthophoto"
 *   6. In the OrthoModal, click "Process Images"
 *   7. Wait for ODM processing to complete via the progress bar
 *   8. Verify the orthophoto was produced
 */

const DRONE_FIXTURES_DIR = path.join(__dirname, "fixtures", "images", "drone");
const TEST_RUN_ID = `E2E-REAL-${Date.now()}`;

const FIELDS = {
    year: "2022",
    experiment: TEST_RUN_ID,
    location: "Davis",
    population: "Cowpea",
    date: "2022-06-27",
    platform: "DJI",
    sensor: "FC6310S",
};

const RAW_PREFIX = `${FIELDS.year}/${FIELDS.experiment}/${FIELDS.location}/${FIELDS.population}/${FIELDS.date}/${FIELDS.platform}/${FIELDS.sensor}`;
const PROCESSED_PREFIX = `Processed/${RAW_PREFIX}`;

let createdJobIds = [];

// Errors to ignore in console/network
const IGNORED_PATTERNS = [
    "chrome-extension", "inject.js", "Source Map", ".map",
    "ERR_BLOCKED_BY_CLIENT", "gemini-breeding.github.io",
    "fonts.gstatic.com", "fonts.googleapis.com",
    "mapbox", "favicon.ico", "Failed to load resource",
];

function isIgnored(text) {
    return IGNORED_PATTERNS.some(p => text.includes(p));
}

/**
 * Fill a freeSolo Autocomplete by typing and tabbing out (NOT Enter — that submits the form).
 */
async function fillAutocomplete(page, fieldId, value) {
    const input = page.locator(`#${fieldId}`);
    await input.click();
    await input.fill(value);
    await input.press("Tab");
    await page.waitForTimeout(300);
}

/**
 * Select a value from a non-freeSolo Autocomplete dropdown.
 */
async function selectAutocomplete(page, fieldId, value, timeout = 15_000) {
    const input = page.locator(`#${fieldId}`);
    await input.click();
    const option = page.locator(`li[role="option"]:has-text("${value}")`);
    await option.waitFor({ state: "visible", timeout });
    await option.click();
    await page.waitForTimeout(500);
}

test.describe("Real ortho generation: upload → generate → verify", () => {
    test.afterAll(async ({ request }) => {
        for (const jobId of createdJobIds) {
            await cancelJob(request, jobId).catch(() => {});
            await deleteJob(request, jobId).catch(() => {});
        }
        await cleanupMinIOPrefix(request, RAW_PREFIX).catch(() => {});
        await cleanupMinIOPrefix(request, PROCESSED_PREFIX).catch(() => {});
        // Clean up GCP file (stored at year/experiment/location/population/ level)
        const gcpPrefix = `${FIELDS.year}/${FIELDS.experiment}/${FIELDS.location}/${FIELDS.population}`;
        await cleanupMinIOPrefix(request, gcpPrefix).catch(() => {});
        const exp = await getExperimentByName(request, FIELDS.experiment);
        if (exp) {
            await deleteExperiment(request, exp.id || exp.experiment_id).catch(() => {});
        }
    });

    test("upload drone images via the real UI", async ({ page }, testInfo) => {
        testInfo.setTimeout(180_000);

        const errors = [];
        page.on("console", msg => {
            if (msg.type() === "error" && !isIgnored(msg.text())) errors.push(msg.text());
        });
        page.on("response", resp => {
            if (resp.status() >= 400 && resp.status() !== 409) {
                const url = resp.url();
                if (!isIgnored(url) && !url.endsWith("/experiments") && !url.includes("/list_nested"))
                    errors.push(`HTTP ${resp.status()} ${resp.request().method()} ${url}`);
            }
        });

        await page.goto("/");
        await page.waitForSelector("#root:not(:empty)", { timeout: 15_000 });

        // Navigate: Prepare → Upload
        await page.locator("[aria-label='prepare']").click();
        await page.locator("[aria-label='upload-files']").waitFor({ state: "visible", timeout: 5_000 });
        await page.locator("[aria-label='upload-files']").click();
        await page.waitForTimeout(1_000);

        // Verify upload form
        await expect(page.locator(".MuiSelect-select")).toContainText("Image Data");

        // Fill form fields
        await fillAutocomplete(page, "autocomplete-year", FIELDS.year);
        await fillAutocomplete(page, "autocomplete-experiment", FIELDS.experiment);
        await fillAutocomplete(page, "autocomplete-location", FIELDS.location);
        await fillAutocomplete(page, "autocomplete-population", FIELDS.population);
        await page.locator("input[type='date']").fill(FIELDS.date);
        await fillAutocomplete(page, "autocomplete-platform", FIELDS.platform);
        await fillAutocomplete(page, "autocomplete-sensor", FIELDS.sensor);

        // Drop fixture images
        const metadata = JSON.parse(fs.readFileSync(path.join(DRONE_FIXTURES_DIR, "metadata.json"), "utf-8"));
        const fixtureFiles = metadata.images.map(img => path.join(DRONE_FIXTURES_DIR, img.filename));

        const fileInput = page.locator("input[type='file']").first();
        await fileInput.evaluate(el => { el.removeAttribute("webkitdirectory"); el.removeAttribute("directory"); });
        await fileInput.setInputFiles(fixtureFiles);
        await page.waitForTimeout(500);

        // Verify files in dropzone
        for (const img of metadata.images) {
            await expect(page.locator(`text=${img.filename}`).first()).toBeVisible({ timeout: 5_000 });
        }

        // Click Upload
        await page.locator("button[type='submit']:has-text('Upload')").click({ force: true });

        // Handle possible "Backend Not Reachable" dialog
        for (let attempt = 0; attempt < 3; attempt++) {
            const errorVisible = await page.locator("text=Backend Not Reachable").isVisible().catch(() => false);
            if (errorVisible) {
                await page.locator("button:has-text('OK')").click({ force: true }).catch(() => {});
                await page.waitForTimeout(2_000);
                await page.locator("button[type='submit']:has-text('Upload')").click({ force: true });
                continue;
            }
            const uploading = await page.locator("text=Uploading").or(page.locator("text=Upload Successful")).isVisible().catch(() => false);
            if (uploading) break;
            await page.waitForTimeout(2_000);
        }

        // Wait for upload complete
        await expect(page.locator("text=Upload Successful")).toBeVisible({ timeout: 120_000 });

        // Click Done
        await page.locator("button:has-text('Done')").click();
        await page.waitForTimeout(1_000);

        // Verify no critical errors during upload
        expect(errors).toEqual([]);
    });

    test("verify images landed in MinIO", async ({ request }) => {
        const resp = await request.get(`${API_BASE}/files/list/gemini/${RAW_PREFIX}/Images/`);
        expect(resp.ok()).toBeTruthy();
        const files = await resp.json();
        const jpgs = files.filter(f => (f.object_name || "").toLowerCase().endsWith(".jpg"));
        expect(jpgs.length).toBe(5);
    });

    test("navigate to mosaic generation, select data, and trigger ortho", async ({ page }, testInfo) => {
        testInfo.setTimeout(600_000); // 10 min — ODM processing takes time

        const errors = [];
        page.on("console", msg => {
            if (msg.type() === "error" && !isIgnored(msg.text())) errors.push(msg.text());
        });

        await page.goto("/");
        await page.waitForSelector("#root:not(:empty)", { timeout: 15_000 });

        // Navigate: Process → Mosaic Generation
        await page.locator("[aria-label='process']").click();
        await page.locator("[aria-label='mosaic-generation']").waitFor({ state: "visible", timeout: 5_000 });
        await page.locator("[aria-label='mosaic-generation']").click();
        await page.waitForTimeout(1_000);

        // Select experiment from dropdown
        await selectAutocomplete(page, "experiment-combo-box", FIELDS.experiment);

        // Year, Location, Population should now be visible in the sidebar
        await selectAutocomplete(page, "year-combo-box", FIELDS.year, 30_000);
        await selectAutocomplete(page, "location-combo-box", FIELDS.location);
        await selectAutocomplete(page, "population-combo-box", FIELDS.population);

        // Click "Begin Data Preparation"
        await page.locator("button:has-text('Begin Data Preparation')").click();
        await page.waitForTimeout(3_000);

        // "Generate Mosaics" tab should be visible with data
        await expect(page.locator("text=Generate Mosaics").first()).toBeVisible({ timeout: 15_000 });

        // Wait for the sensor hierarchy to load — look for our platform name
        await expect(page.locator(`text=${FIELDS.platform}`).first()).toBeVisible({ timeout: 30_000 });

        // Expand the platform accordion
        const platformAccordion = page.locator(`text=${FIELDS.platform}`).first();
        await platformAccordion.click();
        await page.waitForTimeout(1_000);

        // Look for sensor name inside the expanded accordion
        await expect(page.locator(`text=${FIELDS.sensor}`).first()).toBeVisible({ timeout: 10_000 });

        // Expand the sensor accordion
        await page.locator(`text=${FIELDS.sensor}`).first().click();
        await page.waitForTimeout(1_000);

        // Find the "Start" button for our date row — this opens the ImageViewer
        const startButton = page.locator("button:has-text('Start')").first();
        await expect(startButton).toBeVisible({ timeout: 10_000 });
        await startButton.click();

        // ImageViewer dialog should open — first it shows a GCP options dialog
        // asking to upload gcp_locations.csv. Upload the test fixture CSV.
        const gcpFileInput = page.locator("input[type='file']").last();
        const gcpCsvPath = path.join(__dirname, "fixtures", "csv", "gcp_locations.csv");
        await gcpFileInput.setInputFiles(gcpCsvPath);
        await page.waitForTimeout(2_000);

        // After upload, the button must change to "Continue with current GCP"
        const continueBtn = page.locator("button:has-text('Continue with current GCP')");
        await expect(continueBtn).toBeVisible({ timeout: 15_000 });
        await continueBtn.click();
        await page.waitForTimeout(2_000);

        // Now the image viewer should load images and show the Generate Orthophoto button
        await expect(page.locator("text=Generate Orthophoto")).toBeVisible({ timeout: 30_000 });

        // Verify an actual image is displaying (not just buttons)
        // The PointPicker renders a canvas over an image
        const imageOrCanvas = page.locator("canvas").or(page.locator("img[src*='download']"));
        await expect(imageOrCanvas.first()).toBeVisible({ timeout: 15_000 });

        // Click "Generate Orthophoto" — opens OrthoModal
        await page.locator("button:has-text('Generate Orthophoto')").click();
        await page.waitForTimeout(1_000);

        // OrthoModal should show — verify it's open
        await expect(page.locator("text=Total Images")).toBeVisible({ timeout: 10_000 });

        // Settings should default to "Default"
        // Click "Process Images" to submit the ODM job
        await page.locator("button:has-text('Process Images')").click();

        // The modal closes and the progress bar should appear
        // Look for the ortho progress bar with "Ortho Generation in Progress"
        await expect(
            page.locator("text=Ortho Generation in Progress")
        ).toBeVisible({ timeout: 30_000 });

        // Now wait for the ODM processing to complete
        console.log("ODM job submitted, waiting for completion...");

        // First verify progress moves past 0% within 60s (worker is actually processing)
        const progressText = page.locator("text=/%/");
        for (let i = 0; i < 12; i++) {
            await page.waitForTimeout(5_000);
            const pctText = await progressText.textContent().catch(() => "0%");
            const pct = parseInt(pctText) || 0;
            if (pct > 0) {
                console.log(`Progress started: ${pct}%`);
                break;
            }
            if (i === 11) {
                // Take screenshot and fail fast
                await page.screenshot({ path: "test-results/ortho-stuck-at-zero.png" });
                throw new Error("ODM progress stuck at 0% for 60 seconds — worker may not be processing");
            }
        }

        // Wait for completion: success message and DONE button should appear
        // ODM with 5 small downscaled images should take 1-5 minutes
        const successMessage = page.locator("text=Orthophoto generated successfully");
        const doneButton = page.locator("button:has-text('DONE')");

        await expect(successMessage).toBeVisible({ timeout: 540_000 });
        console.log("ODM complete — success message visible");

        // Verify the DONE button is visible alongside the success message
        await expect(doneButton).toBeVisible({ timeout: 5_000 });

        // Wait a few seconds to confirm the completion state persists (doesn't vanish)
        await page.waitForTimeout(5_000);
        await expect(successMessage).toBeVisible();
        await expect(doneButton).toBeVisible();

        await page.screenshot({ path: "test-results/ortho-complete.png" });

        // Dismiss the completion bar — this triggers AerialDataPrep to re-fetch
        await doneButton.click();
        await page.waitForTimeout(3_000);

        // Verify the progress bar is gone after dismissal
        await expect(successMessage).not.toBeVisible({ timeout: 5_000 });

        // Wait for AerialDataPrep to re-fetch and re-render with updated ortho status
        await page.waitForTimeout(5_000);

        // Expand the platform/sensor accordion to see the date row
        // (may already be expanded, click to toggle then re-expand if needed)
        const platformRow = page.locator(`text=${FIELDS.platform}`).first();
        await platformRow.click();
        await page.waitForTimeout(1_000);

        // Check if sensor is visible; if not, platform was just collapsed — click again
        const sensorRow = page.locator(`text=${FIELDS.sensor}`).first();
        if (!await sensorRow.isVisible({ timeout: 2_000 }).catch(() => false)) {
            await platformRow.click();
            await page.waitForTimeout(1_000);
        }
        await sensorRow.click();
        await page.waitForTimeout(2_000);

        // The date row should now show a checkbox instead of "Start"
        // Poll briefly in case the re-fetch is still in progress
        for (let i = 0; i < 5; i++) {
            const startVisible = await page.locator("button:has-text('Start')").first()
                .isVisible({ timeout: 2_000 }).catch(() => false);
            if (!startVisible) {
                console.log("Date row updated: Start button replaced after ortho completion");
                break;
            }
            if (i === 4) {
                await page.screenshot({ path: "test-results/ortho-checkbox-missing.png" });
                throw new Error("Date row still shows 'Start' button after ortho completed — checkbox should appear");
            }
            await page.waitForTimeout(3_000);
        }
    });

    test("verify GCP locations CSV was uploaded to MinIO", async ({ request }) => {
        const gcpDir = `${FIELDS.year}/${FIELDS.experiment}/${FIELDS.location}/${FIELDS.population}`;
        const resp = await request.get(`${API_BASE}/files/list/gemini/${gcpDir}/`);
        expect(resp.ok()).toBeTruthy();
        const files = await resp.json();
        const names = files.map(f => f.object_name || "");
        expect(names.some(n => n.includes("gcp_locations.csv"))).toBeTruthy();
    });

    test("verify orthophoto and COG pyramid exist in MinIO", async ({ request }) => {
        // The COG job runs asynchronously after ODM — poll until it appears
        let pyramid = null;
        for (let i = 0; i < 30; i++) {
            const resp = await request.get(`${API_BASE}/files/list/gemini/${PROCESSED_PREFIX}/`);
            expect(resp.ok()).toBeTruthy();
            const files = await resp.json();

            const ortho = files.find(f => (f.object_name || "").includes("odm_orthophoto.tif"));
            if (!ortho && i < 5) {
                // ODM may still be uploading — wait
                await new Promise(r => setTimeout(r, 5_000));
                continue;
            }
            expect(ortho).toBeTruthy();
            expect(ortho.size).toBeGreaterThan(100_000);
            console.log(`Orthophoto size: ${(ortho.size / 1024 / 1024).toFixed(1)} MB`);

            const log = files.find(f => (f.object_name || "").includes("odm_log.txt"));
            expect(log).toBeTruthy();

            // Check for COG pyramid (created by chained CREATE_COG job)
            pyramid = files.find(f => (f.object_name || "").includes("Pyramid.tif"));
            if (pyramid) {
                console.log(`COG pyramid size: ${(pyramid.size / 1024 / 1024).toFixed(1)} MB`);
                break;
            }

            // COG job may still be processing — wait and retry
            console.log(`Waiting for COG pyramid... (attempt ${i + 1})`);
            await new Promise(r => setTimeout(r, 5_000));
        }
        expect(pyramid).toBeTruthy();
    });
});
