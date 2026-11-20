import "@testing-library/jest-dom/vitest"
import { vi } from "vitest"

// Keep OpenAPI.BASE empty so generated client never contacts a real backend.
// Must be set before any src/ module import that reads main.tsx-equivalent setup.
;(globalThis as unknown as { window: Window }).window =
  globalThis.window ?? ({} as Window)
;(window as unknown as { __GEMI_BACKEND_URL__: string }).__GEMI_BACKEND_URL__ =
  ""

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
  globalThis.ResizeObserver =
    ResizeObserverShim as unknown as typeof ResizeObserver
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

// PointerEvent capture — Radix Select / Popover call these on the trigger
// when the user clicks. jsdom doesn't implement them; without these shims
// the click throws "hasPointerCapture is not a function". The functions
// are no-ops in tests because pointer capture only matters for real-DOM
// drag-style interactions.
type ElementWithPointerCapture = Element & {
  hasPointerCapture?: (id: number) => boolean
  setPointerCapture?: (id: number) => void
  releasePointerCapture?: (id: number) => void
}
const eproto = Element.prototype as ElementWithPointerCapture
if (typeof eproto.hasPointerCapture !== "function") {
  eproto.hasPointerCapture = () => false
}
if (typeof eproto.setPointerCapture !== "function") {
  eproto.setPointerCapture = () => {}
}
if (typeof eproto.releasePointerCapture !== "function") {
  eproto.releasePointerCapture = () => {}
}
// scrollIntoView — Radix Select calls this on the focused item when the
// menu opens. jsdom omits it on Element.
type ElementWithScroll = Element & {
  scrollIntoView?: () => void
}
const eproto2 = Element.prototype as ElementWithScroll
if (typeof eproto2.scrollIntoView !== "function") {
  eproto2.scrollIntoView = () => {}
}

// ImageData — jsdom doesn't ship a constructor. The Thermal Viewer
// uses `new ImageData(w, h)` (plus a `data` Uint8ClampedArray) to
// build palette-mapped canvases without ever touching a real DOM
// canvas. This shim matches the spec's basic constructor signatures.
type ImageDataLike = {
  data: Uint8ClampedArray
  width: number
  height: number
  colorSpace: "srgb" | "display-p3"
}
type ImageDataCtor = {
  new (sw: number, sh: number): ImageDataLike
  new (data: Uint8ClampedArray, sw: number, sh?: number): ImageDataLike
}
const g = globalThis as { ImageData?: ImageDataCtor }
if (typeof g.ImageData !== "function") {
  class ImageDataShim implements ImageDataLike {
    data: Uint8ClampedArray
    width: number
    height: number
    colorSpace: "srgb" | "display-p3" = "srgb"
    constructor(
      a: number | Uint8ClampedArray,
      b: number,
      c?: number,
    ) {
      if (typeof a === "number") {
        const w = a
        const h = b
        this.width = w
        this.height = h
        this.data = new Uint8ClampedArray(w * h * 4)
      } else {
        this.data = a
        this.width = b
        this.height = c ?? a.length / (4 * b)
      }
    }
  }
  g.ImageData = ImageDataShim as unknown as ImageDataCtor
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
