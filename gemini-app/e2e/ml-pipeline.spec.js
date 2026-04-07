const { test, expect } = require("@playwright/test");
const { seedFileToMinIO } = require("./helpers/manage-helpers");
const {
    deleteFromMinIO,
    cleanupMinIOPrefix,
    deleteExperiment,
    getExperimentByName,
    cancelJob,
    deleteJob,
    API_BASE,
} = require("./helpers/api-helpers");
const {
    navigateToProcessingAndInitiatePrep,
    seedExperimentEntities,
} = require("./helpers/prep-helpers");
const path = require("path");
const fs = require("fs");

/**
 * ML Pipeline E2E tests — processing stepper, job submission/cancellation,
 * model info display, and Roboflow inference UI.
 *
 * All tests run against real framework backend. No mocking.
 */

const TEST_RUN_ID = `E2E-ML-${Date.now()}`;
const FIELDS = {
    experiment: TEST_RUN_ID,
    year: "2024",
    location: "Davis",
    population: "TestPop",
    platform: "Rover",
    sensor: "RGB-Cam",
    date: "2024-07-15",
};

const MODEL_PREFIX = `models/${FIELDS.year}/${FIELDS.experiment}`;
const PROCESSED_PREFIX = `Processed/${FIELDS.year}/${FIELDS.experiment}/${FIELDS.location}/${FIELDS.population}`;

let experimentId;
let createdJobIds = [];

test.describe("Processing pipeline navigation", () => {
    test.beforeAll(async ({ request }) => {
        // Seed experiment entities so the selection menu works
        const result = await seedExperimentEntities(request, FIELDS);
        experimentId = result.experimentId;
    });

    test.afterAll(async ({ request }) => {
        // Clean up jobs
        for (const jobId of createdJobIds) {
            await cancelJob(request, jobId);
            await deleteJob(request, jobId);
        }
        // Clean up MinIO
        await cleanupMinIOPrefix(request, MODEL_PREFIX);
        await cleanupMinIOPrefix(request, PROCESSED_PREFIX);
        // Clean up experiment
        if (experimentId) {
            await deleteExperiment(request, experimentId);
        }
    });

    test("processing stepper renders with three steps", async ({ page }) => {
        await navigateToProcessingAndInitiatePrep(page, FIELDS);

        // Verify stepper steps
        await expect(page.locator("text=Select").first()).toBeVisible();
        await expect(page.locator("text=Tune").first()).toBeVisible();
        await expect(page.locator("text=Predict").first()).toBeVisible();
    });

    test("LabelStep renders with Roboflow instructions", async ({ page }) => {
        await navigateToProcessingAndInitiatePrep(page, FIELDS);

        // Step 0 (Select) should show LabelStep by default
        await expect(page.locator("text=Select Model")).toBeVisible({ timeout: 10_000 });
        await expect(page.locator("text=Method 1: Label and Train Custom Model")).toBeVisible();
        await expect(page.locator("text=Method 2: Use Pretrained Model")).toBeVisible();
        await expect(page.locator('a[href="https://app.roboflow.com"]')).toBeVisible();
        await expect(page.locator('a[href="https://universe.roboflow.com"]')).toBeVisible();
    });

    test("TrainStep renders with future implementation notice", async ({ page }) => {
        await navigateToProcessingAndInitiatePrep(page, FIELDS);

        // Navigate to step 1 (Tune)
        await page.locator(".MuiStep-root").nth(1).click();
        await page.waitForTimeout(300);

        await expect(page.locator("text=Tune Extraction")).toBeVisible({ timeout: 5_000 });
        await expect(page.locator("text=Future Implementation")).toBeVisible();
    });

    test("PredictStep renders with Roboflow configuration form", async ({ page }) => {
        await navigateToProcessingAndInitiatePrep(page, FIELDS);

        // Navigate to step 2 (Predict)
        await page.locator(".MuiStep-root").nth(2).click();
        await page.waitForTimeout(500);

        await expect(page.locator("text=Trait Extraction").first()).toBeVisible({ timeout: 10_000 });

        // Check Roboflow form fields exist
        await expect(page.locator("text=Inference Mode").first()).toBeVisible();
        await expect(page.locator('input[type="password"]').first()).toBeVisible(); // API Key
    });

    test("stepper navigation cycles through all steps", async ({ page }) => {
        await navigateToProcessingAndInitiatePrep(page, FIELDS);

        // Start at Select (step 0)
        await expect(page.locator("text=Select Model")).toBeVisible({ timeout: 10_000 });

        // Click Tune (step 1)
        await page.locator(".MuiStep-root").nth(1).click();
        await page.waitForTimeout(300);
        await expect(page.locator("text=Tune Extraction")).toBeVisible();

        // Click Predict (step 2)
        await page.locator(".MuiStep-root").nth(2).click();
        await page.waitForTimeout(300);
        await expect(page.locator("text=Trait Extraction").first()).toBeVisible();

        // Click back to Select (step 0)
        await page.locator(".MuiStep-root").nth(0).click();
        await page.waitForTimeout(300);
        await expect(page.locator("text=Select Model")).toBeVisible();
    });
});

