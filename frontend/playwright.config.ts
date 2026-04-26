import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config'

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  // Specs under `_phase7/` are pre-staged for the Phase 7 (Aerial Pipeline)
  // migration step. They import seed helpers that don't exist yet and are
  // excluded everywhere — set at the top level so Playwright doesn't even
  // attempt to parse them when collecting tests.
  testIgnore: [/_phase7\//],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'blob' : 'html',
  use: {
    /* Dedicated port for E2E so we don't collide with a user's regular
       `npm run dev` on 5173. */
    baseURL: 'http://localhost:5273',
    trace: 'on-first-retry',
  },

  projects: [
    /* Original auth setup used by the pre-existing auth specs. Left in place
       even though `isLoggedIn()` is currently stubbed so it redirects /login
       to /, because un-stubbing auth later shouldn't require config churn. */
    { name: 'setup', testMatch: /auth\.setup\.ts$/ },

    /* New lightweight setup for the e2e-workflows suite: obtains a real JWT
       from the backend's /login/access-token endpoint and seeds it into
       localStorage. */
    { name: 'e2e-setup', testMatch: /e2e\.setup\.ts$/ },

    {
      name: 'chromium',
      testDir: './tests',
      testIgnore: [/e2e\//, /.*\.setup\.ts/],
      use: {
        ...devices['Desktop Chrome'],
        // Bump from the 1280×720 default. The admin users table sits
        // inside a flex pane with its own overflow, so a row that lands
        // below window height (>720px) ends up off-viewport: Playwright's
        // auto-scroll only moves window.scrollY, not the inner pane,
        // and `document.elementFromPoint(x, y)` returns null for points
        // below the viewport — clicks hang. Tall viewport keeps the
        // table fully on-screen across CRUD test runs.
        viewport: { width: 1280, height: 1400 },
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },

    {
      name: 'e2e-workflows',
      testDir: './tests/e2e',
      testIgnore: [/_phase7\//],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/e2e-user.json',
        trace: 'retain-on-failure',
        video: 'retain-on-failure',
      },
      dependencies: ['e2e-setup'],
    },
  ],

  webServer: {
    command: 'npm run dev -- --port 5273 --strictPort',
    url: 'http://localhost:5273',
    reuseExistingServer: !process.env.CI,
  },
});
