import { useGalleryStore, type GalleryVariant, type DesignSession, type PreviewMode } from '@/stores/gallery'
import { useTerminalStore } from '@/stores/terminal'
import { useTabsStore } from '@/stores/tabs'
import { X, Wand2, FileCode2, ArrowLeftRight, ChevronDown, Zap, AlertCircle, Loader2, RefreshCw, Trash2, Monitor } from 'lucide-react'
import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'
import { CanvasBoard } from './CanvasBoard'
import { reflowColumns, fullRelayout, CARD_WIDTH } from './canvasLayout'

/** Viewport presets for the mode selector */
const VIEWPORT_PRESETS = [
  { label: 'Auto', mode: 'viewport' as PreviewMode, width: 900 },
  { label: 'Intrinsic', mode: 'intrinsic' as PreviewMode, width: 0 },
  { label: '1200', mode: 'viewport' as PreviewMode, width: 1200 },
  { label: '900', mode: 'viewport' as PreviewMode, width: 900 },
  { label: '768', mode: 'viewport' as PreviewMode, width: 768 },
  { label: '375', mode: 'viewport' as PreviewMode, width: 375 },
  { label: 'Fill', mode: 'fill' as PreviewMode, width: 0 },
] as const

/** Bleed padding in px — must match harness BLEED constant */
const BLEED = 32

/** Tiny hover tooltip — shows label immediately below the trigger element */
function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="relative group/tip">
      {children}
      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 bg-black/90 border border-white/10 text-[10px] text-white/90 rounded whitespace-nowrap opacity-0 group-hover/tip:opacity-100 transition-opacity pointer-events-none z-20 shadow-lg">
        {label}
      </div>
    </div>
  )
}

/** Write text into the active terminal and focus it so the user can keep typing */
function typeIntoTerminal(text: string): void {
  const tab = useTabsStore.getState().getActiveTab()
  if (!tab?.ptyId) return
  window.api.pty.write(tab.ptyId, text)
  requestAnimationFrame(() => useTerminalStore.getState().focus())
}

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

/** Default card height before dimensions arrive from iframe */
const DEFAULT_CARD_HEIGHT = 300

// ─── Main Gallery Component ─────────────────────────────────────────────────

export function Gallery() {
  const { variants, viewMode } = useGalleryStore()

  if (variants.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-white/30 text-sm">
        <div className="text-center space-y-3 max-w-[300px]">
          <div className="w-10 h-10 mx-auto rounded-lg bg-white/5 flex items-center justify-center">
            <span className="text-lg">🎨</span>
          </div>
          <p className="font-medium text-white/40">Design Gallery</p>
          <p className="text-xs text-white/20 leading-relaxed">
            Ask Claude to design something and it will add proposals here for you to compare. Try:
          </p>
          <p className="text-[11px] text-[var(--accent-cyan)]/60 font-mono bg-white/5 rounded px-3 py-2">
            &quot;Design 3 variations of a pricing card and add them to the gallery&quot;
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <GalleryToolbar />
      <div className="flex-1 overflow-auto">
        {viewMode === 'grid' && <GridView />}
        {viewMode === 'compare' && <CompareView />}
        {viewMode === 'session' && <SessionView />}
      </div>
    </div>
  )
}

// ─── Toolbar ─────────────────────────────────────────────────────────────────

