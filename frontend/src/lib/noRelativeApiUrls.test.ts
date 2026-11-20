/**
 * The desktop release build serves the page from the app bundle, with no
 * Vite proxy, so a bare `fetch("/api/…")` never reaches the backend: GCP
 * picking, image review and inference previews all broke that way. Every
 * request must go through `apiUrl()` / `OpenAPI.BASE` instead.
 */
import { describe, expect, it } from "vitest"

const sources = import.meta.glob("/src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>

// fetch(`/api…`), fetch("/api…"), xhr.open("POST", `/api…`), new EventSource("/api…")
const BARE = /(?:fetch|EventSource|\.open)\(\s*(?:"[A-Z]+",\s*)?[`"']\/api\//

describe("backend URLs", () => {
  it("never requests a relative /api path directly", () => {
    const offenders = Object.entries(sources)
      .filter(
        ([path]) => !/\.test\.tsx?$/.test(path) && !path.includes("/client/"),
      )
      .flatMap(([path, text]) =>
        text
          .split("\n")
          .map((line, i) => ({ line: line.trim(), n: i + 1 }))
          .filter(({ line }) => !line.startsWith("*") && !line.startsWith("//"))
          .filter(({ line }) => BARE.test(line))
          .map(({ n, line }) => `${path}:${n}: ${line}`),
      )
    expect(offenders).toEqual([])
  })
})
