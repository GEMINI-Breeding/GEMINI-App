import type { Locator, Page } from "@playwright/test"
import { expect } from "@playwright/test"

/** Navigate to a specific pipeline run's detail page. */
export async function navigateToRun(
  page: Page,
  workspaceId: string,
  runId: string,
): Promise<void> {
  await page.goto(`/process/${workspaceId}/run/${runId}`)
  await expect(page.getByText(/Orthomosaic Generation/).first()).toBeVisible({
    timeout: 20_000,
  })
}

/**
 * Return the StepRow header row (`div.flex.items-start.justify-between`)
 * for the step whose label matches `stepLabel`.
 *
 * Tricky bit: the same class combination appears on every step's header,
 * and `.filter({ hasText })` is permissive enough that outer containers
 * that transitively contain that text also match. We anchor on the exact
 * label span and walk up two parents to the header div.
 */
function stepHeader(page: Page, stepLabel: string): Locator {
  // span → div.flex.flex-wrap (label side) → div.flex.items-start.justify-between (header row)
  return page
    .getByText(stepLabel, { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'items-start') and contains(@class,'justify-between')][1]")
}

/** Click the action button on the given step row. */
export async function runStep(page: Page, stepLabel: string): Promise<void> {
  const row = stepHeader(page, stepLabel)
  const btn = row
    .getByRole("button", { name: /^(run step|re-run)$/i })
    .first()
  await expect(btn).toBeVisible({ timeout: 10_000 })
  await expect(btn).toBeEnabled({ timeout: 10_000 })
  await btn.click()
}

/**
 * Click Run Step for the orthomosaic step, handle the "Name this orthomosaic"
 * prompt dialog (defaulting to no custom name), and confirm to kick off ODM.
 */
export async function startOrthomosaic(page: Page): Promise<void> {
  await runStep(page, "Orthomosaic Generation")
  // "Name this orthomosaic" dialog appears; confirm with Start.
  const startBtn = page
    .getByRole("dialog", { name: /Name this orthomosaic/i })
    .getByRole("button", { name: /^start$/i })
  await expect(startBtn).toBeVisible({ timeout: 10_000 })
  await startBtn.click()
}

/**
 * Wait for the given step to transition Running → terminal (completed or
 * error) in the UI. Observes DOM state, never touches EventSource directly.
 */
export async function waitForStepTerminal(
  page: Page,
  stepLabel: string,
  options: { timeoutMs?: number } = {},
): Promise<"completed" | "error"> {
  const timeout = options.timeoutMs ?? 15 * 60_000
  const row = stepHeader(page, stepLabel)

  // Confirm transition to running first — guards against a no-op click.
  await expect(
    row.getByRole("button", { name: /running/i }),
  ).toBeVisible({ timeout: 60_000 })

  const completed = row.getByRole("button", { name: /^re-run$/i })
  const failed = row.getByText(/failed|error/i)

  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await completed.isVisible().catch(() => false)) return "completed"
    if (await failed.isVisible().catch(() => false)) return "error"
    await page.waitForTimeout(2000)
  }
  throw new Error(
    `Step "${stepLabel}" did not reach a terminal state within ${timeout}ms`,
  )
}