function GalleryToolbar() {
  const { viewMode, setViewMode, sessions, activeSessionId, setActiveSession, clearAll } = useGalleryStore()
  const [sessionDropdownOpen, setSessionDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!sessionDropdownOpen) return
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setSessionDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [sessionDropdownOpen])

  const activeSession = sessions.find((s) => s.id === activeSessionId)

  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
      {/* View mode toggle */}
      <div className="flex items-center gap-0.5 bg-white/5 rounded-md p-0.5">
        {(['grid', 'compare', 'session'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            className={`px-2.5 py-1 text-[10px] rounded transition-colors ${
              viewMode === mode
                ? 'bg-[var(--accent-cyan)]/15 text-[var(--accent-cyan)]'
                : 'text-white/30 hover:text-white/50'
            }`}
          >
            {mode.charAt(0).toUpperCase() + mode.slice(1)}
          </button>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        <Tip label="Reload gallery">
          <button
            onClick={() => {
              const pp = useGalleryStore.getState().projectPath
              if (pp) useGalleryStore.getState().loadForProject(pp)
            }}
            className="p-1.5 text-white/30 hover:text-white/60 hover:bg-white/5 rounded transition-colors"
          >
            <RefreshCw size={12} />
          </button>
        </Tip>
        <Tip label="Clear all">
          <button
            onClick={clearAll}
            className="p-1.5 text-white/30 hover:text-red-400 hover:bg-white/5 rounded transition-colors"
          >
            <Trash2 size={12} />
          </button>
        </Tip>
      </div>

      {/* Session selector (only in session mode) */}
      {viewMode === 'session' && sessions.length > 0 && (
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setSessionDropdownOpen(!sessionDropdownOpen)}
            className="flex items-center gap-1.5 bg-[var(--bg-primary)] border border-white/10 rounded text-[11px] text-white/60 px-2.5 py-1 hover:border-white/20 transition-colors"
          >
            <span className="truncate max-w-[150px]">
              {activeSession?.title || 'All sessions'}
            </span>
            <ChevronDown size={10} className={`transition-transform ${sessionDropdownOpen ? 'rotate-180' : ''}`} />
          </button>
          {sessionDropdownOpen && (
            <div className="absolute right-0 top-full mt-1 w-64 bg-[var(--bg-secondary)] border border-white/10 rounded-lg shadow-xl z-30 py-1 max-h-60 overflow-auto">
              <button
                onClick={() => { setActiveSession(null); setSessionDropdownOpen(false) }}
                className={`w-full text-left px-3 py-2 text-[11px] hover:bg-white/5 transition-colors ${
                  !activeSessionId ? 'text-[var(--accent-cyan)]' : 'text-white/50'
                }`}
              >
                All sessions
              </button>
              {sessions.map((s) => {
                const variantCount = useGalleryStore.getState().variants.filter(
                  (v) => v.sessionId === s.id
                ).length
                return (
                  <button
                    key={s.id}
                    onClick={() => { setActiveSession(s.id); setSessionDropdownOpen(false) }}
                    className={`w-full text-left px-3 py-2 hover:bg-white/5 transition-colors ${
                      activeSessionId === s.id ? 'bg-white/5' : ''
                    }`}
                  >
                    <div className="text-[11px] text-white/70">{s.title}</div>
                    <div className="flex items-center gap-2 text-[10px] text-white/30 mt-0.5">
                      <span>{variantCount} variant{variantCount !== 1 ? 's' : ''}</span>
                      <span>&middot;</span>
                      <span>{new Date(s.createdAt).toLocaleDateString()}</span>
                      {s.selectedId && (
                        <>
                          <span>&middot;</span>
                          <span className="text-[var(--accent-cyan)]/60">has selection</span>
                        </>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Grid View ───────────────────────────────────────────────────────────────

function GridView() {
  const { variants, selectedId, cardPositions, setCardPosition } = useGalleryStore()
  const [interactingId, setInteractingId] = useState<string | null>(null)

  // ─── Drag state ─────────────────────────────────────────────────────────────
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  const dragStartRef = useRef<{ screenX: number; screenY: number; worldX: number; worldY: number; cardX: number; cardY: number } | null>(null)
  const didDragRef = useRef(false)
  const DRAG_THRESHOLD = 5

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

// ─── Session View ────────────────────────────────────────────────────────────

function SessionHeader({ session }: { session: DesignSession }) {
  const variantCount = useGalleryStore((s) => s.variants.filter((v) => v.sessionId === session.id).length)
  return (
    <div className="mb-4 pb-3 border-b border-white/10">
      <h3 className="text-sm font-medium text-white/80">{session.title}</h3>
      <div className="flex items-center gap-2 mt-1 text-[11px] text-white/30">
        <span>{variantCount} proposal{variantCount !== 1 ? 's' : ''}</span>
        <span>&middot;</span>
        <span>{new Date(session.createdAt).toLocaleDateString()}</span>
        {session.prompt && (
          <>
            <span>&middot;</span>
            <span className="truncate max-w-[200px]">prompt: &quot;{session.prompt}&quot;</span>
          </>
        )}
      </div>
    </div>
  )
}

function SessionView() {
  const { variants, sessions, activeSessionId, selectedId } = useGalleryStore()
  const activeSession = sessions.find((s) => s.id === activeSessionId)

  const displayVariants = activeSession
    ? variants.filter((v) => v.sessionId === activeSession.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    : variants.filter((v) => v.sessionId)

  const handleSelectInSession = (variantId: string) => {
    const variant = displayVariants.find((v) => v.id === variantId)
    if (variant) selectAndNotify(variant)
  }

  if (displayVariants.length === 0) {
    return (
      <div className="p-4 text-center text-white/30 text-sm py-8">
        {activeSession ? 'No variants in this session yet.' : 'No design sessions yet. Start one from Claude Code.'}
      </div>
    )
  }

  const colCount = displayVariants.length <= 2 ? 2 : 3

  return (
    <div className="p-4">
      {activeSession && <SessionHeader session={activeSession} />}
      <div className={`grid gap-4 ${colCount === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {displayVariants.map((variant) => (
          <GalleryCard
            key={variant.id}
            variant={variant}
            isSelected={selectedId === variant.id}
            onSelect={() => handleSelectInSession(variant.id)}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Compare View ────────────────────────────────────────────────────────────

function CompareView() {
  const { compareIds, variants, setCompareIds } = useGalleryStore()
  const [syncScroll, setSyncScroll] = useState(false)
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)

  if (!compareIds) {
    // If no compare pair selected, let user pick two from the list
    return <CompareSelector />
  }

  const [leftVariant, rightVariant] = compareIds.map((id) => variants.find((v) => v.id === id))
  if (!leftVariant || !rightVariant) return null

  const handleScroll = (source: 'left' | 'right') => {
    if (!syncScroll) return
    const from = source === 'left' ? leftRef.current : rightRef.current
    const to = source === 'left' ? rightRef.current : leftRef.current
    if (from && to) to.scrollTop = from.scrollTop
  }

  return (
    <div className="h-full flex flex-col">
      {/* Compare toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSyncScroll(!syncScroll)}
            className={`text-[10px] px-2 py-1 rounded ${
              syncScroll
                ? 'bg-[var(--accent-cyan)]/20 text-[var(--accent-cyan)]'
                : 'text-white/30 hover:text-white/50'
            }`}
          >
            Sync scroll
          </button>
          <button
            onClick={() => setCompareIds([compareIds[1], compareIds[0]])}
            className="text-[10px] text-white/30 hover:text-white/50 px-2 py-1"
          >
            Swap sides
          </button>
          <button
            onClick={() => setCompareIds(null)}
            className="text-[10px] text-white/30 hover:text-white/50 px-2 py-1"
          >
            Change pair
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => selectAndNotify(leftVariant)}
            className="text-[10px] px-3 py-1 rounded bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)] hover:bg-[var(--accent-cyan)]/20"
          >
            Pick left
          </button>
          <button
            onClick={() => selectAndNotify(rightVariant)}
            className="text-[10px] px-3 py-1 rounded bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)] hover:bg-[var(--accent-cyan)]/20"
          >
            Pick right
          </button>
        </div>
      </div>
      {/* Side-by-side iframes */}
      <div className="flex-1 flex gap-px bg-white/5">
        <div ref={leftRef} className="flex-1 overflow-auto p-3" onScroll={() => handleScroll('left')}>
          <GalleryCard
            variant={leftVariant}
            isSelected={leftVariant.status === 'selected'}
            onSelect={() => {}}
          />
        </div>
        <div ref={rightRef} className="flex-1 overflow-auto p-3" onScroll={() => handleScroll('right')}>
          <GalleryCard
            variant={rightVariant}
            isSelected={rightVariant.status === 'selected'}
            onSelect={() => {}}
          />
        </div>
      </div>
    </div>
  )
}

/** Let user pick two variants to compare */
function CompareSelector() {
  const { variants, setCompareIds } = useGalleryStore()
  const [pickedIds, setPickedIds] = useState<string[]>([])

  const toggle = (id: string) => {
    setPickedIds((prev) => {
      if (prev.includes(id)) return prev.filter((p) => p !== id)
      if (prev.length >= 2) return [prev[1], id]
      return [...prev, id]
    })
  }

  useEffect(() => {
    if (pickedIds.length === 2) {
      setCompareIds([pickedIds[0], pickedIds[1]])
    }
  }, [pickedIds, setCompareIds])

  return (
    <div className="p-4">
      <p className="text-[11px] text-white/40 mb-3 flex items-center gap-1.5">
        <ArrowLeftRight size={12} />
        Select two variants to compare side-by-side
      </p>
      <div className="grid grid-cols-3 gap-3">
        {variants.map((v) => (
          <button
            key={v.id}
            onClick={() => toggle(v.id)}
            className={`text-left p-2 rounded-lg border transition-colors ${
              pickedIds.includes(v.id)
                ? 'border-[var(--accent-cyan)] bg-[var(--accent-cyan)]/5'
                : 'border-white/10 hover:border-white/20'
            }`}
          >
            <div className="text-[11px] text-white/60 truncate">{v.label}</div>
            {v.status && (
              <div className="text-[9px] text-white/30 mt-0.5">{v.status}</div>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Gallery Card ────────────────────────────────────────────────────────────

function GalleryCard({
  variant,
  isSelected,
  onSelect,
  onHeightMeasured,
  onSizeMeasured,
  isInteracting = false,
  onEnterInteract,
  onExitInteract,
}: {
  variant: GalleryVariant
  isSelected: boolean
  isInteracting?: boolean
  onSelect: () => void
  onEnterInteract?: () => void
  onExitInteract?: () => void
  onHeightMeasured?: (id: string, height: number) => void
  onSizeMeasured?: (id: string, width: number, height: number) => void
}) {
  const { removeVariant, updateVariant } = useGalleryStore()
  const [iframeError, setIframeError] = useState(false)
  const [hmrFlash, setHmrFlash] = useState(false)
  // Stage dimensions (full iframe size including viewport + bleed)
  const [stageHeight, setStageHeight] = useState(DEFAULT_CARD_HEIGHT)
  const [stageWidth, setStageWidth] = useState<number | null>(null)
  // Root content dimensions (actual component rendered size)
  const [rootWidth, setRootWidth] = useState<number | null>(null)
  const [rootHeight, setRootHeight] = useState<number | null>(null)
  const [modeDropdownOpen, setModeDropdownOpen] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Effective mode and viewport width for this card
  const effectiveMode: PreviewMode = variant.previewMode || 'viewport'
  const effectiveVW = variant.viewportWidth || 900

  // Close mode dropdown on outside click
  useEffect(() => {
    if (!modeDropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setModeDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [modeDropdownOpen])

  /** Send a mode change command to the iframe harness */
  const sendModeToIframe = useCallback((mode: PreviewMode, vw?: number) => {
    iframeRef.current?.contentWindow?.postMessage({
      type: 'CANVAS_SET_MODE',
      mode,
      viewportWidth: vw,
    }, '*')
  }, [])

  /** Handle mode preset selection */
  const handleModeChange = useCallback((preset: typeof VIEWPORT_PRESETS[number]) => {
    const mode = preset.mode
    const vw = preset.mode === 'viewport' ? preset.width : undefined
    updateVariant(variant.id, { previewMode: mode, viewportWidth: vw })
    sendModeToIframe(mode, vw)
    setModeDropdownOpen(false)
  }, [variant.id, updateVariant, sendModeToIframe])

  /** Build the preview URL with mode params */
  const previewSrc = variant.previewUrl
    ? `${variant.previewUrl}&mode=${effectiveMode}${effectiveMode === 'viewport' ? '&vw=' + effectiveVW : ''}`
    : undefined

  // Measure iframe content for static srcdoc cards (no postMessage)
  const measureHeight = useCallback(() => {
    if (variant.previewUrl) return
    const iframe = iframeRef.current
    if (!iframe) return
    try {
      const doc = iframe.contentDocument
      if (!doc?.body) return
      const h = Math.max(doc.body.scrollHeight, doc.documentElement?.scrollHeight || 0)
      const w = Math.max(doc.body.scrollWidth, doc.documentElement?.scrollWidth || 0)
      if (h > 0) {
        setStageHeight(h)
        setRootHeight(h)
        if (w > 0) { setStageWidth(w); setRootWidth(w) }
        if (w > 0) {
          onSizeMeasured?.(variant.id, w, h)
        } else {
          onHeightMeasured?.(variant.id, h)
        }
      }
    } catch { /* cross-origin fallback */ }
  }, [variant.id, variant.previewUrl, onHeightMeasured, onSizeMeasured])

  // Re-measure srcdoc after CSS animations settle
  useEffect(() => {
    if (variant.previewUrl) return
    const timer = setTimeout(measureHeight, 400)
    return () => clearTimeout(timer)
  }, [measureHeight, variant.html, variant.previewUrl])

  // ─── postMessage listener: canvas:* protocol ───────────────────────────────
  useEffect(() => {
    if (!variant.previewUrl) return
    const handler = (event: MessageEvent) => {
      if (!event.origin.startsWith('http://localhost') &&
          !event.origin.startsWith('http://127.0.0.1')) return
      if (iframeRef.current?.contentWindow !== event.source) return
      const { type } = event.data || {}
      if (!type?.startsWith('canvas:')) return

      if (type === 'canvas:ready') {
        // Harness is ready — could use capabilities in the future
      }
      if (type === 'canvas:status') {
        updateVariant(variant.id, {
          previewStatus: event.data.state,
          previewError: undefined,
        })
      }
      if (type === 'canvas:error') {
        updateVariant(variant.id, {
          previewStatus: 'error',
          previewError: event.data.message,
        })
      }
      if (type === 'canvas:hmr-update') {
        setHmrFlash(true)
        setTimeout(() => setHmrFlash(false), 600)
      }
      if (type === 'canvas:size') {
        // Stage = full container (#stage: viewport + bleed padding)
        const sw = event.data.width || 0
        const sh = Math.max(60, event.data.height || 0)
        // Root = actual rendered component content (#root element bounds)
        // contentWidth/Height come from Range measurement — 0 means no content yet
        const cw = event.data.contentWidth || 0
        const ch = event.data.contentHeight || 0

        setStageWidth(sw)
        setStageHeight(sh)
        // Only set root dims when we have actual content measurements (>0).
        // When 0, leave rootWidth/rootHeight as null so clipWidth falls back to iframe size.
        if (cw > 0) setRootWidth(cw)
        if (ch > 0) setRootHeight(ch)

        // Card size = content bounds + bleed padding (so shadows/glows show)
        // This makes buttons get small cards, heroes get wide cards.
        // Only use content dims if available, otherwise skip width update.
        if (cw > 0) {
          const cardW = cw + BLEED * 2
          const cardH = (ch || sh) + BLEED * 2
          onSizeMeasured?.(variant.id, cardW, cardH)
        } else if (sh > 0) {
          onHeightMeasured?.(variant.id, sh)
        }
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [variant.id, variant.previewUrl, variant.previewMode, updateVariant, onHeightMeasured, onSizeMeasured, sendModeToIframe])

  const srcdoc = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          html { height: auto !important; min-height: 0 !important; background: transparent !important; overflow: visible; }
          body { margin: 0; padding: 16px; font-family: system-ui, sans-serif; height: auto !important; min-height: 0 !important; background: transparent !important; display: inline-block; overflow: visible; }
          ${variant.css || ''}
        </style>
      </head>
      <body>${variant.html}</body>
    </html>
  `

  // ─── Iframe + clip sizing ────────────────────────────────────────────────────
  // The iframe renders at FULL stage size (viewport + bleed) so w-full components
  // lay out correctly. But the visible card is CLIPPED to the content bounds + bleed,
  // so buttons get small cards and heroes get wide cards.
  let iframeWidth: number
  if (effectiveMode === 'intrinsic') {
    iframeWidth = stageWidth || 1200
  } else if (effectiveMode === 'viewport') {
    iframeWidth = stageWidth || (effectiveVW + BLEED * 2)
  } else {
    iframeWidth = stageWidth || 800
  }
  const iframeHeight = stageHeight

  // Clip = content bounds + bleed (this determines the visible card area)
  // Before measurements arrive, use the full iframe size
  const clipWidth = rootWidth ? rootWidth + BLEED * 2 : iframeWidth
  const clipHeight = rootHeight ? rootHeight + BLEED * 2 : iframeHeight

  // Mode label for the selector button
  const modeLabel = !variant.previewMode ? 'Auto'
    : effectiveMode === 'intrinsic' ? 'Intrinsic'
    : effectiveMode === 'fill' ? 'Fill'
    : `${effectiveVW}px`

  return (
    <div
      ref={containerRef}
      onClick={onSelect}
      className={`group relative cursor-pointer transition-shadow ${
        isInteracting
          ? 'ring-2 ring-[var(--accent-cyan)] shadow-[0_0_30px_rgba(74,234,255,0.25)]'
          : isSelected
            ? 'ring-2 ring-[var(--accent-cyan)] shadow-[0_0_20px_rgba(74,234,255,0.15)]'
            : 'hover:shadow-[0_8px_30px_rgba(0,0,0,0.4)]'
      }`}
      style={{ borderRadius: 0 }}
    >
      {/* Preview area — clips to content bounds + bleed so card is tight-fit.
           The iframe renders at full viewport width for correct layout,
           but only the content region is visible. */}
      <div
        className="relative"
        style={{
          width: clipWidth,
          height: clipHeight,
          background: 'transparent',
          overflow: 'hidden',
        }}
      >
        {/* Status badge */}
        {variant.status && variant.status !== 'proposal' && (
          <div className={`absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-medium z-10 ${
            variant.status === 'selected' ? 'bg-[var(--accent-cyan)]/90 text-black' :
            variant.status === 'applied' ? 'bg-emerald-500/90 text-white' :
            variant.status === 'rejected' ? 'bg-red-500/80 text-white' : ''
          }`}>
            {variant.status === 'selected' ? 'Selected' :
             variant.status === 'applied' ? 'Applied' :
             variant.status === 'rejected' ? 'Rejected' : variant.status}
          </div>
        )}

        {/* Preview status indicators */}
        {variant.previewStatus === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
            <Loader2 size={20} className="animate-spin text-gray-400" />
          </div>
        )}
        {variant.previewStatus === 'error' && (
          <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/90 text-white text-[10px] font-medium z-10">
            <AlertCircle size={10} />
            Error
          </div>
        )}
        {hmrFlash && (
          <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/90 text-white text-[10px] font-medium z-10 animate-pulse">
            <Zap size={10} />
            HMR
          </div>
        )}

        {iframeError ? (
          <div className="flex items-center justify-center text-gray-400 text-xs p-4" style={{ height: clipHeight }}>
            Failed to render preview
          </div>
        ) : (
          <>
            <iframe
              ref={iframeRef}
              onLoad={() => { setIframeError(false); measureHeight() }}
              onError={() => setIframeError(true)}
              {...(previewSrc
                ? { src: previewSrc }
                : { srcDoc: srcdoc }
              )}
              style={{
                display: 'block',
                width: iframeWidth,
                height: iframeHeight,
                border: 'none',
                background: 'transparent',
              }}
              title={variant.label}
              sandbox="allow-same-origin allow-scripts"
            />
            {/* Navigate mode: overlay captures events for pan/zoom.
                Interact mode: overlay removed so iframe gets pointer events. */}
            {!isInteracting && (
              <div
                className="absolute inset-0 z-[5]"
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  onEnterInteract?.()
                }}
              />
            )}
            {isInteracting && (
              <div className="absolute top-1 right-1 z-10 px-2 py-0.5 rounded bg-black/70 text-[10px] text-white/70 pointer-events-none">
                Esc to exit
              </div>
            )}
          </>
        )}

        {/* Annotations overlay — shown on hover */}
        {variant.annotations && variant.annotations.length > 0 && (
          <div className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
            {variant.annotations.map((ann, i) => (
              <div
                key={i}
                className="absolute pointer-events-auto"
                style={{ left: `${ann.x}%`, top: `${ann.y}%` }}
              >
                <div
                  className={`px-2 py-1 rounded-full text-[9px] font-medium shadow-lg whitespace-nowrap ${
                    ann.color ? '' : 'bg-[var(--accent-cyan)] text-black'
                  }`}
                  style={ann.color ? { backgroundColor: ann.color, color: '#000' } : undefined}
                >
                  {ann.label}
                </div>
              </div>
            ))}
          </div>
        )}

      </div>

      {/* Floating toolbar — appears above the card on hover */}
      <div className="absolute -top-8 left-1/2 -translate-x-1/2 flex items-center gap-0.5 px-1.5 py-1 rounded-lg bg-black/80 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity z-20 whitespace-nowrap">
        {/* Mode selector — only for live previews */}
        {variant.previewUrl && (
          <div ref={dropdownRef} className="relative">
            <Tip label="Preview mode">
              <button
                onClick={(e) => { e.stopPropagation(); setModeDropdownOpen(!modeDropdownOpen) }}
                className="flex items-center gap-0.5 p-1 hover:bg-white/20 rounded text-white/70 transition-colors text-[9px]"
              >
                <Monitor size={10} />
                <span>{modeLabel}</span>
                <ChevronDown size={8} className={modeDropdownOpen ? 'rotate-180' : ''} />
              </button>
            </Tip>
            {modeDropdownOpen && (
              <div
                className="absolute top-full left-0 mt-1 w-28 bg-black/90 border border-white/10 rounded-lg shadow-xl z-30 py-1"
                onClick={(e) => e.stopPropagation()}
              >
                {VIEWPORT_PRESETS.map((preset) => {
                  const isActive = preset.label === 'Auto' ? !variant.previewMode
                    : preset.mode === effectiveMode && (preset.mode !== 'viewport' || preset.width === effectiveVW)
                  return (
                    <button
                      key={preset.label}
                      onClick={() => handleModeChange(preset)}
                      className={`w-full text-left px-3 py-1.5 text-[10px] hover:bg-white/10 transition-colors ${
                        isActive ? 'text-[var(--accent-cyan)]' : 'text-white/60'
                      }`}
                    >
                      {preset.label}
                      {preset.mode === 'viewport' && preset.width > 0 && (
                        <span className="text-white/30 ml-1">px</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Iterate — create a new gallery variant with changes (don't touch source) */}
        <Tip label="Iterate design">
          <button
            onClick={async (e) => {
              e.stopPropagation()
              const projectPath = useGalleryStore.getState().projectPath
              const cp = variant.componentPath
              if (cp && projectPath) {
                const fullPath = `${projectPath}/${cp}`
                const src = await window.api.fs.readFile(fullPath)
                if (src) {
                  const lines = src.split('\n')
                  const sig = lines.filter(l =>
                    /^\s*(import |export |function |const |interface |type |class )/.test(l)
                  ).slice(0, 15).join('\n')
                  typeIntoTerminal(
                    `Create a new gallery variant based on "${variant.label}" (${cp}, ${lines.length} lines). Signature:\n${sig}\n\nDo NOT modify the original file. Use canvas_add_to_gallery to add the new design. Change: `
                  )
                  return
                }
              }
              typeIntoTerminal(
                `Create a new gallery variant based on "${variant.label}". Do NOT modify the original file. Use canvas_add_to_gallery to add the new design. Change: `
              )
            }}
            className="p-1 hover:bg-[var(--accent-cyan)] rounded text-white/70 hover:text-black transition-colors"
          >
            <Wand2 size={11} />
          </button>
        </Tip>

        {/* Apply — write the selected design into the actual source file */}
        {variant.componentPath && (
          <Tip label="Apply to project">
            <button
              onClick={(e) => {
                e.stopPropagation()
                typeIntoTerminal(
                  `Apply the "${variant.label}" gallery design to the project. Read ${variant.componentPath} and update it to match this design.\n`
                )
              }}
              className="p-1 hover:bg-emerald-500 rounded text-white/70 hover:text-white transition-colors"
            >
              <FileCode2 size={11} />
            </button>
          </Tip>
        )}

        {/* Delete */}
        <Tip label="Delete">
          <button
            onClick={(e) => { e.stopPropagation(); removeVariant(variant.id) }}
            className="p-1 hover:bg-red-500 rounded text-white/70 hover:text-white transition-colors"
          >
            <X size={11} />
          </button>
        </Tip>
      </div>

      {/* Floating label — bottom-left on hover */}
      <div className="absolute bottom-1 left-1 px-2 py-0.5 rounded bg-black/60 text-[10px] text-white/70 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 truncate max-w-[90%] backdrop-blur-sm">
        {variant.label}
      </div>
    </div>
  )
}
