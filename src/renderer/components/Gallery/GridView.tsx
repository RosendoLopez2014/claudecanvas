import { useGalleryStore, type GalleryVariant } from '@/stores/gallery'
import { useTerminalStore } from '@/stores/terminal'
import { useTabsStore } from '@/stores/tabs'
import { useState, useRef, useEffect, useCallback } from 'react'
import { CanvasBoard } from './CanvasBoard'
import { fullRelayout } from './canvasLayout'
import { DRAG_THRESHOLD } from './constants'
import { GalleryCard } from './GalleryCard'

/** Select a gallery variant and paste the choice into Claude's terminal.
 *  Ctrl+U clears the current input line first, so clicking a different card
 *  replaces the previous selection text seamlessly. */
function selectAndNotify(variant: GalleryVariant): void {
  const { selectedId, selectVariant } = useGalleryStore.getState()
  if (selectedId === variant.id) return // Already selected

  selectVariant(variant.id)
  window.api.mcp.gallerySelect?.(variant.id)

  const tab = useTabsStore.getState().getActiveTab()
  if (!tab?.ptyId) return

  // Ctrl+U clears the current input line — removes previous selection text
  window.api.pty.write(tab.ptyId, '\x15')
  window.api.pty.write(tab.ptyId, `I choose "${variant.label}" `)
  requestAnimationFrame(() => useTerminalStore.getState().focus())
}

