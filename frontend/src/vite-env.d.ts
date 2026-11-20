/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  /** Override for the GitHub releases endpoint the update check polls. */
  readonly VITE_UPDATE_CHECK_URL?: string
  /** "1" disables the automatic daily update check (set by Playwright). */
  readonly VITE_DISABLE_UPDATE_CHECK?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** App version from src-tauri/tauri.conf.json, injected by vite.config.ts. */
declare const __APP_VERSION__: string
