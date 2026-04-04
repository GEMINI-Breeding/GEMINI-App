const { test, expect } = require("@playwright/test");

test.describe("App startup", () => {
    test("renders without crashing", async ({ page }) => {
        await page.goto("/");

        // The page should not show a blank white screen or error
        // Wait for React to mount — the root div should have children
        await expect(page.locator("#root")).not.toBeEmpty();
    });

    test("displays the sidebar navigation icons", async ({ page }) => {
        await page.goto("/");

        // The sidebar uses a MUI docked drawer (visibility:hidden in DOM)
        // but the navigation icons are rendered and visible
        const prepareButton = page.locator("[aria-label='prepare']");
        await expect(prepareButton).toBeVisible({ timeout: 15_000 });
    });

    test("displays the settings button", async ({ page }) => {
        await page.goto("/");

        // App.js renders a floating settings gear icon (SettingsIcon)
        const settingsButton = page.locator("button").filter({ has: page.locator("[data-testid='SettingsIcon']") });
        await expect(settingsButton).toBeVisible({ timeout: 15_000 });
    });

    test("does not show a JavaScript error overlay", async ({ page }) => {
        await page.goto("/");

        // CRA shows an error overlay div when there's an unhandled error
        const errorOverlay = page.locator("#webpack-dev-server-client-overlay");
        // Either the overlay doesn't exist or it's not visible
        await expect(errorOverlay).toHaveCount(0).catch(async () => {
            await expect(errorOverlay).not.toBeVisible();
        });
    });
});
