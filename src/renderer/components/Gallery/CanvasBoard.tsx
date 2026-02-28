import { useRef, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import { useGalleryStore } from '@/stores/gallery'
import { autoLayout } from './canvasLayout'
import { ZoomIn, ZoomOut, Maximize, Hand } from 'lucide-react'

const MIN_ZOOM = 0.1
const MAX_ZOOM = 3
const ZOOM_SENSITIVITY = 0.005 // For smooth pinch/ctrl+scroll zoom
const ZOOM_STEP = 0.15         // For button/keyboard discrete zoom

export function CanvasBoard({ children }: { children: (visibleIds: Set<string>) => ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { viewport, setViewport, variants, cardPositions, setCardPositions } = useGalleryStore()
  const { panX, panY, zoom } = viewport

  // Pan state
  const [isPanning, setIsPanning] = useState(false)
  const panStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)

  // Space key held = pan mode (hand tool)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const spaceRef = useRef(false) // Ref mirror for event handlers

  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })

  // ─── Container size tracking ──────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver(([entry]) => {
      setContainerSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      })
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  // ─── Auto-layout new cards ────────────────────────────────────────────────
  useEffect(() => {
    const ids = variants.map((v) => v.id)
    const current = useGalleryStore.getState().cardPositions
    const hasNew = ids.some((id) => !current[id])
    if (hasNew) {
      const newPositions = autoLayout(ids, current, {})
      setCardPositions(newPositions)
    }
  }, [variants, setCardPositions])

  // ─── Viewport culling ─────────────────────────────────────────────────────
  const visibleIds = useMemo(() => {
    const ids = new Set<string>()
    const viewLeft = -panX / zoom
    const viewTop = -panY / zoom
    const viewRight = viewLeft + containerSize.width / zoom
    const viewBottom = viewTop + containerSize.height / zoom
    const MARGIN = 200

    for (const [id, pos] of Object.entries(cardPositions)) {
      if (
        pos.x + pos.width >= viewLeft - MARGIN &&
        pos.x <= viewRight + MARGIN &&
        pos.y + pos.height >= viewTop - MARGIN &&
        pos.y <= viewBottom + MARGIN
      ) {
        ids.add(id)
      }
    }
    return ids
  }, [panX, panY, zoom, containerSize, cardPositions])

  // ─── Zoom helpers (read from store for stable callbacks) ──────────────────

  /** Zoom toward a specific screen-space point */
  const zoomToward = useCallback((screenX: number, screenY: number, newZoom: number) => {
    const { panX, panY, zoom } = useGalleryStore.getState().viewport
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newZoom))
    // World point under cursor stays fixed
    const wx = (screenX - panX) / zoom
    const wy = (screenY - panY) / zoom
    useGalleryStore.getState().setViewport({
      zoom: clamped,
      panX: screenX - wx * clamped,
      panY: screenY - wy * clamped,
    })
  }, [])

  /** Zoom toward center of viewport by a discrete step */
  const zoomIn = useCallback(() => {
    const { zoom } = useGalleryStore.getState().viewport
    zoomToward(containerSize.width / 2, containerSize.height / 2, zoom + ZOOM_STEP)
  }, [containerSize, zoomToward])

  const zoomOut = useCallback(() => {
    const { zoom } = useGalleryStore.getState().viewport
    zoomToward(containerSize.width / 2, containerSize.height / 2, zoom - ZOOM_STEP)
  }, [containerSize, zoomToward])

  /** Zoom to exactly 100%, centered on current view center */
  const zoomTo100 = useCallback(() => {
    const { panX, panY, zoom } = useGalleryStore.getState().viewport
    const cx = containerSize.width / 2
    const cy = containerSize.height / 2
    const wx = (cx - panX) / zoom
    const wy = (cy - panY) / zoom
    setViewport({ zoom: 1, panX: cx - wx, panY: cy - wy })
  }, [containerSize, setViewport])

  const fitAll = useCallback(() => {
    const positions = Object.values(useGalleryStore.getState().cardPositions)
    if (positions.length === 0) return
    const minX = Math.min(...positions.map((p) => p.x))
    const minY = Math.min(...positions.map((p) => p.y))
    const maxX = Math.max(...positions.map((p) => p.x + p.width))
    const maxY = Math.max(...positions.map((p) => p.y + p.height))
    const PAD = 48
    const worldW = maxX - minX + PAD * 2
    const worldH = maxY - minY + PAD * 2
    const newZoom = Math.max(MIN_ZOOM, Math.min(1, containerSize.width / worldW, containerSize.height / worldH))
    setViewport({
      zoom: newZoom,
      panX: (containerSize.width - worldW * newZoom) / 2 - (minX - PAD) * newZoom,
      panY: (containerSize.height - worldH * newZoom) / 2 - (minY - PAD) * newZoom,
    })
  }, [containerSize, setViewport])

  // ─── Pointer events: pan via middle-click or Space+left-click ─────────────

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Middle button → always pan
    // Left button + Space held → pan
    // Left button on canvas background (no Space) → deselect (handled by card onClick absence)
    const shouldPan = e.button === 1 || (e.button === 0 && spaceRef.current)

    if (shouldPan) {
      const { panX, panY } = useGalleryStore.getState().viewport
      setIsPanning(true)
      panStart.current = { x: e.clientX, y: e.clientY, panX, panY }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      e.preventDefault()
    }
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!panStart.current) return
    const dx = e.clientX - panStart.current.x
    const dy = e.clientY - panStart.current.y
    useGalleryStore.getState().setViewport({
      panX: panStart.current.panX + dx,
      panY: panStart.current.panY + dy,
    })
  }, [])

  const handlePointerUp = useCallback(() => {
    setIsPanning(false)
    panStart.current = null
  }, [])

  // ─── Wheel: bare scroll = pan, Ctrl/Cmd+scroll or pinch = zoom ────────────

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const handler = (e: WheelEvent) => {
      e.preventDefault()

      const isZoomGesture = e.ctrlKey || e.metaKey

      if (isZoomGesture) {
        // Zoom toward cursor
        const rect = el.getBoundingClientRect()
        const cursorX = e.clientX - rect.left
        const cursorY = e.clientY - rect.top
        const { zoom } = useGalleryStore.getState().viewport

        // Pinch-to-zoom on trackpad sends small deltaY values with ctrlKey
        // Cmd+scroll sends larger discrete values
        // Use exponential zoom for smooth feel
        const factor = Math.exp(-e.deltaY * ZOOM_SENSITIVITY)
        const newZoom = zoom * factor

        zoomToward(cursorX, cursorY, newZoom)
      } else {
        // Pan — translate by scroll delta
        const { panX, panY } = useGalleryStore.getState().viewport
        useGalleryStore.getState().setViewport({
          panX: panX - e.deltaX,
          panY: panY - e.deltaY,
        })
      }
    }

    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [zoomToward])

  // ─── Space key for hand tool ──────────────────────────────────────────────

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input or terminal
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if ((e.target as HTMLElement).closest('.xterm')) return

      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault()
        spaceRef.current = true
        setSpaceHeld(true)
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceRef.current = false
        setSpaceHeld(false)
      }
    }

    // Listen on window so Space works even when canvas isn't focused
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  // ─── Keyboard shortcuts (Cmd+0, Cmd+1, Cmd++, Cmd+-, Delete) ─────────────

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.tabIndex = 0

    const handler = (e: KeyboardEvent) => {
      const htag = (e.target as HTMLElement).tagName
      if (htag === 'INPUT' || htag === 'TEXTAREA') return
      if ((e.target as HTMLElement).closest('.xterm')) return
      const mod = e.metaKey || e.ctrlKey

      // Cmd+0 → fit all
      if (mod && e.key === '0') {
        e.preventDefault()
        fitAll()
        return
      }

      // Cmd+1 → zoom to 100%
      if (mod && e.key === '1') {
        e.preventDefault()
        zoomTo100()
        return
      }

      // Cmd++ → zoom in
      if (mod && (e.key === '+' || e.key === '=')) {
        e.preventDefault()
        zoomIn()
        return
      }

      // Cmd+- → zoom out
      if (mod && e.key === '-') {
        e.preventDefault()
        zoomOut()
        return
      }

      // Delete/Backspace → delete selected card
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const selectedId = useGalleryStore.getState().selectedId
        if (selectedId) {
          e.preventDefault()
          useGalleryStore.getState().removeVariant(selectedId)
        }
      }
    }

    el.addEventListener('keydown', handler)
    return () => el.removeEventListener('keydown', handler)
  }, [fitAll, zoomTo100, zoomIn, zoomOut])

  // ─── Auto-fit on first render ─────────────────────────────────────────────

  const didAutoFit = useRef(false)
  const projectPath = useGalleryStore((s) => s.projectPath)
  useEffect(() => { didAutoFit.current = false }, [projectPath])
  useEffect(() => {
    if (didAutoFit.current) return
    const posCount = Object.keys(cardPositions).length
    if (posCount > 0 && containerSize.width > 0) {
      didAutoFit.current = true
      // Small delay to let layout settle
      requestAnimationFrame(() => fitAll())
    }
  }, [cardPositions, containerSize, fitAll])

  // ─── Cursor logic ─────────────────────────────────────────────────────────
  let cursor = 'default'
  if (isPanning) cursor = 'grabbing'
  else if (spaceHeld) cursor = 'grab'

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden outline-none"
      style={{
        cursor,
        background: '#18181B',
        backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)',
        backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
        backgroundPosition: `${panX}px ${panY}px`,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* World-space transform layer */}
      <div
        style={{
          transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
          transformOrigin: '0 0',
          position: 'absolute',
          top: 0,
          left: 0,
        }}
      >
        {children(visibleIds)}
      </div>

      {/* Zoom controls HUD — bottom-right */}
      <div className="absolute bottom-3 right-3 flex items-center gap-0.5 bg-black/70 backdrop-blur-md border border-white/10 rounded-lg px-1.5 py-1 z-10 select-none">
        <button
          onClick={zoomOut}
          className="p-1.5 hover:bg-white/10 rounded text-white/50 hover:text-white/80 transition-colors"
          title="Zoom out (Cmd+-)"
        >
          <ZoomOut size={14} />
        </button>
        <button
          onClick={zoomTo100}
          className="text-[11px] text-white/50 hover:text-white/80 min-w-[44px] text-center font-mono px-1 py-0.5 hover:bg-white/10 rounded transition-colors"
          title="Zoom to 100% (Cmd+1)"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          onClick={zoomIn}
          className="p-1.5 hover:bg-white/10 rounded text-white/50 hover:text-white/80 transition-colors"
          title="Zoom in (Cmd++)"
        >
          <ZoomIn size={14} />
        </button>
        <div className="w-px h-4 bg-white/10 mx-0.5" />
        <button
          onClick={fitAll}
          className="p-1.5 hover:bg-white/10 rounded text-white/50 hover:text-white/80 transition-colors"
          title="Fit all (Cmd+0)"
        >
          <Maximize size={14} />
        </button>
      </div>

      {/* Hand tool indicator — shows when Space is held */}
      {spaceHeld && !isPanning && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-black/70 backdrop-blur-md border border-white/10 rounded-lg px-3 py-1.5 z-10 pointer-events-none select-none">
          <Hand size={14} className="text-white/60" />
          <span className="text-[11px] text-white/50">Drag to pan</span>
        </div>
      )}
    </div>
  )
}
