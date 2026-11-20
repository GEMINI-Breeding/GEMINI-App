// Type augmentation so vitest's `expect(...)` knows about jest-dom
// matchers (toBeInTheDocument, toHaveAttribute, etc.). The runtime
// side is wired up in vitest.setup.ts via `import
// "@testing-library/jest-dom/vitest"`; this file makes the matchers
// visible to tsc so `npx tsc -p tsconfig.build.json --noEmit` doesn't
// flag every test file.
import "@testing-library/jest-dom"
