const { test, expect } = require("@playwright/test");

test.describe("Sidebar navigation", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/");
        // Wait for the app to fully load
        await expect(page.locator("#root")).not.toBeEmpty();
    });

    test("can expand the Prepare section and navigate to upload files", async ({ page }) => {
        // Click the Prepare section header
        const prepareButton = page.locator("[aria-label='prepare']");
        await expect(prepareButton).toBeVisible({ timeout: 15_000 });
        await prepareButton.click();

        // Upload files subtab should become visible
        const uploadButton = page.locator("[aria-label='upload-files']");
        await expect(uploadButton).toBeVisible();
        await uploadButton.click();
    });

    test("can expand the View Data section and navigate to map", async ({ page }) => {
        const viewDataButton = page.locator("[aria-label='view-data']");
        await expect(viewDataButton).toBeVisible({ timeout: 15_000 });
        await viewDataButton.click();

        const mapButton = page.locator("[aria-label='map']");
        await expect(mapButton).toBeVisible();
        await mapButton.click();
    });

    test("can expand the View Data section and navigate to stats", async ({ page }) => {
        const viewDataButton = page.locator("[aria-label='view-data']");
        await expect(viewDataButton).toBeVisible({ timeout: 15_000 });
        await viewDataButton.click();

        const statsButton = page.locator("[aria-label='stats']");
        await expect(statsButton).toBeVisible();
        await statsButton.click();
    });

    test("can expand the View Data section and navigate to query", async ({ page }) => {
        const viewDataButton = page.locator("[aria-label='view-data']");
        await expect(viewDataButton).toBeVisible({ timeout: 15_000 });
        await viewDataButton.click();

        const queryButton = page.locator("[aria-label='query']");
        await expect(queryButton).toBeVisible();
        await queryButton.click();
    });

    test("can expand the Process section", async ({ page }) => {
        const processButton = page.locator("[aria-label='process']");
        await expect(processButton).toBeVisible({ timeout: 15_000 });
        await processButton.click();

        // Process subtabs should become visible
        const mosaicButton = page.locator("[aria-label='mosaic-generation']");
        await expect(mosaicButton).toBeVisible();
    });

    test("sidebar can be collapsed and expanded", async ({ page }) => {
        // The close-sidebar button should be present when sidebar is open
        const closeButton = page.locator("[aria-label='close-sidebar']");
        const openButton = page.locator("[aria-label='open-sidebar']");

        // Initially sidebar is expanded — close button should be visible
        // or sidebar might start collapsed depending on state
        // Check which state we're in and toggle
        if (await closeButton.isVisible()) {
            await closeButton.click();
            await expect(openButton).toBeVisible();
            await openButton.click();
            await expect(closeButton).toBeVisible();
        } else {
            await expect(openButton).toBeVisible({ timeout: 15_000 });
            await openButton.click();
            await expect(closeButton).toBeVisible();
        }
    });
});
