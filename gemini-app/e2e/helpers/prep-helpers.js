/**
 * Helpers for navigating to processing/stats views that require
 * experiment selection and "Initiate Prep" flow.
 *
 * These require an experiment with entities to already exist in the database.
 * Use the upload helpers + api-helpers to seed data first.
 */

const { API_BASE } = require("./api-helpers");

/**
 * Robustly select an option from an MUI Autocomplete dropdown.
 * Handles async option loading by retrying until the option appears.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} selector - CSS selector for the input (e.g. "#experiment-combo-box")
 * @param {string} value - The option text to select
 * @param {number} timeout - Max wait in ms (default 20s)
 */
async function selectAutocompleteOption(page, selector, value, timeout = 30_000) {
    const combo = page.locator(selector);

    // If combo is hidden (e.g. sidebar collapsed), try opening the sidebar
    const isVisible = await combo.isVisible({ timeout: 2_000 }).catch(() => false);
    if (!isVisible) {
        const openSidebar = page.locator("[aria-label='open-sidebar']");
        if (await openSidebar.isVisible({ timeout: 1_000 }).catch(() => false)) {
            await openSidebar.click();
            await page.waitForTimeout(500);
        }
        // Also try the hamburger menu
        const hamburger = page.locator("[aria-label='collapse-menu']");
        if (await hamburger.isVisible({ timeout: 1_000 }).catch(() => false)) {
            await hamburger.click();
            await page.waitForTimeout(500);
        }
    }

    await combo.waitFor({ state: "visible", timeout: 10_000 });

    const option = page.locator(`li[role="option"]:has-text("${value}")`);
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
        // Open the dropdown by clicking the combo's popup toggle button
        // (the small arrow button inside the Autocomplete)
        const toggle = combo.locator("..").locator("button[aria-label='Open']").or(
            combo.locator("..").locator("[class*='endAdornment'] button")
        );
        if (await toggle.count() > 0) {
            await toggle.first().click();
        } else {
            await combo.click();
        }

        if (await option.isVisible({ timeout: 2_000 }).catch(() => false)) {
            await option.click();
            await page.waitForTimeout(500);
            return;
        }
        // Close dropdown and wait for async data to load
        await combo.press("Escape");
        await page.waitForTimeout(2_000);
    }

    // Final attempt with typing as fallback
    await combo.click();
    await combo.fill(value);
    await option.click({ timeout: 5_000 });
    await page.waitForTimeout(500);
}

/**
 * Navigate to the processing view and initiate data preparation.
 * Requires an experiment with year, location, population entities.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} fields - { experiment, year, location, population }
 */
async function navigateToProcessingAndInitiatePrep(page, fields) {
    const { experiment, year, location, population } = fields;

    // Navigate to processing tab
    await page.goto("/");
    await page.waitForSelector("#root:not(:empty)", { timeout: 15_000 });

    const processButton = page.locator("[aria-label='process']");
    await processButton.waitFor({ state: "visible", timeout: 15_000 });
    await processButton.click();

    const processingButton = page.locator("[aria-label='processing']");
    await processingButton.waitFor({ state: "visible", timeout: 5_000 });
    await processingButton.click();

    // Wait for the sidebar selection menu to appear
    await page.waitForTimeout(1_000);

    // Fill in the experiment selection - GCPPickerSelectionMenu uses experiment-first.
    // Selecting an experiment triggers getExperimentHierarchy() which populates
    // year/location/population options. We must wait for that to complete.
    await selectAutocompleteOption(page, "#experiment-combo-box", experiment);

    // Year — populated from hierarchy.seasons[].season_name after experiment selected.
    // The hierarchy API call is triggered asynchronously by the experiment selection,
    // so the year options may take a moment to appear. Use a longer timeout.
    await selectAutocompleteOption(page, "#year-combo-box", year, 30_000);


    // Location and Population — also populated from hierarchy response
    await selectAutocompleteOption(page, "#location-combo-box", location);
    await selectAutocompleteOption(page, "#population-combo-box", population);

    // Click Begin Data Preparation
    await page.locator("button:has-text('Begin Data Preparation')").click();
    await page.waitForTimeout(500);
}

/**
 * Navigate to the stats view and select experiment data.
 * TableSelectionMenu uses year-first ordering.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} fields - { experiment, year, location, population }
 */
async function navigateToStatsAndSelectData(page, fields) {
    const { experiment, year, location, population } = fields;

    await page.goto("/");
    await page.waitForSelector("#root:not(:empty)", { timeout: 15_000 });

    // Click View Data → Stats
    const viewDataButton = page.locator("[aria-label='view-data']");
    await viewDataButton.waitFor({ state: "visible", timeout: 15_000 });
    await viewDataButton.click();

    const statsButton = page.locator("[aria-label='stats']");
    await statsButton.waitFor({ state: "visible", timeout: 5_000 });
    await statsButton.click();

    // Wait for sidebar to show selection menu
    await page.waitForTimeout(1_000);

    // TableSelectionMenu uses year-first ordering
    await selectAutocompleteOption(page, "#year-combo-box", year);
    await selectAutocompleteOption(page, "#experiment-combo-box", experiment);
    await selectAutocompleteOption(page, "#location-combo-box", location);
    await selectAutocompleteOption(page, "#population-combo-box", population);

    // Click OK
    await page.locator("button:has-text('OK')").click();
    await page.waitForTimeout(500);
}

