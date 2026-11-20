import { useCallback, useEffect, useRef, useState } from "react"

export type DraftEnvelope<T> = {
  schemaVersion: 1
  runId: string
  directory: string
  lastModifiedAt: string
  state: T
}

export interface UseDraftPersistenceOptions<T> {
  /** localStorage key — should embed the scope so different fields don't collide. */
  storageKey: string
  state: T
  runId: string
  directory: string
  /** When false, the auto-save is suppressed (e.g. empty state shouldn't overwrite a real draft). */
  isDirty: (state: T) => boolean
  /** Debounce window for writes (default 300ms). */
  debounceMs?: number
  /** Disable the beforeunload confirm even when dirty (tests). */
  disableBeforeUnload?: boolean
}

export interface UseDraftPersistenceReturn<T> {
  /** Draft loaded on mount, or null if absent / unparseable. Stable across renders. */
  initialDraft: DraftEnvelope<T> | null
  /** Remove the stored draft. Call after a successful save, or on user "Discard". */
  discardDraft: () => void
  /** Synchronously persist the current state (used by beforeunload + unmount). */
  flushDraft: () => void
}

function safeRead<T>(key: string): DraftEnvelope<T> | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DraftEnvelope<T>
    if (!parsed || parsed.schemaVersion !== 1) return null
    return parsed
  } catch {
    return null
  }
}

function safeWrite<T>(key: string, envelope: DraftEnvelope<T>): void {
  try {
    localStorage.setItem(key, JSON.stringify(envelope))
  } catch {
    // Best-effort: Safari private mode + quota errors fall through silently.
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // Best-effort.
  }
}

export function useDraftPersistence<T>(
  opts: UseDraftPersistenceOptions<T>,
): UseDraftPersistenceReturn<T> {
  const {
    storageKey,
    state,
    runId,
    directory,
    isDirty,
    debounceMs = 300,
    disableBeforeUnload,
  } = opts

  // Read once on mount and stash the value so the same envelope is returned
  // across re-renders without re-parsing.
  const [initialDraft] = useState<DraftEnvelope<T> | null>(() =>
    safeRead<T>(storageKey),
  )

  // Keep latest values in refs so the unmount/beforeunload callbacks always
  // see the current state without re-binding the listeners.
  const stateRef = useRef(state)
  stateRef.current = state
  const dirtyRef = useRef(isDirty)
  dirtyRef.current = isDirty
  const storageKeyRef = useRef(storageKey)
  storageKeyRef.current = storageKey
  const runIdRef = useRef(runId)
  runIdRef.current = runId
  const directoryRef = useRef(directory)
  directoryRef.current = directory

  const flushDraft = useCallback(() => {
    const s = stateRef.current
    if (!dirtyRef.current(s)) {
      safeRemove(storageKeyRef.current)
      return
    }
    safeWrite(storageKeyRef.current, {
      schemaVersion: 1,
      runId: runIdRef.current,
      directory: directoryRef.current,
      lastModifiedAt: new Date().toISOString(),
      state: s,
    })
  }, [])

  const discardDraft = useCallback(() => {
    safeRemove(storageKeyRef.current)
  }, [])

  // Debounced auto-save on every state change. `state` IS the trigger —
  // we need the effect to re-run whenever it changes, even though we
  // read it via stateRef inside flushDraft.
  // biome-ignore lint/correctness/useExhaustiveDependencies: state is the debounce trigger
  useEffect(() => {
    const handle = window.setTimeout(() => {
      flushDraft()
    }, debounceMs)
    return () => window.clearTimeout(handle)
  }, [state, debounceMs, flushDraft])

  // Final flush on unmount.
  useEffect(() => {
    return () => {
      flushDraft()
    }
  }, [flushDraft])

  // beforeunload — warn on dirty state and persist synchronously.
  useEffect(() => {
    if (disableBeforeUnload) return
    function onBeforeUnload(e: BeforeUnloadEvent) {
      flushDraft()
      if (dirtyRef.current(stateRef.current)) {
        e.preventDefault()
        e.returnValue = ""
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [disableBeforeUnload, flushDraft])

  return { initialDraft, discardDraft, flushDraft }
}
