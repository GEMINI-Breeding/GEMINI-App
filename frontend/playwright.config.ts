import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config'

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // One retry, not two. e2e-workflows runs serially (workers: 1) and some
  // specs allow 5-8 min, so at `retries: 2` a handful of genuinely-failing
  // tests runs 3x each and the job spends hours re-failing. One retry still
  // absorbs a real flake; anything failing twice is a signal, not noise.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  // 'blob' buffers per-test output and only emits at the end, so a CI run
  // that stalls shows no progress at all — which is exactly what made the
  // 1h49m run undiagnosable. 'line' streams each result as it completes;
  // the blob report is still written for the report artifact.
  reporter: process.env.CI ? [['blob'], ['line']] : 'html',
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
      // Force serial execution: the chunked-upload state is REST-API-process-
      // local (in-memory dict + /tmp tempfiles per task_plan.md Phase 5/15),
      // so concurrent uploads from parallel specs collide and surface as
      // 500s on /api/files/upload_chunk. Once that state moves to Redis we
      // can drop this back to fullyParallel.
      fullyParallel: false,
      workers: 1,
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
    env: {
      // Suppress the daily update check. It calls the live GitHub releases
      // API and raises a persistent toast that overlays the page and
      // intercepts clicks (it broke the analyze-map-overlap spec on the
      // import wizard's Continue button). See useUpdateChecker.ts.
      VITE_DISABLE_UPDATE_CHECK: '1',
    },
  },
});
