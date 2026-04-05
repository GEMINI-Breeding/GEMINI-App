/**
 * UI helpers for E2E upload tests.
 * Encapsulates navigation, form filling, and file upload interactions.
 * No mocking — all interactions are real browser automation.
 */

const path = require("path");

const FIXTURES_DIR = path.join(__dirname, "..", "fixtures");

/**
 * Navigate to the file upload page.
 * Clicks Prepare → Upload Files in the sidebar.
 * @param {import('@playwright/test').Page} page
 */
async function navigateToUpload(page) {
    await page.goto("/");
    await page.waitForSelector("#root:not(:empty)", { timeout: 15_000 });

    const prepareButton = page.locator("[aria-label='prepare']");
    await prepareButton.waitFor({ state: "visible", timeout: 15_000 });
    await prepareButton.click();

    const uploadButton = page.locator("[aria-label='upload-files']");
    await uploadButton.waitFor({ state: "visible", timeout: 5_000 });
    await uploadButton.click();

    // Wait for the Data Type dropdown to be present (indicates upload form loaded)
    await page
        .locator("label:has-text('Data Type')")
        .waitFor({ state: "visible", timeout: 10_000 });
}

/**
 * Select a data type from the dropdown.
 * @param {import('@playwright/test').Page} page
 * @param {string} label - The display label (e.g., "Amiga File", "Orthomosaics")
 */
async function selectDataType(page, label) {
    // Click the Data Type select to open the dropdown
    const selectControl = page.locator(".MuiSelect-select").first();
    await selectControl.click();

    // Wait for the dropdown menu to appear and click the option
    const option = page.locator(`li[role="option"]:has-text("${label}")`);
    await option.waitFor({ state: "visible", timeout: 5_000 });
    await option.click();

    // Wait for dropdown to close
    await page.waitForTimeout(300);
}

/**
 * Fill form fields by typing into Autocomplete inputs and blurring.
 * Handles the freeSolo Autocomplete pattern used by FileUpload.js.
 * @param {import('@playwright/test').Page} page
 * @param {Object} fields - Map of field name to value, e.g., { year: "2024", experiment: "TestExp" }
 */
async function fillFormFields(page, fields) {
    for (const [fieldName, value] of Object.entries(fields)) {
        if (fieldName === "date") {
            // Date field is a native <input type="date">, not an Autocomplete.
            // Value must be ISO format (YYYY-MM-DD) for the native input.
            const dateInput = page.locator("input[type='date']");
            await dateInput.waitFor({ state: "visible", timeout: 5_000 });
            await dateInput.fill(value);
            await page.waitForTimeout(100);
        } else {
            const input = page.locator(`#autocomplete-${fieldName}`);
            await input.waitFor({ state: "visible", timeout: 5_000 });
            await input.click();
            await input.fill(value);
            // Blur to trigger handleAutocompleteBlur which sets the formik value
            await input.press("Tab");
            // Small delay to let React state settle
            await page.waitForTimeout(100);
        }
    }
}

/**
 * Drop files into the upload dropzone.
 *
 * The dropzone renders two file inputs — both have webkitdirectory/directory
 * attributes which prevent Playwright's setInputFiles(). We temporarily remove
 * those attributes, set the files, then restore them.
 *
 * We target the dropzone's own input (inside the Paper with getRootProps),
 * NOT the "Select Folder" input (which is a separate button's child).
 *
 * @param {import('@playwright/test').Page} page
 * @param {string[]} filePaths - Absolute paths to files to upload
 */
async function dropFiles(page, filePaths) {
    // The dropzone input is a hidden input[type="file"] inside the form.
    // There are two: the dropzone's (inside a Paper with getRootProps) and
    // the "Select Folder" button's. We want the dropzone's input, which has
    // the tabindex="-1" and style attributes from getInputProps().
    // Target it via the form, picking the first file input that has tabindex.
    const fileInput = page.locator("form input[type='file'][tabindex='-1']").first();
    await fileInput.waitFor({ state: "attached", timeout: 5_000 });

    // Remove webkitdirectory/directory attributes that block setInputFiles,
    // and also temporarily remove the accept attribute so all file types work
    const savedAccept = await fileInput.evaluate((el) => {
        const accept = el.getAttribute("accept");
        el.removeAttribute("webkitdirectory");
        el.removeAttribute("directory");
        el.removeAttribute("accept");
        return accept;
    });

    // Now setInputFiles works with individual files
    await fileInput.setInputFiles(filePaths);

    // Restore the attributes
    await fileInput.evaluate(
        (el, accept) => {
            el.setAttribute("webkitdirectory", "");
            el.setAttribute("directory", "");
            if (accept) el.setAttribute("accept", accept);
        },
        savedAccept
    );

    // Wait for React state to update
    await page.waitForTimeout(500);
}

