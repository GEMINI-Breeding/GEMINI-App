import path from "node:path"
import react from "@vitejs/plugin-react-swc"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    css: false,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["src/routeTree.gen.ts", "node_modules", "dist", "tests/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        // Generated / type-only
        "src/**/*.test.{ts,tsx}",
        "src/routeTree.gen.ts",
        "src/client/**",
        "src/**/*.d.ts",
        "src/types/**",
        // Entry point
        "src/main.tsx",
        // Route definitions (thin TanStack Router config — covered by E2E)
        "src/routes/**",
        // App-wide UI primitives (shadcn/Radix upstream-tested + our layout shells)
        "src/components/**",
        // Feature pages & their presentation layer (page composition is covered by
        // Playwright E2E; unit coverage targets logic in hooks/utils/stores/api)
        "src/**/pages/**",
        "src/features/*/components/**",
        "src/features/*/widgets/**",
        // Config objects — static data; no branches to meaningfully exercise
        "src/config/**",
        // Storybook
        "src/**/*.stories.{ts,tsx}",
        // Kebab-case duplicate — identical content to useMobile.ts (shadcn import
        // convention). Testing one copy is sufficient.
        "src/hooks/use-mobile.ts",
        // Pointer-event drag hook — exercised only via real mouse events and
        // DOM hit-testing on a live canvas; covered by Playwright E2E.
        "src/features/dashboard/hooks/useDrag.ts",
        // Multi-source chart aggregation — wires TanStack Query to many endpoints
        // and branches heavily on recharts-facing shapes. The pure transform
        // helpers it relies on live in useTraitData (which IS covered). A future
        // refactor should extract the rest of the transforms.
        "src/features/dashboard/hooks/useMultiSourceData.ts",
      ],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 70,
        branches: 70,
      },
    },
  },
})