export function GridView() {
  const { variants, selectedId, cardPositions, setCardPosition } = useGalleryStore()
  const [interactingId, setInteractingId] = useState<string | null>(null)

  // ─── Drag state ─────────────────────────────────────────────────────────────
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  const dragStartRef = useRef<{ screenX: number; screenY: number; worldX: number; worldY: number; cardX: number; cardY: number } | null>(null)
  const didDragRef = useRef(false)

  // Esc exits interact mode
  useEffect(() => {
    if (!interactingId) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setInteractingId(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [interactingId])

  // ─── Drag handlers (window-level for smooth tracking) ───────────────────────
  useEffect(() => {
    if (!draggingId) return

    const onMove = (e: PointerEvent) => {
      const start = dragStartRef.current
      if (!start) return
      const dx = e.clientX - start.screenX
      const dy = e.clientY - start.screenY
      if (!didDragRef.current && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return
      didDragRef.current = true

      // Convert screen delta to world delta using current zoom
      const { zoom } = useGalleryStore.getState().viewport
      setDragPos({
        x: start.cardX + dx / zoom,
        y: start.cardY + dy / zoom,
      })
    }

    const onUp = () => {
      if (didDragRef.current && dragPos && draggingId) {
        // Commit the position and mark as pinned (user-moved)
        setCardPosition(draggingId, {
          ...useGalleryStore.getState().cardPositions[draggingId],
          x: dragPos.x,
          y: dragPos.y,
          pinned: true,
        })
      }
      setDraggingId(null)
      setDragPos(null)
      dragStartRef.current = null
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [draggingId, dragPos, setCardPosition])

  const handleCardPointerDown = useCallback((e: React.PointerEvent, variantId: string) => {
    // Only left-click drag (not middle/right)
    if (e.button !== 0) return
    e.stopPropagation()
    const pos = useGalleryStore.getState().cardPositions[variantId]
    if (!pos) return
    didDragRef.current = false
    dragStartRef.current = {
      screenX: e.clientX,
      screenY: e.clientY,
      worldX: 0,
      worldY: 0,
      cardX: pos.x,
      cardY: pos.y,
    }
    setDraggingId(variantId)
  }, [])

  // ─── Size measurement handlers ──────────────────────────────────────────────
  // When harness reports dimensions, update card sizes and fix overlaps.
  // A debounced full relayout runs once after the initial burst of measurements.

  const pendingHeights = useRef<Record<string, number>>({})
  const flushRef = useRef<number>(0)
  const initialRelayoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didInitialRelayout = useRef(false)

  // Schedule a one-time full relayout after measurements settle (1s after last measurement)
  const scheduleRelayout = useCallback(() => {
    if (didInitialRelayout.current) return
    if (initialRelayoutTimer.current) clearTimeout(initialRelayoutTimer.current)
    initialRelayoutTimer.current = setTimeout(() => {
      didInitialRelayout.current = true
      const store = useGalleryStore.getState()
      const updated = fullRelayout(store.cardPositions)
      store.setCardPositions(updated)
    }, 800)
  }, [])

  const handleHeightMeasured = useCallback((id: string, height: number) => {
    pendingHeights.current[id] = height
    cancelAnimationFrame(flushRef.current)
    flushRef.current = requestAnimationFrame(() => {
      const store = useGalleryStore.getState()
      let updated = { ...store.cardPositions }
      let changed = false
      for (const [hid, h] of Object.entries(pendingHeights.current)) {
        const pos = updated[hid]
        if (pos && Math.abs(pos.height - h) > 10) {
          updated[hid] = { ...pos, height: h }
          changed = true
        }
      }
      pendingHeights.current = {}
      if (changed) {
        store.setCardPositions(updated)
        scheduleRelayout()
      }
    })
  }, [scheduleRelayout])

  const pendingSizes = useRef<Record<string, { width: number; height: number }>>({})
  const sizeFlushRef = useRef<number>(0)

  const handleSizeMeasured = useCallback((id: string, width: number, height: number) => {
    pendingSizes.current[id] = { width, height }
    cancelAnimationFrame(sizeFlushRef.current)
    sizeFlushRef.current = requestAnimationFrame(() => {
      const store = useGalleryStore.getState()
      let updated = { ...store.cardPositions }
      let changed = false
      for (const [sid, size] of Object.entries(pendingSizes.current)) {
        const pos = updated[sid]
        if (!pos) continue
        const w = Math.max(size.width, 80)
        if (Math.abs(pos.width - w) > 5 || Math.abs(pos.height - size.height) > 10) {
          // Update size in-place, keep position
          updated[sid] = { ...pos, width: w, height: size.height }
          changed = true
        }
      }
      pendingSizes.current = {}
      if (changed) {
        store.setCardPositions(updated)
        scheduleRelayout()
      }
    })
  }, [scheduleRelayout])

  // Track which cards have had their iframe mounted — once mounted, never cull
  // (destroying an iframe = full reload + size re-report = layout cascade)
  const mountedRef = useRef(new Set<string>())

  return (
    <CanvasBoard>
      {(visibleIds) => (
        <>
          {variants.map((variant) => {
            const pos = cardPositions[variant.id]
            if (!pos) return null
            const isDragging = draggingId === variant.id
            const displayX = isDragging && dragPos ? dragPos.x : pos.x
            const displayY = isDragging && dragPos ? dragPos.y : pos.y
            const isVisible = visibleIds.has(variant.id) || isDragging

            // Once a card becomes visible, mark it as mounted forever
            if (isVisible) mountedRef.current.add(variant.id)
            const wasMounted = mountedRef.current.has(variant.id)

            // Only cull cards that were NEVER mounted (lazy loading).
            // Already-mounted cards stay rendered (hidden) to preserve iframes.
            if (!isVisible && !wasMounted) {
              return (
                <div
                  key={variant.id}
                  style={{
                    position: 'absolute',
                    left: pos.x,
                    top: pos.y,
                    width: pos.width,
                    height: pos.height,
                    pointerEvents: 'none',
                  }}
                />
              )
            }
            return (
              <div
                key={variant.id}
                style={{
                  position: 'absolute',
                  left: displayX,
                  top: displayY,
                  width: pos.width,
                  transition: isDragging ? 'none' : 'left 200ms ease-out, top 200ms ease-out',
                  zIndex: isDragging ? 999 : undefined,
                  opacity: isDragging ? 0.9 : 1,
                  cursor: isDragging ? 'grabbing' : 'grab',
                  // Hide off-screen but keep iframe alive
                  visibility: isVisible ? 'visible' : 'hidden',
                }}
                onPointerDown={(e) => handleCardPointerDown(e, variant.id)}
              >
                <GalleryCard
                  variant={variant}
                  isSelected={selectedId === variant.id}
                  isInteracting={interactingId === variant.id}
                  onSelect={() => { if (!didDragRef.current) selectAndNotify(variant) }}
                  onEnterInteract={() => setInteractingId(variant.id)}
                  onExitInteract={() => setInteractingId(null)}
                  onHeightMeasured={handleHeightMeasured}
                  onSizeMeasured={handleSizeMeasured}
                />
              </div>
            )
          })}
        </>
      )}
    </CanvasBoard>
  )
}
