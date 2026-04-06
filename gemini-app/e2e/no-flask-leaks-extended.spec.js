const { test, expect } = require("@playwright/test");

/**
 * Extended no-Flask-leaks tests.
 * Verifies that navigating to ALL major tabs in framework mode
 * produces zero requests to the Flask backend.
 *
 * Prerequisites:
 *   - Framework backend running at port 7777
 *   - Frontend running at port 3000 with REACT_APP_BACKEND_MODE=framework
 *   - Flask backend NOT running (to catch any leaked calls)
 */

const FLASK_PATTERNS = [
    /localhost:5000/,
    /localhost:5050/,
    /flask_app/,
];

function isFlaskRequest(url) {
    return FLASK_PATTERNS.some((pattern) => pattern.test(url));
}

test.describe("No Flask leaks across all tabs", () => {
    test.setTimeout(30_000);

    test("app loads without any Flask requests", async ({ page }) => {
        const flaskRequests = [];
        page.on("request", (req) => {
            if (isFlaskRequest(req.url())) {
                flaskRequests.push(req.url());
            }
        });

        await page.goto("/");
        await page.waitForLoadState("networkidle");

        expect(flaskRequests).toEqual([]);
    });

    test("navigate to Upload tab — no Flask calls", async ({ page }) => {
        const flaskRequests = [];
        page.on("request", (req) => {
            if (isFlaskRequest(req.url())) {
                flaskRequests.push(req.url());
            }
        });

        await page.goto("/");
        await page.waitForLoadState("networkidle");

        // Click Prepare sidebar button
        const prepButton = page.locator('button:has(svg[data-testid="BuildIcon"])');
        if (await prepButton.count() > 0) {
            await prepButton.first().click();
            await page.waitForTimeout(1000);
        }

        expect(flaskRequests).toEqual([]);
    });

    test("navigate to Process tab — no Flask calls", async ({ page }) => {
        const flaskRequests = [];
        page.on("request", (req) => {
            if (isFlaskRequest(req.url())) {
                flaskRequests.push(req.url());
            }
        });

        await page.goto("/");
        await page.waitForLoadState("networkidle");

        // Close any sidebar overlay that may intercept clicks
        const hideButton = page.locator('text=Hide');
        if (await hideButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await hideButton.click();
            await page.waitForTimeout(500);
        }

        // Click Process sidebar button (force to avoid overlay issues)
        const processButton = page.locator('button:has(svg[data-testid="SettingsIcon"])');
        if (await processButton.count() > 0) {
            await processButton.first().click({ force: true });
            await page.waitForTimeout(1000);
        }

        expect(flaskRequests).toEqual([]);
    });

    test("navigate to Statistics/Manage tab — no Flask calls", async ({ page }) => {
        const flaskRequests = [];
        page.on("request", (req) => {
            if (isFlaskRequest(req.url())) {
                flaskRequests.push(req.url());
            }
        });

        await page.goto("/");
        await page.waitForLoadState("networkidle");

        // Close any sidebar overlay that may intercept clicks
        const hideButton = page.locator('text=Hide');
        if (await hideButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await hideButton.click();
            await page.waitForTimeout(500);
        }

        // Click Stats sidebar button (force to avoid overlay issues)
        const statsButton = page.locator('button:has(svg[data-testid="EqualizerIcon"]), button:has(svg[data-testid="BarChartIcon"])');
        if (await statsButton.count() > 0) {
            await statsButton.first().click({ force: true });
            await page.waitForTimeout(1000);
        }

        expect(flaskRequests).toEqual([]);
    });

    test("navigate to Image Query tab — no Flask calls", async ({ page }) => {
        const flaskRequests = [];
        page.on("request", (req) => {
            if (isFlaskRequest(req.url())) {
                flaskRequests.push(req.url());
            }
        });

        await page.goto("/");
        await page.waitForLoadState("networkidle");

        // Click Image Query sidebar button
        const imageButton = page.locator('button:has(svg[data-testid="ImageSearchIcon"]), button:has(svg[data-testid="ImageIcon"])');
        if (await imageButton.count() > 0) {
            await imageButton.first().click();
            await page.waitForTimeout(1000);
        }

        expect(flaskRequests).toEqual([]);
    });

    test("no console errors referencing Flask in framework mode", async ({ page }) => {
        const flaskErrors = [];
        page.on("console", (msg) => {
            if (msg.type() === "error" && isFlaskRequest(msg.text())) {
                flaskErrors.push(msg.text());
            }
        });

        await page.goto("/");
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(2000);

        expect(flaskErrors).toEqual([]);
    });
});
