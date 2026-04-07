const { test, expect } = require("@playwright/test");
const { seedFileToMinIO } = require("./helpers/manage-helpers");
const {
    cleanupMinIOPrefix,
    deleteExperiment,
    API_BASE,
} = require("./helpers/api-helpers");
const {
    navigateToImageQuery,
    seedExperimentEntities,
} = require("./helpers/prep-helpers");
const path = require("path");
const fs = require("fs");

/**
 * Image query and GCP E2E tests — image query navigation,
 * GCP file operations, and image browsing.
 *
 * All tests run against real framework backend. No mocking.
 */

const TEST_RUN_ID = `E2E-IMG-${Date.now()}`;
const FIELDS = {
    experiment: TEST_RUN_ID,
    year: "2024",
    location: "Davis",
    population: "TestPop",
    platform: "Rover",
    sensor: "RGB-Cam",
    date: "2024-07-15",
};

const RAW_PREFIX = `${FIELDS.year}/${FIELDS.experiment}/${FIELDS.location}/${FIELDS.population}`;
const IMAGE_DIR = `${RAW_PREFIX}/${FIELDS.date}/${FIELDS.platform}/${FIELDS.sensor}/Images`;
const PROCESSED_PREFIX = `Processed/${FIELDS.year}/${FIELDS.experiment}/${FIELDS.location}/${FIELDS.population}`;

let experimentId;

test.describe("Image query navigation", () => {
    test("navigate to image query view via sidebar", async ({ page }) => {
        await page.goto("/");
        await page.waitForSelector("#root:not(:empty)", { timeout: 15_000 });

        const viewDataButton = page.locator("[aria-label='view-data']");
        await viewDataButton.waitFor({ state: "visible", timeout: 15_000 });
        await viewDataButton.click();

        const queryButton = page.locator("[aria-label='query']");
        await queryButton.waitFor({ state: "visible", timeout: 5_000 });
        await queryButton.click();
        await page.waitForTimeout(500);

        // Image query view should render
        // Check for sidebar with experiment selection
        const sidebar = page.locator(".MuiDrawer-root");
        await expect(sidebar.first()).toBeAttached({ timeout: 10_000 });
    });

    test("image query shows experiment selection in sidebar", async ({ page }) => {
        await navigateToImageQuery(page);
        await page.waitForTimeout(1_000);

        // The GCPPickerSelectionMenu should show experiment dropdown
        const experimentCombo = page.locator("#experiment-combo-box");
        await expect(experimentCombo).toBeVisible({ timeout: 10_000 });

        // Begin Data Preparation button should be visible
        const beginButton = page.locator("button:has-text('Begin Data Preparation')");
        await expect(beginButton).toBeVisible();
    });
});

