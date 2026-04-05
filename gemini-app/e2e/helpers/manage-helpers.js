/**
 * Helpers for Manage/Statistics tab E2E tests.
 * Seed test data directly to MinIO, navigate to manage sections.
 */

const { API_BASE } = require("./api-helpers");
const path = require("path");
const fs = require("fs");

/**
 * Seed a test file directly to MinIO at a given path.
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} objectPath - Path in MinIO (relative to bucket)
 * @param {string|Buffer} content - File content
 * @param {string} contentType - MIME type
 */
async function seedFileToMinIO(request, objectPath, content, contentType = "application/octet-stream") {
    const formData = new FormData();
    const blob = typeof content === "string"
        ? new Blob([content], { type: contentType })
        : new Blob([content], { type: contentType });
    formData.append("file", blob, objectPath.split("/").pop());
    formData.append("bucket_name", "gemini");
    formData.append("object_name", objectPath);

    const resp = await request.post(`${API_BASE}/files/upload`, {
        multipart: {
            file: {
                name: objectPath.split("/").pop(),
                mimeType: contentType,
                buffer: typeof content === "string" ? Buffer.from(content) : content,
            },
            bucket_name: "gemini",
            object_name: objectPath,
        },
    });
    return resp;
}

/**
 * Seed a test orthomosaic TIF to the expected Processed/ path in MinIO.
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {object} fields - { year, experiment, location, population, date, platform, sensor, fileName }
 * @param {Buffer} tifContent - TIF file content
 */
async function seedTestOrtho(request, fields, tifContent) {
    const { year, experiment, location, population, date, platform, sensor, fileName } = fields;
    const objectPath = `Processed/${year}/${experiment}/${location}/${population}/${date}/${platform}/${sensor}/${fileName}`;
    return seedFileToMinIO(request, objectPath, tifContent, "image/tiff");
}

/**
 * Navigate to the Statistics/Manage section via sidebar.
 * @param {import('@playwright/test').Page} page
 */
async function navigateToManage(page) {
    // Click the statistics/manage sidebar icon
    const statsButton = page.locator('[data-testid="stats-button"], button:has(svg[data-testid="EqualizerIcon"]), button:has(svg[data-testid="BarChartIcon"])');
    if (await statsButton.count() > 0) {
        await statsButton.first().click();
        await page.waitForTimeout(500);
    }
}

/**
 * Clean up all files under a Processed/ prefix in MinIO.
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} prefix - e.g., "Processed/2024/TestExp/Davis"
 */
async function cleanupProcessedData(request, prefix) {
    const { cleanupMinIOPrefix } = require("./api-helpers");
    await cleanupMinIOPrefix(request, prefix);
}

module.exports = {
    seedFileToMinIO,
    seedTestOrtho,
    navigateToManage,
    cleanupProcessedData,
};