test.describe("Roboflow inference form validation", () => {
    test.beforeAll(async ({ request }) => {
        const result = await seedExperimentEntities(request, FIELDS);
        experimentId = result.experimentId;
    });

    test.afterAll(async ({ request }) => {
        for (const jobId of createdJobIds) {
            await cancelJob(request, jobId);
            await deleteJob(request, jobId);
        }
        if (experimentId) {
            await deleteExperiment(request, experimentId);
        }
    });

    test("Run Inference button is disabled until required fields are filled", async ({ page }) => {
        await navigateToProcessingAndInitiatePrep(page, FIELDS);
        await page.locator(".MuiStep-root").nth(2).click();
        await page.waitForTimeout(500);

        // Button should be disabled initially (no API key or model ID)
        const runButton = page.locator("button:has-text('Run Inference')");
        await expect(runButton).toBeVisible({ timeout: 10_000 });
        await expect(runButton).toBeDisabled();
    });

    test("API key field toggles visibility", async ({ page }) => {
        await navigateToProcessingAndInitiatePrep(page, FIELDS);
        await page.locator(".MuiStep-root").nth(2).click();
        await page.waitForTimeout(500);

        const passwordField = page.locator('input[type="password"]').first();
        await expect(passwordField).toBeVisible({ timeout: 10_000 });

        // Type a value
        await passwordField.fill("test-api-key");

        // Toggle visibility
        const toggleButton = page.locator('button[aria-label="toggle password visibility"]');
        await toggleButton.click();
        await page.waitForTimeout(200);

        // Now the input should be type="text"
        const textField = page.locator('input[value="test-api-key"]');
        await expect(textField).toBeVisible();
    });
});

