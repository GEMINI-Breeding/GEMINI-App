/**
 * Pull a user-actionable message out of a thrown error.
 *
 * The auto-generated SDK in `src/client/core/request.ts` throws `ApiError`
 * with `message = "Unprocessable Content"` (the generic HTTP status text)
 * even when the server actually returned a structured body like
 * `{ error: "database_validation_failed", error_description: "<cause>" }`.
 * That body is preserved on `err.body` but never bubbles to the UI unless
 * the caller looks for it — hence this helper.
 */

type StructuredErrorBody = {
  error_description?: unknown
  error?: unknown
  detail?: unknown
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null

const firstNonEmptyString = (...candidates: unknown[]): string | null => {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim()
  }
  return null
}

export function extractApiErrorMessage(err: unknown): string {
  if (isRecord(err) && "body" in err) {
    const body = (err as { body: unknown }).body
    if (isRecord(body)) {
      const b = body as StructuredErrorBody
      const fromBody = firstNonEmptyString(
        b.error_description,
        b.detail,
        b.error,
      )
      if (fromBody) return fromBody
    }
    if (typeof body === "string" && body.trim()) return body.trim()
  }
  if (err instanceof Error && err.message) return err.message
  return String(err)
}