test.describe("GCP file operations via API", () => {
    test.beforeAll(async ({ request }) => {
        const result = await seedExperimentEntities(request, FIELDS);
        experimentId = result.experimentId;
    });

    test.afterAll(async ({ request }) => {
        await cleanupMinIOPrefix(request, RAW_PREFIX);
        await cleanupMinIOPrefix(request, PROCESSED_PREFIX);
        if (experimentId) {
            await deleteExperiment(request, experimentId);
        }
    });

    test("upload and retrieve GCP locations CSV", async ({ request }) => {
        const gcpContent = fs.readFileSync(
            path.join(__dirname, "fixtures", "csv", "test_gcp_locations.csv"),
            "utf-8"
        );
        const gcpPath = `${RAW_PREFIX}/GCPLocations.csv`;

        // Upload GCP file
        await seedFileToMinIO(request, gcpPath, gcpContent, "text/csv");

        // Download and verify
        const resp = await request.get(
            `${API_BASE}/files/download/gemini/${gcpPath}`
        );
        expect(resp.ok()).toBeTruthy();
        const content = await resp.text();
        expect(content).toContain("Label,Lat_dec,Lon_dec");
    });

    test("seed images and verify listing", async ({ request }) => {
        const img1 = fs.readFileSync(
            path.join(__dirname, "fixtures", "images", "test_image_001.jpg")
        );
        const img2 = fs.readFileSync(
            path.join(__dirname, "fixtures", "images", "test_image_002.jpg")
        );

        await seedFileToMinIO(
            request,
            `${IMAGE_DIR}/test_image_001.jpg`,
            img1,
            "image/jpeg"
        );
        await seedFileToMinIO(
            request,
            `${IMAGE_DIR}/test_image_002.jpg`,
            img2,
            "image/jpeg"
        );

        // List images
        const resp = await request.get(`${API_BASE}/files/list/gemini/${IMAGE_DIR}`);
        expect(resp.ok()).toBeTruthy();
        const files = await resp.json();
        const names = Array.isArray(files)
            ? files.map((f) => (typeof f === "string" ? f : f.object_name || f.name || ""))
            : [];
        expect(names.some((n) => n.includes("test_image_001.jpg"))).toBeTruthy();
        expect(names.some((n) => n.includes("test_image_002.jpg"))).toBeTruthy();
    });

    test("image files are downloadable", async ({ request }) => {
        const img = fs.readFileSync(
            path.join(__dirname, "fixtures", "images", "test_image_001.jpg")
        );
        await seedFileToMinIO(
            request,
            `${IMAGE_DIR}/test_image_001.jpg`,
            img,
            "image/jpeg"
        );

        const resp = await request.get(
            `${API_BASE}/files/download/gemini/${IMAGE_DIR}/test_image_001.jpg`
        );
        expect(resp.ok()).toBeTruthy();
        const body = await resp.body();
        expect(body.length).toBeGreaterThan(0);
    });
});

test.describe("GeoJSON boundary operations via API", () => {
    test.beforeAll(async ({ request }) => {
        const result = await seedExperimentEntities(request, FIELDS);
        experimentId = result.experimentId;
    });

    test.afterAll(async ({ request }) => {
        await cleanupMinIOPrefix(request, PROCESSED_PREFIX);
        if (experimentId) {
            await deleteExperiment(request, experimentId);
        }
    });

    test("upload and retrieve plot boundary GeoJSON", async ({ request }) => {
        const geojson = fs.readFileSync(
            path.join(__dirname, "fixtures", "geojson", "test-plot-boundaries.geojson"),
            "utf-8"
        );
        const geojsonPath = `${PROCESSED_PREFIX}/${FIELDS.date}/${FIELDS.platform}/${FIELDS.sensor}/Plot-Boundary-WGS84.geojson`;

        await seedFileToMinIO(request, geojsonPath, geojson, "application/geo+json");

        const resp = await request.get(
            `${API_BASE}/files/download/gemini/${geojsonPath}`
        );
        expect(resp.ok()).toBeTruthy();
        const body = await resp.json();
        expect(body.type).toBe("FeatureCollection");
        expect(body.features).toHaveLength(4);

        // Verify feature properties
        const plots = body.features.map((f) => f.properties.Plot);
        expect(plots).toEqual([1, 2, 3, 4]);

        const accessions = body.features.map((f) => f.properties.Label);
        expect(accessions).toContain("Accession-A");
        expect(accessions).toContain("Accession-B");
        expect(accessions).toContain("Accession-C");
    });

    test("GeoJSON features have valid geometries", async ({ request }) => {
        const geojson = fs.readFileSync(
            path.join(__dirname, "fixtures", "geojson", "test-plot-boundaries.geojson"),
            "utf-8"
        );
        const parsed = JSON.parse(geojson);

        for (const feature of parsed.features) {
            expect(feature.geometry.type).toBe("Polygon");
            expect(feature.geometry.coordinates).toHaveLength(1); // Single ring
            expect(feature.geometry.coordinates[0].length).toBeGreaterThanOrEqual(4); // Closed polygon
            // First and last point should be the same (closed ring)
            const ring = feature.geometry.coordinates[0];
            expect(ring[0]).toEqual(ring[ring.length - 1]);
        }
    });
});