/**
 * Click the Upload submit button.
 * @param {import('@playwright/test').Page} page
 */
async function submitUpload(page) {
    const uploadButton = page.locator("button[type='submit']:has-text('Upload')");
    await uploadButton.click();
}

/**
 * Wait for the upload to complete successfully.
 * Looks for "Upload Successful" text in the UI.
 * @param {import('@playwright/test').Page} page
 * @param {number} timeout - Max wait time in ms
 */
async function waitForUploadComplete(page, timeout = 120_000) {
    // Dismiss any error/warning dialog that may appear during upload completion
    // (e.g., entity registration warnings). Check periodically.
    const uploadSuccess = page.locator("text=Upload Successful");
    const dialogOk = page.locator("role=dialog >> button:has-text('OK')");

    await Promise.race([
        uploadSuccess.waitFor({ state: "visible", timeout }),
        (async () => {
            // Poll for dialog and dismiss it while waiting for upload success
            const deadline = Date.now() + timeout;
            while (Date.now() < deadline) {
                if (await dialogOk.isVisible({ timeout: 500 }).catch(() => false)) {
                    await dialogOk.click();
                    await page.waitForTimeout(300);
                }
                if (await uploadSuccess.isVisible().catch(() => false)) return;
                await page.waitForTimeout(500);
            }
        })(),
    ]);
}

/**
 * Wait for the "Extracting Binary File..." state to appear.
 * @param {import('@playwright/test').Page} page
 * @param {number} timeout
 */
async function waitForExtractionStarted(page, timeout = 30_000) {
    await page
        .locator("text=Extracting Binary File...")
        .waitFor({ state: "visible", timeout });
}

/**
 * Click the Done button after a successful upload.
 * @param {import('@playwright/test').Page} page
 */
async function clickDone(page) {
    // Dismiss any error/warning dialog that may be blocking interaction
    const dialogOk = page.locator("role=dialog >> button:has-text('OK')");
    if (await dialogOk.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await dialogOk.click();
        await page.waitForTimeout(300);
    }
    const doneButton = page.locator("button:has-text('Done')");
    await doneButton.waitFor({ state: "visible", timeout: 5_000 });
    await doneButton.click();
    // Wait for form to reset
    await page.waitForTimeout(500);
}

/**
 * Click the Return button (shown after errors or cancelled uploads).
 * @param {import('@playwright/test').Page} page
 */
async function clickReturn(page) {
    const returnButton = page.locator("button:has-text('Return')");
    await returnButton.waitFor({ state: "visible", timeout: 5_000 });
    await returnButton.click();
    await page.waitForTimeout(500);
}

/**
 * Click Cancel Upload during an in-progress upload.
 * @param {import('@playwright/test').Page} page
 */
async function cancelUpload(page) {
    const cancelButton = page.locator("button:has-text('Cancel Upload')");
    await cancelButton.click();
    await page.waitForTimeout(500);
}

/**
 * Click the Clear Files button.
 * @param {import('@playwright/test').Page} page
 */
async function clearFiles(page) {
    const clearButton = page.locator("button:has-text('Clear Files')");
    await clearButton.click();
    await page.waitForTimeout(300);
}

/**
 * Get resolved fixture file path.
 * @param {...string} parts - Path parts relative to fixtures dir
 * @returns {string} Absolute path
 */
function fixturePath(...parts) {
    return path.join(FIXTURES_DIR, ...parts);
}

module.exports = {
    FIXTURES_DIR,
    navigateToUpload,
    selectDataType,
    fillFormFields,
    dropFiles,
    submitUpload,
    waitForUploadComplete,
    waitForExtractionStarted,
    clickDone,
    clickReturn,
    cancelUpload,
    clearFiles,
    fixturePath,
};
