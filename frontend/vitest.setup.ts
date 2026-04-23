import "@testing-library/jest-dom/vitest"
import { vi } from "vitest"

// Keep OpenAPI.BASE empty so generated client never contacts a real backend.
// Must be set before any src/ module import that reads main.tsx-equivalent setup.
;(globalThis as unknown as { window: Window }).window = globalThis.window ?? ({} as Window)
;(window as unknown as { __GEMI_BACKEND_URL__: string }).__GEMI_BACKEND_URL__ = ""

// matchMedia — Radix + next-themes probe this on mount.
if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

// ResizeObserver — recharts, Radix Select, and others rely on it.
class ResizeObserverShim {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = ResizeObserverShim as unknown as typeof ResizeObserver
}

// Minimal EventSource stub — tests that exercise SSE override per-test.
class MinimalEventSource {
  url: string
  readyState = 0
  onopen: ((ev: Event) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  constructor(url: string) {
    this.url = url
  }
  addEventListener() {}
  removeEventListener() {}
  close() {}
}
vi.stubGlobal("EventSource", MinimalEventSource)

// scrollTo — Radix focus management calls it in jsdom.
if (!window.scrollTo) {
  Object.defineProperty(window, "scrollTo", { value: () => {}, writable: true })
}

// Node 22's experimental localStorage shadows jsdom's, but without a backing
// file it's missing methods like removeItem/clear. Install an in-memory shim
// (fresh map per test via a beforeEach at the top of relevant suites).
function createMemoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() {
      return store.size
    },
  } as Storage
}
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: createMemoryStorage(),
})
Object.defineProperty(window, "sessionStorage", {
  configurable: true,
  value: createMemoryStorage(),
})
