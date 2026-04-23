import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config'

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
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
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },

    {
      name: 'e2e-workflows',
      testDir: './tests/e2e',
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
