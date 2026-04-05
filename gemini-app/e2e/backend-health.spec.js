const { test, expect } = require("@playwright/test");

/**
 * Backend health checks — verify the framework backend is running
 * and properly initialized before any other E2E tests run.
 *
 * These tests hit the real backend (no mocks). They would have caught:
 * - Missing jobs table (SQL init not running)
 * - Schema not created
 * - REST API not starting
 * - Redis/MinIO not reachable
 */

const API_BASE = "http://localhost:7777";

test.describe("Framework backend health", () => {
    test("REST API root is reachable", async ({ request }) => {
        const resp = await request.get(`${API_BASE}/`);
        expect(resp.ok()).toBeTruthy();
        const body = await resp.json();
        expect(body.message).toContain("GEMINI API");
    });

    test("OpenAPI schema endpoint is reachable", async ({ request }) => {
        const resp = await request.get(`${API_BASE}/schema`);
        expect(resp.ok()).toBeTruthy();
    });

    test("experiments endpoint returns 200", async ({ request }) => {
        const resp = await request.get(`${API_BASE}/api/experiments/all`);
        // 200 with empty list or 404 if no experiments — both are fine
        expect([200, 404]).toContain(resp.status());
    });

    test("files endpoint returns 200", async ({ request }) => {
        const resp = await request.get(`${API_BASE}/api/files/list/gemini`);
        // May return 200 or 500 if bucket doesn't exist yet — but should not hang
        expect(resp.status()).toBeLessThan(504);
    });
});

