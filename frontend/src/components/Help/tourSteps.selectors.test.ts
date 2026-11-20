/**
 * Every tour step must point at something the app renders: a step whose
 * selector matches nothing spotlights nothing (the plot marking and GCP
 * tours did so for months after those tools were rewritten).
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { TOUR_SECTIONS } from "./tourSteps"

const SRC = join(__dirname, "..", "..")

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return sources(p)
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [p] : []
  })
}

const code = sources(SRC)
  .map((f) => readFileSync(f, "utf8"))
  .join("\n")

/** Attributes built from a template, e.g. data-onboarding={`nav-${…}`}. */
const templated = [
  ...code.matchAll(/data-(?:onboarding|testid)=\{`([^`$]*)\$\{/g),
].map((m) => m[1])

describe("tour selectors", () => {
  const steps = Object.values(TOUR_SECTIONS).flatMap((s) => s.steps)
  for (const step of steps) {
    const m = step.selector?.match(
      /^\[data-(onboarding|testid)\^?="([^"]+)"\]$/,
    )
    if (!m) continue
    const [, attr, value] = m
    it(`${step.id}: ${step.selector}`, () => {
      const literal = code.includes(`data-${attr}="${value}"`)
      const fromTemplate = templated.some(
        (prefix) => prefix && value.startsWith(prefix),
      )
      expect(literal || fromTemplate).toBe(true)
    })
  }
})