/**
 * Navigate to the map view.
 * @param {import('@playwright/test').Page} page
 */
async function navigateToMap(page) {
    await page.goto("/");
    await page.waitForSelector("#root:not(:empty)", { timeout: 15_000 });

    const viewDataButton = page.locator("[aria-label='view-data']");
    await viewDataButton.waitFor({ state: "visible", timeout: 15_000 });
    await viewDataButton.click();

    const mapButton = page.locator("[aria-label='map']");
    await mapButton.waitFor({ state: "visible", timeout: 5_000 });
    await mapButton.click();
    await page.waitForTimeout(500);
}

/**
 * Navigate to the image query view.
 * @param {import('@playwright/test').Page} page
 */
async function navigateToImageQuery(page) {
    await page.goto("/");
    await page.waitForSelector("#root:not(:empty)", { timeout: 15_000 });

    const viewDataButton = page.locator("[aria-label='view-data']");
    await viewDataButton.waitFor({ state: "visible", timeout: 15_000 });
    await viewDataButton.click();

    const queryButton = page.locator("[aria-label='query']");
    await queryButton.waitFor({ state: "visible", timeout: 5_000 });
    await queryButton.click();
    await page.waitForTimeout(500);
}

/**
 * Navigate to the mosaic generation view and initiate prep.
 * @param {import('@playwright/test').Page} page
 * @param {object} fields - { experiment, year, location, population }
 */
async function navigateToMosaicGeneration(page, fields) {
    const { experiment, year, location, population } = fields;

    await page.goto("/");
    await page.waitForSelector("#root:not(:empty)", { timeout: 15_000 });

    const processButton = page.locator("[aria-label='process']");
    await processButton.waitFor({ state: "visible", timeout: 15_000 });
    await processButton.click();

    const mosaicButton = page.locator("[aria-label='mosaic-generation']");
    await mosaicButton.waitFor({ state: "visible", timeout: 5_000 });
    await mosaicButton.click();

    await page.waitForTimeout(1_000);

    // Fill experiment selection (experiment-first, same as GCPPickerSelectionMenu)
    await selectAutocompleteOption(page, "#experiment-combo-box", experiment);
    await selectAutocompleteOption(page, "#year-combo-box", year);
    await selectAutocompleteOption(page, "#location-combo-box", location);
    await selectAutocompleteOption(page, "#population-combo-box", population);

    await page.locator("button:has-text('Begin Data Preparation')").click();
    await page.waitForTimeout(500);
}

/**
 * Seed a complete experiment with entities via API for use in prep tests.
 * Creates experiment, season, site, population, sensor_platform, sensor, dataset.
 * Returns the experiment object for cleanup.
 *
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {object} fields - { experiment, year, location, population, platform, sensor }
 * @returns {Promise<object>} - { experimentId, experimentName }
 */
async function seedExperimentEntities(request, fields) {
    const { experiment, year, location, population, platform, sensor } = fields;

    // Create experiment
    const expResp = await request.post(`${API_BASE}/experiments`, {
        data: { experiment_name: experiment },
    });
    const exp = await expResp.json();
    const experimentId = exp.id || exp.experiment_id;

    // Create season linked to experiment
    const seasonResp = await request.post(`${API_BASE}/experiments/id/${experimentId}/seasons`, {
        data: {
            season_name: year,
            season_start_date: `${year}-01-01`,
            season_end_date: `${year}-12-31`,
        },
    });
    if (!seasonResp.ok()) {
        console.error(`Failed to create season: ${seasonResp.status()} ${await seasonResp.text()}`);
    }

    // Create site linked to experiment
    await request.post(`${API_BASE}/experiments/id/${experimentId}/sites`, {
        data: { site_name: location },
    });

    // Create population linked to experiment
    await request.post(`${API_BASE}/experiments/id/${experimentId}/populations`, {
        data: {
            population_name: population,
            population_accession: population,
        },
    });

    if (platform) {
        await request.post(`${API_BASE}/experiments/id/${experimentId}/sensor_platforms`, {
            data: { sensor_platform_name: platform },
        });
    }

    if (sensor) {
        await request.post(`${API_BASE}/experiments/id/${experimentId}/sensors`, {
            data: {
                sensor_name: sensor,
                sensor_platform_name: platform || null,
            },
        });
    }

    return { experimentId, experimentName: experiment };
}

module.exports = {
    navigateToProcessingAndInitiatePrep,
    navigateToStatsAndSelectData,
    navigateToMap,
    navigateToImageQuery,
    navigateToMosaicGeneration,
    seedExperimentEntities,
};
