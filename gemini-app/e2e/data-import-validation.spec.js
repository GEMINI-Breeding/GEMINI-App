const { test, expect } = require("@playwright/test");
const {
    navigateToUpload,
    selectDataType,
    fillFormFields,
    dropFiles,
    submitUpload,
    clearFiles,
    fixturePath,
} = require("./helpers/upload-helpers");

/**
 * E2E validation tests for the data import form.
 *
 * These tests verify form validation, data type switching, and UI behavior
 * without necessarily completing uploads. They run against the real frontend
 * with the real framework backend — no mocking.
 */

test.describe("Upload form validation", () => {
    test.beforeEach(async ({ page }) => {
        await navigateToUpload(page);
    });

    test("shows validation errors when required fields are empty", async ({
        page,
    }) => {
        // Orthomosaics has the most fields (7), good for testing all validations
        await selectDataType(page, "Orthomosaics");

        // Drop a file so the upload button doesn't just skip
        await dropFiles(page, [fixturePath("ortho", "test-RGB.tif")]);

        // Submit without filling any fields
        await submitUpload(page);

        // Each required field should show "This field is required"
        // Autocomplete fields show errors via #autocomplete-{field}-helper-text
        const autocompleteFields = [
            "year",
            "experiment",
            "location",
            "population",
            "platform",
            "sensor",
        ];
        for (const field of autocompleteFields) {
            const errorText = page.locator(
                `#autocomplete-${field}-helper-text:has-text("This field is required")`
            );
            await expect(errorText).toBeVisible({ timeout: 5_000 });
        }
        // Date field defaults to today — it should NOT show a validation error
        const dateInput = page.locator("input[type='date']");
        await expect(dateInput).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
    });

    test("shows validation errors for partial field entry", async ({
        page,
    }) => {
        await selectDataType(page, "Orthomosaics");
        await dropFiles(page, [fixturePath("ortho", "test-RGB.tif")]);

        // Fill only year and experiment
        await fillFormFields(page, { year: "2024", experiment: "TestExp" });
        await submitUpload(page);

        // The unfilled Autocomplete fields should show errors
        const missingAutocompleteFields = [
            "location",
            "population",
            "platform",
            "sensor",
        ];
        for (const field of missingAutocompleteFields) {
            const errorText = page.locator(
                `#autocomplete-${field}-helper-text:has-text("This field is required")`
            );
            await expect(errorText).toBeVisible({ timeout: 5_000 });
        }
        // Date field is a date picker — verify it's present
        await expect(page.locator("input[type='date']")).toBeVisible();

        // Filled fields should NOT show errors
        const filledFields = ["year", "experiment"];
        for (const field of filledFields) {
            const errorText = page.locator(
                `#autocomplete-${field}-helper-text:has-text("This field is required")`
            );
            await expect(errorText).not.toBeVisible();
        }
    });
});

test.describe("Data type switching", () => {
    test.beforeEach(async ({ page }) => {
        await navigateToUpload(page);
    });

    test("form fields update when switching data types", async ({ page }) => {
        // Start with Image Data (7 fields)
        await selectDataType(page, "Image Data");
        await expect(page.locator("#autocomplete-year")).toBeVisible();
        await expect(page.locator("#autocomplete-platform")).toBeVisible();
        await expect(page.locator("#autocomplete-sensor")).toBeVisible();
        await expect(page.locator("input[type='date']")).toBeVisible();

        // Switch to GCP Locations (4 fields — no date, platform, sensor)
        await selectDataType(page, "GCP Locations");
        await expect(page.locator("#autocomplete-year")).toBeVisible();
        await expect(page.locator("#autocomplete-experiment")).toBeVisible();
        await expect(page.locator("#autocomplete-location")).toBeVisible();
        await expect(page.locator("#autocomplete-population")).toBeVisible();
        await expect(page.locator("input[type='date']")).not.toBeVisible();
        await expect(page.locator("#autocomplete-platform")).not.toBeVisible();
        await expect(page.locator("#autocomplete-sensor")).not.toBeVisible();

        // Switch to Amiga File (5 fields — no platform, sensor)
        await selectDataType(page, "Amiga File");
        await expect(page.locator("#autocomplete-year")).toBeVisible();
        await expect(page.locator("input[type='date']")).toBeVisible();
        await expect(page.locator("#autocomplete-platform")).not.toBeVisible();
        await expect(page.locator("#autocomplete-sensor")).not.toBeVisible();
    });

    test("data type dropdown shows all 6 types", async ({ page }) => {
        // Open the dropdown
        const selectControl = page.locator(".MuiSelect-select").first();
        await selectControl.click();

        // Verify all 6 data type labels are present
        const expectedLabels = [
            "Image Data",
            "Amiga File",
            "Weather Data",
            "GCP Locations",
            "Platform Logs",
            "Orthomosaics",
        ];
        for (const label of expectedLabels) {
            await expect(
                page.locator(`li[role="option"]:has-text("${label}")`)
            ).toBeVisible();
        }
    });
});

test.describe("File management in dropzone", () => {
    test.beforeEach(async ({ page }) => {
        await navigateToUpload(page);
    });

    test("can clear selected files before uploading", async ({ page }) => {
        // Select Amiga File type (accepts .bin)
        await selectDataType(page, "Amiga File");

        // Drop a file
        await dropFiles(page, [
            fixturePath("binary", "test_amiga.0000.bin"),
        ]);

        // File name should appear in dropzone
        await expect(
            page.locator("text=test_amiga.0000.bin")
        ).toBeVisible();

        // Click Clear Files
        await clearFiles(page);

        // File name should disappear, dropzone prompt should return
        await expect(
            page.locator("text=test_amiga.0000.bin")
        ).not.toBeVisible();
        await expect(
            page.locator("text=Drag and drop files or folders here")
        ).toBeVisible();
    });

    test("dropzone shows file type description for selected data type", async ({
        page,
    }) => {
        // Image Data should show "Image files"
        await selectDataType(page, "Image Data");
        await expect(
            page.locator("text=Image files")
        ).toBeVisible();

        // Weather Data should show "CSV files"
        await selectDataType(page, "Weather Data");
        await expect(
            page.locator("text=CSV files")
        ).toBeVisible();

        // Orthomosaics should show "TIFF files"
        await selectDataType(page, "Orthomosaics");
        await expect(
            page.locator("text=TIFF files")
        ).toBeVisible();

        // Platform Logs should show "All files"
        await selectDataType(page, "Platform Logs");
        await expect(
            page.locator("text=All files")
        ).toBeVisible();
    });
});

test.describe("Upload new files only toggle", () => {
    test.beforeEach(async ({ page }) => {
        await navigateToUpload(page);
    });

    test("toggle for 'Only upload new files' is visible", async ({ page }) => {
        await expect(
            page.locator("text=Only upload new files")
        ).toBeVisible();
    });
});