test.describe("Job submission via API (processing smoke tests)", () => {
    test("submit TRAIN_MODEL job and cancel it", async ({ request }) => {
        const resp = await request.post(`${API_BASE}/jobs/submit`, {
            data: {
                job_type: "TRAIN_MODEL",
                parameters: {
                    epochs: 1,
                    batch_size: 1,
                    image_size: 64,
                    year: FIELDS.year,
                    experiment: FIELDS.experiment,
                    location: FIELDS.location,
                    population: FIELDS.population,
                },
            },
        });
        expect(resp.ok()).toBeTruthy();
        const job = await resp.json();
        expect(job.id).toBeTruthy();
        expect(job.job_type).toBe("TRAIN_MODEL");
        expect(job.status).toBe("PENDING");
        expect(job.parameters.epochs).toBe(1);
        createdJobIds.push(job.id);

        // Cancel it
        const cancelResp = await request.post(`${API_BASE}/jobs/${job.id}/cancel`);
        expect(cancelResp.ok()).toBeTruthy();
        const cancelled = await cancelResp.json();
        expect(cancelled.status).toBe("CANCELLED");
    });

    test("submit LOCATE_PLANTS job and cancel it", async ({ request }) => {
        const resp = await request.post(`${API_BASE}/jobs/submit`, {
            data: {
                job_type: "LOCATE_PLANTS",
                parameters: {
                    batch_size: 32,
                    year: FIELDS.year,
                    experiment: FIELDS.experiment,
                    location: FIELDS.location,
                    population: FIELDS.population,
                },
            },
        });
        expect(resp.ok()).toBeTruthy();
        const job = await resp.json();
        expect(job.job_type).toBe("LOCATE_PLANTS");
        expect(job.status).toBe("PENDING");
        createdJobIds.push(job.id);

        await request.post(`${API_BASE}/jobs/${job.id}/cancel`);
    });

    test("submit EXTRACT_TRAITS job and cancel it", async ({ request }) => {
        const resp = await request.post(`${API_BASE}/jobs/submit`, {
            data: {
                job_type: "EXTRACT_TRAITS",
                parameters: {
                    batch_size: 32,
                    year: FIELDS.year,
                    experiment: FIELDS.experiment,
                    location: FIELDS.location,
                    population: FIELDS.population,
                },
            },
        });
        expect(resp.ok()).toBeTruthy();
        const job = await resp.json();
        expect(job.job_type).toBe("EXTRACT_TRAITS");
        expect(job.status).toBe("PENDING");
        createdJobIds.push(job.id);

        await request.post(`${API_BASE}/jobs/${job.id}/cancel`);
    });

    test("simulate full training lifecycle via API", async ({ request }) => {
        // Submit
        const createResp = await request.post(`${API_BASE}/jobs/submit`, {
            data: {
                job_type: "TRAIN_MODEL",
                parameters: { epochs: 3, batch_size: 1, image_size: 64 },
            },
        });
        const job = await createResp.json();
        createdJobIds.push(job.id);

        // Start
        await request.patch(`${API_BASE}/jobs/${job.id}/status`, {
            data: { status: "RUNNING", worker_id: "e2e-ml-worker" },
        });

        // Progress updates (simulating epochs)
        for (let epoch = 1; epoch <= 3; epoch++) {
            const progressResp = await request.patch(`${API_BASE}/jobs/${job.id}/status`, {
                data: {
                    status: "RUNNING",
                    progress: (epoch / 3) * 100,
                    progress_detail: {
                        epoch,
                        total_epochs: 3,
                        box_loss: 0.05 - epoch * 0.01,
                        map: 0.5 + epoch * 0.1,
                    },
                },
            });
            expect(progressResp.ok()).toBeTruthy();
        }

        // Complete
        const completeResp = await request.patch(`${API_BASE}/jobs/${job.id}/status`, {
            data: {
                status: "COMPLETED",
                progress: 100.0,
                result: { best_map: 0.89, model_path: "models/best.pt" },
            },
        });
        expect(completeResp.ok()).toBeTruthy();

        // Verify final state
        const finalResp = await request.get(`${API_BASE}/jobs/${job.id}`);
        const final = await finalResp.json();
        expect(final.status).toBe("COMPLETED");
        expect(final.progress).toBe(100.0);
        expect(final.result.best_map).toBe(0.89);
        expect(final.progress_detail.epoch).toBe(3);
    });
});

test.describe("Model info seeding and retrieval", () => {
    test("seed model files to MinIO and list them", async ({ request }) => {
        const modelDir = `${MODEL_PREFIX}/weights`;
        const logsContent = fs.readFileSync(
            path.join(__dirname, "fixtures", "models", "logs.yaml")
        );
        const bestPt = fs.readFileSync(
            path.join(__dirname, "fixtures", "models", "best.pt")
        );

        // Seed model files
        await seedFileToMinIO(request, `${modelDir}/best.pt`, bestPt, "application/octet-stream");
        await seedFileToMinIO(request, `${modelDir}/logs.yaml`, logsContent, "text/yaml");

        // Verify they exist
        const listResp = await request.get(`${API_BASE}/files/list/gemini/${modelDir}`);
        if (listResp.ok()) {
            const files = await listResp.json();
            const fileNames = Array.isArray(files)
                ? files.map((f) => (typeof f === "string" ? f : f.object_name || f.name || ""))
                : [];
            expect(fileNames.some((f) => f.includes("best.pt"))).toBeTruthy();
            expect(fileNames.some((f) => f.includes("logs.yaml"))).toBeTruthy();
        }

        // Clean up
        await cleanupMinIOPrefix(request, MODEL_PREFIX);
    });
});
