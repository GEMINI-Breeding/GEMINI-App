import { describe, expect, it } from "vitest"

import { friendlyError } from "./friendlyError"

describe("errors in words", () => {
  it("says what a full cluster means, without the command", () => {
    const raw =
      "Error: gemi-hpc cloud fetch box R0VN 2023-x include=Kj experiment=b64:SW date=2023-07-20 failed: refused by the job limits: 10 GEMI jobs already queued or running (limit 10); set GEMI_MAX_* gemi-gate: refused: cloud-fetch box R0VN (over the job limits)"
    const got = friendlyError(new Error(raw))
    expect(got).toContain("as many GEMI jobs as allowed")
    expect(got).not.toContain("R0VN")
  })
  it("keeps an unknown reason, without the command or the gate's echo", () => {
    const raw =
      "gemi-hpc ingest /x failed: no such folder /x gemi-gate: refused: ingest /x"
    expect(friendlyError(raw)).toBe("no such folder /x")
  })
})
