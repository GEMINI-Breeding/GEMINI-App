const { test, expect } = require("@playwright/test");
const {
    cleanupMinIOPrefix,
    deleteExperiment,
    getExperimentByName,
    API_BASE,
} = require("./helpers/api-helpers");
const path = require("path");
const fs = require("fs");

/**
 * REAL E2E test for data upload, viewing, editing, and deletion.
 *
 * Full workflow driven through the actual UI:
 *   1. Upload images via Prepare → Upload
 *   2. Switch to Manage tab, verify dataset appears in the table
 *   3. Click View — verify images display and Next button shows a different image
 *   4. Click Edit — change the sensor name, save, verify it updates in UI and backend
 *   5. Click Delete — confirm deletion, verify gone from UI and backend
 */

const DRONE_FIXTURES_DIR = path.join(__dirname, "fixtures", "images", "drone");
const TEST_RUN_ID = `E2E-MGR-${Date.now()}`;

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

const IGNORED_PATTERNS = [
    "chrome-extension", "inject.js", "Source Map", ".map",
    "ERR_BLOCKED_BY_CLIENT", "gemini-breeding.github.io",
    "fonts.gstatic.com", "fonts.googleapis.com",
    "mapbox", "favicon.ico", "Failed to load resource",
];
function isIgnored(text) {
    return IGNORED_PATTERNS.some(p => text.includes(p));
}

async function fillAutocomplete(page, fieldId, value) {
    const input = page.locator(`#${fieldId}`);
    await input.click();
    await input.fill(value);
    await input.press("Tab");
    await page.waitForTimeout(300);
}

