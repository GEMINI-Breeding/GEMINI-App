/**
 * Packaged-app smoke test (Linux CI, .github/workflows/build.yml).
 *
 * Drives the INSTALLED desktop app through its real UI with tauri-driver
 * (WebKitWebDriver) against the real published stack — nothing mocked:
 *
 *   first launch  → data-folder screen → Continue → services pulled and
 *                   started → signed in (app shell)
 *   Settings      → shows the chosen folder; the stack's data is in it
 *   relaunch      → straight to the app (no first-run screen)
 *   Settings      → "Stop services and quit" stops the stack
 *   relaunch      → the app starts the stack again → app shell
 *
 * Env: GEMINI_APP (binary path), GEMINI_TEST_DATA_DIR (folder to choose).
 * Requires tauri-driver on :4444, a display (xvfb) and Docker.
 */
import { execFileSync } from "node:child_process"
import { existsSync, readdirSync } from "node:fs"
import { remote } from "webdriverio"

const APP = process.env.GEMINI_APP ?? "/usr/bin/gemi"
const DATA_DIR = process.env.GEMINI_TEST_DATA_DIR
if (!DATA_DIR) throw new Error("set GEMINI_TEST_DATA_DIR")

const FIRST_START_MS = 25 * 60_000 // pulls a few GB of images
const START_MS = 5 * 60_000

const log = (m) => console.log(`[smoke] ${m}`)

async function launch() {
  const b = await remote({
    hostname: "127.0.0.1",
    port: 4444,
    logLevel: "warn",
    capabilities: { "tauri:options": { application: APP } },
  })
  // xvfb has no window manager, so the app's "maximized" never applies and
  // the window stays at its minimum size, where the sidebar (and the user
  // menu) collapse. Give it a desktop-sized window like a real session.
  await b.setWindowSize(1600, 1000)
  return b
}

async function waitForShell(b, timeout) {
  // Anything the gate shows instead of the app is a failure worth reading.
  await b.waitUntil(
    async () => {
      if (await b.$('[data-testid="user-menu"]').isExisting()) return true
      const err = await b.$('[data-testid="stack-error"]')
      if (await err.isExisting())
        throw new Error(`stack failed to start:\n${await err.getText()}`)
      const docker = await b.$('[data-testid="stack-docker"]')
      if (await docker.isExisting())
        throw new Error(`Docker screen shown:\n${await docker.getText()}`)
      return false
    },
    { timeout, interval: 2000, timeoutMsg: "app shell never appeared" },
  )
}

async function openStackSettings(b) {
  await b.$('[data-testid="user-menu"]').click()
  await b.$("*=User Settings").click()
  await b.$('[data-testid="settings-tab-application"]').click()
  await b.$('[data-onboarding="files-tab-data"]').click()
  const panel = await b.$('[data-testid="stack-settings"]')
  await panel.waitForDisplayed({ timeout: 30_000 })
  return panel
}

function geminiContainersRunning() {
  const out = execFileSync(
    "docker",
    ["ps", "-q", "--filter", "label=com.docker.compose.project=gemini"],
    { encoding: "utf8" },
  )
  return out.trim().split("\n").filter(Boolean).length
}

// ── 1. First run ────────────────────────────────────────────────────────
let b = await launch()
log("first launch: expecting the data-folder screen")
const firstRun = await b.$('[data-testid="stack-first-run"]')
await firstRun.waitForDisplayed({ timeout: 60_000 })
const folder = await b.$('input[aria-label="Data folder"]')
await folder.clearValue()
await folder.setValue(DATA_DIR)
await b.$("button=Continue").click()
log("waiting for the stack to download and start")
await waitForShell(b, FIRST_START_MS)
log("signed in")

// ── 2. Settings shows the folder; the data is really there ─────────────
let panel = await openStackSettings(b)
const text = await panel.getText()
if (!text.includes(DATA_DIR))
  throw new Error(`Settings doesn't show ${DATA_DIR}:\n${text}`)
// The running containers mount the chosen folder (asking Docker, because on
// Linux the postgres folder belongs to the container's user and can't be
// listed by the test)…
for (const [service, sub] of [
  ["geminibase-db", "postgres"],
  ["geminibase-storage", "minio"],
]) {
  const mounts = execFileSync(
    "docker",
    [
      "inspect",
      `gemini-${service}-1`,
      "--format",
      "{{range .Mounts}}{{.Source}} {{end}}",
    ],
    { encoding: "utf8" },
  )
  if (!mounts.split(" ").includes(`${DATA_DIR}/${sub}`))
    throw new Error(`${service} doesn't use ${DATA_DIR}/${sub}: ${mounts}`)
}
// …and the storage really wrote there (its buckets).
if (
  !existsSync(`${DATA_DIR}/minio`) ||
  readdirSync(`${DATA_DIR}/minio`).length === 0
)
  throw new Error(`${DATA_DIR}/minio is empty`)
log("data folder in use")
await b.deleteSession()

// ── 3. Relaunch: straight into the app ─────────────────────────────────
b = await launch()
await waitForShell(b, START_MS)
if (await b.$('[data-testid="stack-first-run"]').isExisting())
  throw new Error("first-run screen shown again after setup")
log("relaunch went straight to the app")

// ── 4. Stop services and quit ──────────────────────────────────────────
panel = await openStackSettings(b)
await b.$("button=Stop services and quit").click()
const deadline = Date.now() + 120_000
while (geminiContainersRunning() > 0) {
  if (Date.now() > deadline) throw new Error("services still running")
  await new Promise((r) => setTimeout(r, 2000))
}
log("services stopped")
await b.deleteSession().catch(() => {}) // the app has exited

// ── 5. Relaunch starts them again ──────────────────────────────────────
b = await launch()
await waitForShell(b, START_MS)
if (geminiContainersRunning() === 0) throw new Error("stack not running")
log("relaunch restarted the services")
await b.deleteSession()
log("PASS")
