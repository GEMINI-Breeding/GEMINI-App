/**
 * useDrag — pointer-event based drag, replacing HTML5 DnD which Tauri WebKit kills.
 *
 * onMove and onUp are defined inside `start` as local closures so they have a
 * stable reference for the full duration of the drag. No useCallback dependency
 * chain means no stale-listener removal on re-render.
 */

import { useState, useRef, useCallback, useEffect } from "react"

export interface DragPos { x: number; y: number }

export function useDrag(onDropCallback: (id: string) => void) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [pos, setPos] = useState<DragPos>({ x: 0, y: 0 })
  const [isOverCanvas, setIsOverCanvas] = useState(false)

  const canvasRef = useRef<HTMLDivElement>(null)
  const draggingIdRef = useRef<string | null>(null)
  // Always-current reference to the callback — never stale, no dependency needed
  const onDropRef = useRef(onDropCallback)
  onDropRef.current = onDropCallback

  const start = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault()
    console.log(`[useDrag] start id: ${id}`)

    draggingIdRef.current = id
    setDraggingId(id)
    setPos({ x: e.clientX, y: e.clientY })
    document.body.style.cursor = "grabbing"
    document.body.style.userSelect = "none"

    function isOver(clientX: number, clientY: number): boolean {
      if (!canvasRef.current) return false
      const r = canvasRef.current.getBoundingClientRect()
      console.log(`[useDrag] canvas bounds: ${r.left} ${r.top} ${r.right} ${r.bottom} | cursor: ${clientX} ${clientY}`)
      return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom
    }

    function onMove(ev: MouseEvent) {
      setPos({ x: ev.clientX, y: ev.clientY })
      setIsOverCanvas(isOver(ev.clientX, ev.clientY))
    }

    function onUp(ev: MouseEvent) {
      const currentId = draggingIdRef.current
      const over = isOver(ev.clientX, ev.clientY)
      console.log(`[useDrag] mouseup id: ${currentId} | over: ${over} | pos: ${ev.clientX} ${ev.clientY}`)

      if (currentId && over) {
        console.log(`[useDrag] dropping: ${currentId}`)
        onDropRef.current(currentId)
      }

      // Cleanup
      draggingIdRef.current = null
      setDraggingId(null)
      setIsOverCanvas(false)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }

    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }, []) // no dependencies — everything accessed via refs or defined inline

  // Safety: clear body styles on unmount
  useEffect(() => {
    return () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
  }, [])

  return {
    draggingId,
    pos,
    isOverCanvas,
    isDragging: draggingId !== null,
    canvasRef,
    start,
  }
}