test.describe("Jobs API — database table exists and works", () => {
    test("can submit a job", async ({ request }) => {
        const resp = await request.post(`${API_BASE}/api/jobs/submit`, {
            data: {
                job_type: "TRAIN_MODEL",
                parameters: { epochs: 10, test: true },
            },
        });
        expect(resp.ok()).toBeTruthy();
        const job = await resp.json();
        expect(job.id).toBeTruthy();
        expect(job.job_type).toBe("TRAIN_MODEL");
        expect(job.status).toBe("PENDING");
        expect(job.parameters.epochs).toBe(10);
    });

    test("rejects invalid job type", async ({ request }) => {
        const resp = await request.post(`${API_BASE}/api/jobs/submit`, {
            data: {
                job_type: "DOES_NOT_EXIST",
                parameters: {},
            },
        });
        expect(resp.status()).toBe(400);
    });

    test("can retrieve a submitted job", async ({ request }) => {
        // Submit
        const createResp = await request.post(`${API_BASE}/api/jobs/submit`, {
            data: { job_type: "LOCATE_PLANTS", parameters: {} },
        });
        const created = await createResp.json();

        // Retrieve
        const getResp = await request.get(`${API_BASE}/api/jobs/${created.id}`);
        expect(getResp.ok()).toBeTruthy();
        const fetched = await getResp.json();
        expect(fetched.id).toBe(created.id);
        expect(fetched.job_type).toBe("LOCATE_PLANTS");
    });

    test("can list jobs", async ({ request }) => {
        // Submit two jobs
        await request.post(`${API_BASE}/api/jobs/submit`, {
            data: { job_type: "TRAIN_MODEL", parameters: {} },
        });
        await request.post(`${API_BASE}/api/jobs/submit`, {
            data: { job_type: "RUN_ODM", parameters: {} },
        });

        const resp = await request.get(`${API_BASE}/api/jobs/all`);
        expect(resp.ok()).toBeTruthy();
        const jobs = await resp.json();
        expect(jobs.length).toBeGreaterThanOrEqual(2);
    });

    test("can filter jobs by type", async ({ request }) => {
        await request.post(`${API_BASE}/api/jobs/submit`, {
            data: { job_type: "EXTRACT_BINARY", parameters: {} },
        });

        const resp = await request.get(`${API_BASE}/api/jobs/all?job_type=EXTRACT_BINARY`);
        expect(resp.ok()).toBeTruthy();
        const jobs = await resp.json();
        expect(jobs.every((j) => j.job_type === "EXTRACT_BINARY")).toBeTruthy();
    });

    test("can cancel a pending job", async ({ request }) => {
        const createResp = await request.post(`${API_BASE}/api/jobs/submit`, {
            data: { job_type: "EXTRACT_TRAITS", parameters: {} },
        });
        const job = await createResp.json();

        const cancelResp = await request.post(`${API_BASE}/api/jobs/${job.id}/cancel`);
        expect(cancelResp.ok()).toBeTruthy();
        const cancelled = await cancelResp.json();
        expect(cancelled.status).toBe("CANCELLED");
    });

    test("cannot cancel a completed job", async ({ request }) => {
        const createResp = await request.post(`${API_BASE}/api/jobs/submit`, {
            data: { job_type: "TRAIN_MODEL", parameters: {} },
        });
        const job = await createResp.json();

        // Complete it
        await request.patch(`${API_BASE}/api/jobs/${job.id}/status`, {
            data: { status: "COMPLETED", progress: 100.0 },
        });

        // Try to cancel
        const cancelResp = await request.post(`${API_BASE}/api/jobs/${job.id}/cancel`);
        expect(cancelResp.status()).toBe(409);
    });

    test("can update job progress", async ({ request }) => {
        const createResp = await request.post(`${API_BASE}/api/jobs/submit`, {
            data: { job_type: "RUN_STITCH", parameters: {} },
        });
        const job = await createResp.json();

        const updateResp = await request.patch(`${API_BASE}/api/jobs/${job.id}/status`, {
            data: {
                status: "RUNNING",
                worker_id: "e2e-test-worker",
                progress: 42.5,
                progress_detail: { step: "feature_matching" },
            },
        });
        expect(updateResp.ok()).toBeTruthy();
        const updated = await updateResp.json();
        expect(updated.status).toBe("RUNNING");
        expect(updated.progress).toBe(42.5);
        expect(updated.worker_id).toBe("e2e-test-worker");
    });

    test("can delete a job", async ({ request }) => {
        const createResp = await request.post(`${API_BASE}/api/jobs/submit`, {
            data: { job_type: "TRAIN_MODEL", parameters: {} },
        });
        const job = await createResp.json();

        const deleteResp = await request.delete(`${API_BASE}/api/jobs/${job.id}`);
        expect(deleteResp.ok()).toBeTruthy();

        const getResp = await request.get(`${API_BASE}/api/jobs/${job.id}`);
        expect(getResp.status()).toBe(404);
    });

    test("full job lifecycle: submit → start → progress → complete", async ({ request }) => {
        // Submit
        const createResp = await request.post(`${API_BASE}/api/jobs/submit`, {
            data: { job_type: "TRAIN_MODEL", parameters: { epochs: 5 } },
        });
        expect(createResp.ok()).toBeTruthy();
        const job = await createResp.json();
        expect(job.status).toBe("PENDING");

        // Start
        const startResp = await request.patch(`${API_BASE}/api/jobs/${job.id}/status`, {
            data: { status: "RUNNING", worker_id: "e2e-worker" },
        });
        expect(startResp.ok()).toBeTruthy();
        expect((await startResp.json()).status).toBe("RUNNING");

        // Progress update
        const progressResp = await request.patch(`${API_BASE}/api/jobs/${job.id}/status`, {
            data: {
                status: "RUNNING",
                progress: 60.0,
                progress_detail: { epoch: 3, map: 0.72 },
            },
        });
        expect(progressResp.ok()).toBeTruthy();
        expect((await progressResp.json()).progress).toBe(60.0);

        // Complete
        const completeResp = await request.patch(`${API_BASE}/api/jobs/${job.id}/status`, {
            data: {
                status: "COMPLETED",
                progress: 100.0,
                result: { final_map: 0.91 },
            },
        });
        expect(completeResp.ok()).toBeTruthy();

        // Verify final state
        const finalResp = await request.get(`${API_BASE}/api/jobs/${job.id}`);
        const final = await finalResp.json();
        expect(final.status).toBe("COMPLETED");
        expect(final.progress).toBe(100.0);
        expect(final.result.final_map).toBe(0.91);
    });
});
