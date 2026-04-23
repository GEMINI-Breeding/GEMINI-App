import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES_ROOT = path.resolve(__dirname, "../fixtures")

/**
 * Absolute path to a fixture file. Used by upload helpers so tests reference
 * fixtures in a stable, cross-platform way.
 */
export function fixturePath(...segments: string[]): string {
  return path.join(FIXTURES_ROOT, ...segments)
}

export const FIXTURE_ROOT = FIXTURES_ROOT
