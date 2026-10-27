/**
 * Errors from the app's service about the cluster, in words: the raw text
 * carries the command it ran ("gemi-hpc cloud fetch box R0VN… failed: …") and
 * the gate's echo of it, which say nothing to a person.
 */
const KNOWN: [RegExp, string][] = [
  [
    /job limits|over the job limits/i,
    "The cluster is already running as many GEMI jobs as allowed (10 at once). This starts by itself when one ends.",
  ],
  [
    /no session up|core is not up/i,
    "The app's cluster session is not running: start it on the Compute panel first.",
  ],
  [
    /Permission denied|publickey/i,
    "This computer could not sign in to the cluster (SSH key).",
  ],
  [
    /timed out|timeout/i,
    "The cluster did not answer in time. Try again in a minute.",
  ],
  [
    /no connection named/i,
    "That storage connection is not set up where the copy runs.",
  ],
]

export function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "")
  for (const [re, text] of KNOWN) if (re.test(raw)) return text
  // Keep the reason, drop the command and the gate's echo of it.
  const reason =
    raw
      .replace(/^Error:\s*/, "")
      .split(/gemi-gate: refused:/)[0]
      .replace(/^gemi-hpc .*? failed:\s*/s, "")
      .trim() || raw
  return reason.length > 300 ? `${reason.slice(0, 300)}…` : reason
}
