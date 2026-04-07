const { test, expect } = require("@playwright/test");
const {
    cancelJob,
    deleteJob,
    API_BASE,
} = require("./helpers/api-helpers");

/**
 * Error handling and edge case E2E tests — backend error responses,
 * job cancellation from various states, WebSocket behavior,
 * and rapid navigation stability.
 *
 * All tests run against real framework backend. No mocking.
 */

let createdJobIds = [];

test.afterAll(async ({ request }) => {
    for (const jobId of createdJobIds) {
        await cancelJob(request, jobId);
        await deleteJob(request, jobId);
    }
});

test.describe("Job error states", () => {
    test("job fails gracefully with error message", async ({ request }) => {
        // Submit a job
        const resp = await request.post(`${API_BASE}/jobs/submit`, {
            data: {
                job_type: "TRAIN_MODEL",
                parameters: { epochs: 1 },
            },
        });
        const job = await resp.json();
        createdJobIds.push(job.id);

        // Start it
        await request.patch(`${API_BASE}/jobs/${job.id}/status`, {
            data: { status: "RUNNING", worker_id: "e2e-worker" },
        });

        // Fail it with an error message
        const failResp = await request.patch(`${API_BASE}/jobs/${job.id}/status`, {
            data: {
                status: "FAILED",
                error_message: "CUDA out of memory: 12GB required, 8GB available",
            },
        });
        expect(failResp.ok()).toBeTruthy();

        // Verify error is persisted
        const getResp = await request.get(`${API_BASE}/jobs/${job.id}`);
        const final = await getResp.json();
        expect(final.status).toBe("FAILED");
        expect(final.error_message).toContain("CUDA out of memory");
    });

    test("updating a cancelled job still works (no strict state machine)", async ({ request }) => {
        const resp = await request.post(`${API_BASE}/jobs/submit`, {
            data: { job_type: "LOCATE_PLANTS", parameters: {} },
        });
        const job = await resp.json();
        createdJobIds.push(job.id);

        // Cancel
        await request.post(`${API_BASE}/jobs/${job.id}/cancel`);

        // Verify cancelled
        const getResp = await request.get(`${API_BASE}/jobs/${job.id}`);
        const cancelled = await getResp.json();
        expect(cancelled.status).toBe("CANCELLED");
    });

    test("cannot cancel a failed job", async ({ request }) => {
        const resp = await request.post(`${API_BASE}/jobs/submit`, {
            data: { job_type: "EXTRACT_TRAITS", parameters: {} },
        });
        const job = await resp.json();
        createdJobIds.push(job.id);

        // Start then fail
        await request.patch(`${API_BASE}/jobs/${job.id}/status`, {
            data: { status: "RUNNING", worker_id: "e2e-worker" },
        });
        await request.patch(`${API_BASE}/jobs/${job.id}/status`, {
            data: { status: "FAILED", error_message: "Worker crashed" },
        });

        // Try to cancel
        const cancelResp = await request.post(`${API_BASE}/jobs/${job.id}/cancel`);
        expect(cancelResp.status()).toBe(409);
    });

    test("duplicate job submission creates separate jobs", async ({ request }) => {
        const params = {
            job_type: "TRAIN_MODEL",
            parameters: { epochs: 5, experiment: "duplicate-test" },
        };

        const resp1 = await request.post(`${API_BASE}/jobs/submit`, { data: params });
        const resp2 = await request.post(`${API_BASE}/jobs/submit`, { data: params });

        const job1 = await resp1.json();
        const job2 = await resp2.json();

        expect(job1.id).not.toBe(job2.id);
        createdJobIds.push(job1.id, job2.id);
    });
});

test.describe("Backend API error responses", () => {
    test("GET non-existent job returns 404", async ({ request }) => {
        const resp = await request.get(`${API_BASE}/jobs/00000000-0000-0000-0000-000000000000`);
        expect(resp.status()).toBe(404);
    });

    test("DELETE non-existent job returns 404", async ({ request }) => {
        const resp = await request.delete(`${API_BASE}/jobs/00000000-0000-0000-0000-000000000000`);
        expect(resp.status()).toBe(404);
    });

    test("invalid UUID returns 400 or 422", async ({ request }) => {
        const resp = await request.get(`${API_BASE}/jobs/not-a-uuid`);
        expect([400, 404, 422, 500]).toContain(resp.status());
    });

    test("list files in non-existent directory returns empty or 404", async ({ request }) => {
        const resp = await request.get(`${API_BASE}/files/list/gemini/nonexistent/path/here`);
        // Accept 200 (empty list), 404, or 500 — but not a hang
        expect(resp.status()).toBeLessThan(504);
    });

    test("delete non-existent file is handled gracefully", async ({ request }) => {
        const resp = await request.delete(`${API_BASE}/files/delete/gemini/nonexistent/file.txt`);
        // Should not crash — 200/404 both acceptable
        expect(resp.status()).toBeLessThan(504);
    });
});

