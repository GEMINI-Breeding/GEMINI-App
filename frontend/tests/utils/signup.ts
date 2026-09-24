import type { APIRequestContext } from "@playwright/test"

/** Whether the server allows self-registration (GEMINI_SIGNUP_ENABLED; off
 * by default). A read of the public capabilities endpoint. */
export async function signupEnabled(
  request: APIRequestContext,
): Promise<boolean> {
  const res = await request.get("/api/utils/capabilities")
  if (!res.ok()) return false
  return (await res.json()).signup_enabled === true
}

export const SIGNUP_OFF =
  "Self-registration is off on this server (GEMINI_SIGNUP_ENABLED=false, the default)."
