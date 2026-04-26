import { AxiosError } from "axios"
import type { ApiError } from "./client"

function extractErrorMessage(err: ApiError): string {
  if (err instanceof AxiosError) {
    return err.message
  }

  const body = err.body as any
  // GEMINIbase shape: { error: "Short slug", error_description: "Human text." }
  // The description is what actually surfaces to users; only fall back to the
  // short slug when the description is missing.
  if (body?.error_description) return body.error_description
  if (body?.error && typeof body.error === "string") return body.error

  // Legacy/FastAPI/Litestar default-validation shape: { detail: ... }
  const errDetail = body?.detail
  if (Array.isArray(errDetail) && errDetail.length > 0) {
    return errDetail[0].msg
  }
  return errDetail || "Something went wrong."
}

export const handleError = function (
  this: (msg: string) => void,
  err: ApiError,
) {
  const errorMessage = extractErrorMessage(err)
  this(errorMessage)
}

export const getInitials = (name: string): string => {
  return name
    .split(" ")
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase()
}
