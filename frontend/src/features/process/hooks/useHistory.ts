import { useCallback, useMemo, useReducer, useRef } from "react"

export type HistoryEntry<T> = { state: T; tag?: string; ts: number }
export type SetOpts = { tag?: string; coalesce?: boolean }

type InternalState<T> = {
  past: HistoryEntry<T>[]
  present: HistoryEntry<T>
  future: HistoryEntry<T>[]
}

type Action<T> =
  | { kind: "SET"; entry: HistoryEntry<T>; coalesce: boolean; limit: number }
  | { kind: "REPLACE"; entry: HistoryEntry<T> }
  | { kind: "UNDO" }
  | { kind: "REDO" }
  | { kind: "CLEAR"; entry: HistoryEntry<T> }

const COALESCE_MS = 1000

function reduce<T>(s: InternalState<T>, a: Action<T>): InternalState<T> {
  switch (a.kind) {
    case "SET": {
      const sameTag =
        a.coalesce &&
        a.entry.tag != null &&
        a.entry.tag === s.present.tag &&
        a.entry.ts - s.present.ts <= COALESCE_MS
      if (sameTag) {
        return { ...s, present: a.entry, future: [] }
      }
      const past = [...s.past, s.present]
      while (past.length > a.limit) past.shift()
      return { past, present: a.entry, future: [] }
    }
    case "REPLACE":
      return { ...s, present: a.entry }
    case "UNDO": {
      if (s.past.length === 0) return s
      const prev = s.past[s.past.length - 1]
      return {
        past: s.past.slice(0, -1),
        present: prev,
        future: [s.present, ...s.future],
      }
    }
    case "REDO": {
      if (s.future.length === 0) return s
      const [next, ...rest] = s.future
      return {
        past: [...s.past, s.present],
        present: next,
        future: rest,
      }
    }
    case "CLEAR":
      return { past: [], present: a.entry, future: [] }
  }
}

export interface UseHistoryReturn<T> {
  state: T
  set: (next: T, opts?: SetOpts) => void
  /** Mutates `present` without pushing onto history — for snapshot loads. */
  replace: (next: T) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  /** Reset past/future. If `newPresent` is given, also replace present. */
  clearHistory: (newPresent?: T) => void
}

export function useHistory<T>(
  initial: T,
  opts?: { limit?: number },
): UseHistoryReturn<T> {
  const limit = opts?.limit ?? 50
  const limitRef = useRef(limit)
  limitRef.current = limit

  const [state, dispatch] = useReducer(reduce<T>, undefined, () => ({
    past: [],
    present: { state: initial, ts: 0 },
    future: [],
  }))

  const set = useCallback((next: T, o?: SetOpts) => {
    dispatch({
      kind: "SET",
      entry: { state: next, tag: o?.tag, ts: Date.now() },
      coalesce: !!o?.coalesce,
      limit: limitRef.current,
    })
  }, [])

  const replace = useCallback((next: T) => {
    dispatch({
      kind: "REPLACE",
      entry: { state: next, ts: Date.now() },
    })
  }, [])

  const undo = useCallback(() => dispatch({ kind: "UNDO" }), [])
  const redo = useCallback(() => dispatch({ kind: "REDO" }), [])
  const clearHistory = useCallback(
    (newPresent?: T) => {
      dispatch({
        kind: "CLEAR",
        entry: {
          state: newPresent !== undefined ? newPresent : state.present.state,
          ts: Date.now(),
        },
      })
    },
    [state.present.state],
  )

  return useMemo(
    () => ({
      state: state.present.state,
      set,
      replace,
      undo,
      redo,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      clearHistory,
    }),
    [state, set, replace, undo, redo, clearHistory],
  )
}
