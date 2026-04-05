const { test, expect } = require("@playwright/test");

/**
 * Verify the frontend is running in framework mode and making
 * requests to the framework backend (port 7777), not Flask (port 5050).
 *
 * These tests catch:
 * - Frontend still calling Flask endpoints
 * - BACKEND_MODE not being set correctly
 * - Components not respecting the backend mode switch
 */

test.describe("Frontend uses framework backend", () => {
    test("no requests to Flask port on initial load", async ({ page }) => {
        const flaskRequests = [];
        page.on("request", (req) => {
            const url = req.url();
            if (url.includes(":5050") || url.includes(":5000") || url.includes("flask_app")) {
                flaskRequests.push(url);
            }
        });

        await page.goto("/");
        await page.waitForTimeout(5000); // Wait for any startup requests

        expect(flaskRequests).toEqual([]);
    });

    test("no requests to Flask port when navigating to upload", async ({ page }) => {
        const flaskRequests = [];
        page.on("request", (req) => {
            const url = req.url();
            if (url.includes(":5050") || url.includes(":5000") || url.includes("flask_app")) {
                flaskRequests.push(url);
            }
        });

        await page.goto("/");
        await expect(page.locator("#root")).not.toBeEmpty();

        // Navigate to upload
        const prepareButton = page.locator("[aria-label='prepare']");
        await expect(prepareButton).toBeVisible({ timeout: 15_000 });
        await prepareButton.click();

        const uploadButton = page.locator("[aria-label='upload-files']");
        await expect(uploadButton).toBeVisible();
        await uploadButton.click();

        await page.waitForTimeout(3000); // Wait for component to load and make requests

        expect(flaskRequests).toEqual([]);
    });

    test("no requests to Flask port when navigating to processing", async ({ page }) => {
        const flaskRequests = [];
        page.on("request", (req) => {
            const url = req.url();
            if (url.includes(":5050") || url.includes(":5000") || url.includes("flask_app")) {
                flaskRequests.push(url);
            }
        });

        await page.goto("/");
        await expect(page.locator("#root")).not.toBeEmpty();

        // Navigate to process section
        const processButton = page.locator("[aria-label='process']");
        await expect(processButton).toBeVisible({ timeout: 15_000 });
        await processButton.click();

        await page.waitForTimeout(3000);

        expect(flaskRequests).toEqual([]);
    });

    test("no console errors about connection refused on startup", async ({ page }) => {
        const connectionErrors = [];
        page.on("pageerror", (error) => {
            if (error.message.includes("connection") || error.message.includes("connect")) {
                connectionErrors.push(error.message);
            }
        });
        page.on("requestfailed", (req) => {
            connectionErrors.push(`Request failed: ${req.url()}`);
        });

        await page.goto("/");
        await page.waitForTimeout(5000);

        // Filter out known benign failures (e.g., external fonts, extensions)
        const realErrors = connectionErrors.filter(
            (e) => !e.includes("fonts.g") && !e.includes("chrome-extension") && !e.includes("gemini-breeding.github.io")
        );
        expect(realErrors).toEqual([]);
    });
});