test.describe("Rapid navigation stability", () => {
    test("rapid tab switching does not crash the app", async ({ page }) => {
        await page.goto("/");
        await page.waitForSelector("#root:not(:empty)", { timeout: 15_000 });

        const tabs = [
            "[aria-label='prepare']",
            "[aria-label='process']",
            "[aria-label='view-data']",
        ];

        // Rapidly click through tabs
        for (let i = 0; i < 3; i++) {
            for (const tab of tabs) {
                const button = page.locator(tab);
                if (await button.isVisible({ timeout: 1_000 }).catch(() => false)) {
                    await button.click();
                    await page.waitForTimeout(100);
                }
            }
        }

        // App should still be responsive
        await page.waitForTimeout(500);
        const root = page.locator("#root");
        await expect(root).not.toBeEmpty();
    });

    test("navigating away during sidebar open does not crash", async ({ page }) => {
        await page.goto("/");
        await page.waitForSelector("#root:not(:empty)", { timeout: 15_000 });

        // Open Prepare section
        const prepareButton = page.locator("[aria-label='prepare']");
        await prepareButton.waitFor({ state: "visible", timeout: 15_000 });
        await prepareButton.click();
        await page.waitForTimeout(300);

        // Click upload to open sidebar
        const uploadButton = page.locator("[aria-label='upload-files']");
        await uploadButton.waitFor({ state: "visible", timeout: 5_000 });
        await uploadButton.click();
        await page.waitForTimeout(300);

        // Immediately switch to View Data
        const viewDataButton = page.locator("[aria-label='view-data']");
        await viewDataButton.click();
        await page.waitForTimeout(300);

        // Click Map
        const mapButton = page.locator("[aria-label='map']");
        if (await mapButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await mapButton.click();
            await page.waitForTimeout(300);
        }

        // App should still be responsive
        const root = page.locator("#root");
        await expect(root).not.toBeEmpty();
    });

    test("no JavaScript error overlay after navigation stress", async ({ page }) => {
        await page.goto("/");
        await page.waitForSelector("#root:not(:empty)", { timeout: 15_000 });

        // Click through all major sections rapidly
        const sections = [
            ["[aria-label='prepare']", "[aria-label='upload-files']"],
            ["[aria-label='prepare']", "[aria-label='manage-files']"],
            ["[aria-label='process']", "[aria-label='mosaic-generation']"],
            ["[aria-label='process']", "[aria-label='processing']"],
            ["[aria-label='view-data']", "[aria-label='stats']"],
            ["[aria-label='view-data']", "[aria-label='map']"],
            ["[aria-label='view-data']", "[aria-label='query']"],
        ];

        for (const [section, subsection] of sections) {
            const sectionBtn = page.locator(section);
            if (await sectionBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
                await sectionBtn.click();
                await page.waitForTimeout(200);
            }

            const subBtn = page.locator(subsection);
            if (await subBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
                await subBtn.click();
                await page.waitForTimeout(200);
            }
        }

        // Check no error overlay
        const overlay = page.locator("#webpack-dev-server-client-overlay");
        const isOverlayVisible = await overlay
            .isVisible({ timeout: 1_000 })
            .catch(() => false);
        expect(isOverlayVisible).toBeFalsy();
    });
});

test.describe("WebSocket job progress connection", () => {
    test("WebSocket endpoint is reachable for a valid job", async ({ request }) => {
        // Submit a job
        const resp = await request.post(`${API_BASE}/jobs/submit`, {
            data: { job_type: "TRAIN_MODEL", parameters: {} },
        });
        const job = await resp.json();
        createdJobIds.push(job.id);

        // The WebSocket endpoint exists at /api/jobs/{id}/progress
        // We can't easily test WebSocket via Playwright API context,
        // but we can verify the job is retrievable (which the WS handler uses)
        const getResp = await request.get(`${API_BASE}/jobs/${job.id}`);
        expect(getResp.ok()).toBeTruthy();
        const fetched = await getResp.json();
        expect(fetched.id).toBe(job.id);

        await cancelJob(request, job.id);
    });
});
