const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
    testDir: "./e2e",
    timeout: 60_000,
    retries: 0, // Failures are potential bugs — don't mask them with retries
    workers: 1, // Serial execution — tests share a backend database
    reporter: [["html", { open: "never" }]],
    use: {
        baseURL: "http://localhost:3000",
        headless: true,
        screenshot: "only-on-failure",
        trace: "retain-on-failure",
    },
    projects: [
        {
            name: "chromium",
            use: { browserName: "chromium" },
        },
    ],
    webServer: {
        command: "REACT_APP_FRAMEWORK_PORT=7777 npm start",
        url: "http://localhost:3000",
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
    },
});
