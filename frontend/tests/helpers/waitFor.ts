import type { Page, Request, Response } from "@playwright/test"

type UrlMatcher = string | RegExp | ((url: string) => boolean)

function matchesUrl(url: string, matcher: UrlMatcher): boolean {
  if (typeof matcher === "string") return url.includes(matcher)
  if (matcher instanceof RegExp) return matcher.test(url)
  return matcher(url)
}

/** Wait for a request matching the given method + URL pattern. */
export function waitForRequest(
  page: Page,
  method: string,
  matcher: UrlMatcher,
  timeoutMs = 15_000,
): Promise<Request> {
  return page.waitForRequest(
    (r) => r.method() === method && matchesUrl(r.url(), matcher),
    { timeout: timeoutMs },
  )
}

/** Wait for a successful response matching the given method + URL pattern. */
export async function waitForResponseOk(
  page: Page,
  method: string,
  matcher: UrlMatcher,
  timeoutMs = 15_000,
): Promise<Response> {
  const res = await page.waitForResponse(
    (r) => r.request().method() === method && matchesUrl(r.url(), matcher),
    { timeout: timeoutMs },
  )
  if (!res.ok()) {
    throw new Error(
      `Expected OK response for ${method} ${matcher}, got ${res.status()} ${res.statusText()}`,
    )
  }
  return res
}