test.describe("Data manage: upload → view → edit → delete", () => {
    test.afterAll(async ({ request }) => {
        // Clean up both original and renamed prefixes
        await cleanupMinIOPrefix(request, RAW_PREFIX).catch(() => {});
        const renamedPrefix = `${FIELDS.year}/${FIELDS.experiment}/${FIELDS.location}/${FIELDS.population}/${FIELDS.date}/${FIELDS.platform}/RenamedSensor`;
        await cleanupMinIOPrefix(request, renamedPrefix).catch(() => {});
        const exp = await getExperimentByName(request, FIELDS.experiment);
        if (exp) {
            await deleteExperiment(request, exp.id || exp.experiment_id).catch(() => {});
        }
    });

    test("Step 1: Upload images via the real UI", async ({ page }, testInfo) => {
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

        // Fill form
        await fillAutocomplete(page, "autocomplete-year", FIELDS.year);
        await fillAutocomplete(page, "autocomplete-experiment", FIELDS.experiment);
        await fillAutocomplete(page, "autocomplete-location", FIELDS.location);
        await fillAutocomplete(page, "autocomplete-population", FIELDS.population);
        await page.locator("input[type='date']").fill(FIELDS.date);
        await fillAutocomplete(page, "autocomplete-platform", FIELDS.platform);
        await fillAutocomplete(page, "autocomplete-sensor", FIELDS.sensor);

        // Drop files
        const metadata = JSON.parse(fs.readFileSync(path.join(DRONE_FIXTURES_DIR, "metadata.json"), "utf-8"));
        const fixtureFiles = metadata.images.map(img => path.join(DRONE_FIXTURES_DIR, img.filename));
        const fileInput = page.locator("input[type='file']").first();
        await fileInput.evaluate(el => { el.removeAttribute("webkitdirectory"); el.removeAttribute("directory"); });
        await fileInput.setInputFiles(fixtureFiles);
        await page.waitForTimeout(500);

        // Upload
        await page.locator("button[type='submit']:has-text('Upload')").click({ force: true });

        // Handle possible backend not reachable
        for (let i = 0; i < 3; i++) {
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

        await expect(page.locator("text=Upload Successful")).toBeVisible({ timeout: 120_000 });
        await page.locator("button:has-text('Done')").click();
        await page.waitForTimeout(1_000);

        expect(errors).toEqual([]);
    });

    test("Step 2: Verify dataset appears in the Manage tab", async ({ page }) => {
        await page.goto("/");
        await page.waitForSelector("#root:not(:empty)", { timeout: 15_000 });

        // Navigate: Prepare → Manage
        await page.locator("[aria-label='prepare']").click();
        await page.locator("[aria-label='manage-files']").waitFor({ state: "visible", timeout: 5_000 });
        await page.locator("[aria-label='manage-files']").click();
        await page.waitForTimeout(2_000);

        // The manage tab should show a DataGrid with our experiment
        await expect(page.locator(`text=${FIELDS.experiment}`).first()).toBeVisible({ timeout: 30_000 });

        // Verify key columns are visible
        await expect(page.locator(`text=${FIELDS.sensor}`).first()).toBeVisible();
        await expect(page.locator(`text=${FIELDS.platform}`).first()).toBeVisible();
    });

    test("Step 3: View images and navigate between them", async ({ page }, testInfo) => {
        testInfo.setTimeout(60_000);

        await page.goto("/");
        await page.waitForSelector("#root:not(:empty)", { timeout: 15_000 });

        // Navigate to Manage
        await page.locator("[aria-label='prepare']").click();
        await page.locator("[aria-label='manage-files']").waitFor({ state: "visible", timeout: 5_000 });
        await page.locator("[aria-label='manage-files']").click();
        await page.waitForTimeout(2_000);

        // Wait for our dataset row to appear
        await expect(page.locator(`text=${FIELDS.experiment}`).first()).toBeVisible({ timeout: 30_000 });

        // Click the View (eye) icon
        const viewIcon = page.locator("[data-testid='VisibilityIcon']").first();
        await expect(viewIcon).toBeVisible({ timeout: 5_000 });
        await viewIcon.click();

        // ImagePreviewer dialog should open
        await expect(page.locator("text=View Images")).toBeVisible({ timeout: 15_000 });

        // Wait for an image to load
        const image = page.locator("img[src*='download']").first();
        await expect(image).toBeVisible({ timeout: 15_000 });

        // Get the src of the first image
        const firstSrc = await image.getAttribute("src");
        expect(firstSrc).toContain("download");

        // Click Next button
        const nextBtn = page.locator("button:has-text('Next')");
        await expect(nextBtn).toBeEnabled({ timeout: 5_000 });
        await nextBtn.click();
        await page.waitForTimeout(1_000);

        // The image src should change (different image)
        const secondSrc = await image.getAttribute("src");
        expect(secondSrc).not.toBe(firstSrc);

        // Close the dialog
        await page.keyboard.press("Escape");
        await page.waitForTimeout(500);
    });

    test("Step 4: Edit dataset sensor name and verify in UI", async ({ page }, testInfo) => {
        testInfo.setTimeout(60_000);

        await page.goto("/");
        await page.waitForSelector("#root:not(:empty)", { timeout: 15_000 });

        // Navigate to Manage
        await page.locator("[aria-label='prepare']").click();
        await page.locator("[aria-label='manage-files']").waitFor({ state: "visible", timeout: 5_000 });
        await page.locator("[aria-label='manage-files']").click();
        await page.waitForTimeout(2_000);

        await expect(page.locator(`text=${FIELDS.experiment}`).first()).toBeVisible({ timeout: 30_000 });

        // Click the Edit (pencil) icon
        const editIcon = page.locator("[data-testid='EditIcon']").first();
        await expect(editIcon).toBeVisible({ timeout: 5_000 });
        await editIcon.click();

        // Edit dialog should open
        await expect(page.locator("text=Edit Row")).toBeVisible({ timeout: 5_000 });

        // Change the Sensor field
        const sensorField = page.locator("input[name='sensor']");
        await expect(sensorField).toBeVisible();
        await sensorField.clear();
        await sensorField.fill("RenamedSensor");

        // Click Save
        await page.locator("button:has-text('Save')").click();
        await page.waitForTimeout(2_000);

        // Verify the UI updated
        await expect(page.locator("text=RenamedSensor").first()).toBeVisible({ timeout: 10_000 });
    });

    test("Step 4b: Verify edit persisted in backend", async ({ request }) => {
        const renamedPrefix = `${FIELDS.year}/${FIELDS.experiment}/${FIELDS.location}/${FIELDS.population}/${FIELDS.date}/${FIELDS.platform}/RenamedSensor/Images`;
        const resp = await request.get(`${API_BASE}/files/list/gemini/${renamedPrefix}/`);
        expect(resp.ok()).toBeTruthy();
        const files = await resp.json();
        const jpgs = files.filter(f => (f.object_name || "").toLowerCase().endsWith(".jpg"));
        expect(jpgs.length).toBe(5);
    });

    test("Step 5: Delete dataset and verify cleanup", async ({ page, request }, testInfo) => {
        testInfo.setTimeout(60_000);

        await page.goto("/");
        await page.waitForSelector("#root:not(:empty)", { timeout: 15_000 });

        // Navigate to Manage
        await page.locator("[aria-label='prepare']").click();
        await page.locator("[aria-label='manage-files']").waitFor({ state: "visible", timeout: 5_000 });
        await page.locator("[aria-label='manage-files']").click();
        await page.waitForTimeout(2_000);

        // Find our test row by experiment name (DB still has original sensor name
        // since edit only moves MinIO files, doesn't update the entity)
        const testRow = page.locator(`tr:has-text("${FIELDS.experiment}")`, ).or(
            page.locator(`.MuiDataGrid-row:has-text("${FIELDS.experiment}")`)
        );
        await expect(testRow.first()).toBeVisible({ timeout: 30_000 });

        // Click Delete icon in our row
        const deleteIcon = testRow.first().locator("[data-testid='DeleteIcon']");
        await expect(deleteIcon).toBeVisible({ timeout: 5_000 });
        await deleteIcon.click();

        // Confirm deletion dialog
        const confirmBtn = page.locator("button:has-text('Delete')").or(
            page.locator("button:has-text('Confirm')").or(
                page.locator("button:has-text('Yes')")
            )
        );
        await expect(confirmBtn.first()).toBeVisible({ timeout: 5_000 });
        await confirmBtn.first().click();
        await page.waitForTimeout(3_000);

        // The dataset row should be gone from the table
        const rowGone = await testRow.first().isVisible().catch(() => false);
        expect(rowGone).toBeFalsy();

        // Verify "Successfully deleted" message appeared
        await expect(page.locator("text=Successfully deleted")).toBeVisible({ timeout: 5_000 });

        // Verify backend: files should be gone from MinIO at both original and renamed paths
        const renamedPrefix = `${FIELDS.year}/${FIELDS.experiment}/${FIELDS.location}/${FIELDS.population}/${FIELDS.date}/${FIELDS.platform}/RenamedSensor`;
        const resp1 = await request.get(`${API_BASE}/files/list/gemini/${renamedPrefix}/`);
        const files1 = await resp1.json();

        const resp2 = await request.get(`${API_BASE}/files/list/gemini/${RAW_PREFIX}/`);
        const files2 = await resp2.json();

        expect(files1.length + files2.length).toBe(0);
    });
});
