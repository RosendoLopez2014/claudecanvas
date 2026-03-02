# Zoomable Timeline Canvas with Push Divider

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert the Timeline from a flat horizontal scroll to a zoomable/pannable canvas (matching Gallery controls) and add a visual divider showing pushed vs unpushed commits.

**Architecture:** Replace the `overflow-x-auto` flex layout with a CSS transform-based canvas (`translate + scale`). Cards are positioned absolutely in world-space. Pan via scroll/drag, zoom via Ctrl+scroll. A dashed vertical divider line separates pushed from unpushed commits, derived from the tab's `gitAhead` count.

**Tech Stack:** React 19, Zustand (read `gitAhead` from tabs store), CSS transforms, pointer/wheel events.

---

### Task 1: Add viewport state and horizontal layout computation

**Files:**
- Modify: `src/renderer/components/CheckpointTimeline/Timeline.tsx`

**What:** Add local viewport state (panX, panY, zoom) and compute card positions horizontally. No visual changes yet — just the data model.

**Step 1: Add constants and viewport state at top of Timeline component**

After the existing state declarations (`rollbackTarget`, etc.), add:

```typescript
// ─── Canvas constants ────────────────────────────────────────────────
const MIN_ZOOM = 0.1
const MAX_ZOOM = 3
const ZOOM_SENSITIVITY = 0.005
const ZOOM_STEP = 0.15
const CARD_W = 200
const CARD_GAP = 40
const DIVIDER_W = 80
```

Inside the `Timeline` component, after `const timelineOrder = ...`:

```typescript
// ─── Canvas viewport state ───────────────────────────────────────────
const [panX, setPanX] = useState(0)
const [panY, setPanY] = useState(0)
const [zoom, setZoom] = useState(1)
const containerRef = useRef<HTMLDivElement>(null)
const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })

const setViewport = useCallback((v: { panX?: number; panY?: number; zoom?: number }) => {
  if (v.panX !== undefined) setPanX(v.panX)
  if (v.panY !== undefined) setPanY(v.panY)
  if (v.zoom !== undefined) setZoom(v.zoom)
}, [])

// Track container size
useEffect(() => {
  if (!containerRef.current) return
  const observer = new ResizeObserver(([entry]) => {
    setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height })
  })
  observer.observe(containerRef.current)
  return () => observer.disconnect()
}, [])
```

**Step 2: Compute card positions and divider placement**

```typescript
// ─── Push divider: how many commits are ahead of remote ──────────────
const gitAhead = currentTab?.gitAhead ?? 0

// ─── Horizontal layout ───────────────────────────────────────────────
const { cardPositions, dividerX, totalWidth } = useMemo(() => {
  const positions: Record<string, { x: number; y: number }> = {}
  const dividerIndex = gitAhead > 0 ? timelineOrder.length - gitAhead : -1
  let x = 0
  let dX = -1

  for (let i = 0; i < timelineOrder.length; i++) {
    if (i === dividerIndex) {
      dX = x + CARD_GAP / 2
      x += DIVIDER_W
    }
    positions[timelineOrder[i].hash] = { x, y: 0 }
    x += CARD_W + CARD_GAP
  }
  return { cardPositions: positions, dividerX: dX, totalWidth: x - CARD_GAP }
}, [timelineOrder, gitAhead])
```

**Step 3: Verify** — Run `npx tsc --noEmit`. Expect clean compile. The new state/computed values are declared but not rendered yet.

---

### Task 2: Replace the scroll layout with a canvas transform container

**Files:**
- Modify: `src/renderer/components/CheckpointTimeline/Timeline.tsx`

**What:** Replace the `overflow-x-auto` flex container with a canvas that uses CSS transforms. Cards render at their computed positions.

**Step 1: Replace the timeline body**

Replace the current body (the `<div className="flex-1 overflow-x-auto ...">` block and its children) with:

```tsx
{/* Canvas */}
<div
  ref={containerRef}
  className="flex-1 relative overflow-hidden outline-none"
  style={{
    cursor: isPanning ? 'grabbing' : spaceHeld ? 'grab' : 'default',
    background: '#0e0e1a',
    backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)',
    backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
    backgroundPosition: `${panX}px ${panY}px`,
  }}
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
    {/* Push divider */}
    {dividerX >= 0 && (
      <div
        className="absolute flex flex-col items-center gap-1"
        style={{ left: dividerX, top: -20, width: 0, height: 'calc(100% + 40px)' }}
      >
        <span className="text-[9px] text-amber-400/70 whitespace-nowrap bg-[#0e0e1a] px-1.5 py-0.5 rounded">
          {gitAhead} unpushed
        </span>
        <div className="flex-1 border-l border-dashed border-amber-400/30" />
        <span className="text-[9px] text-white/20 whitespace-nowrap bg-[#0e0e1a] px-1.5 py-0.5 rounded">
          pushed
        </span>
      </div>
    )}

    {/* Checkpoint cards */}
    {timelineOrder.map((cp, i) => {
      const pos = cardPositions[cp.hash]
      if (!pos) return null
      const sel = getSelectionState(cp.hash)
      const isLatest = i === timelineOrder.length - 1
      const isUnpushed = gitAhead > 0 && i >= timelineOrder.length - gitAhead
      const cleanMessage = cp.message.replace('[checkpoint] ', '')

      let borderColor: string
      let iconColor: string
      if (sel === 'before') {
        borderColor = 'border-amber-400 bg-amber-400/10'
        iconColor = 'text-amber-400'
      } else if (sel === 'after') {
        borderColor = 'border-[var(--accent-cyan)] bg-[var(--accent-cyan)]/10'
        iconColor = 'text-[var(--accent-cyan)]'
      } else if (isUnpushed) {
        borderColor = 'border-amber-400/30 bg-[var(--bg-tertiary)]'
        iconColor = 'text-amber-400/60'
      } else {
        borderColor = 'border-white/10 hover:border-white/20 bg-[var(--bg-tertiary)]'
        iconColor = 'text-white/40'
      }

      return (
        <motion.div
          key={cp.hash}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.03 }}
          onClick={() => handleClick(cp.hash)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(cp.hash) }}
          className={`group absolute flex flex-col gap-1.5 p-3 rounded-lg border transition cursor-pointer ${borderColor}`}
          style={{ left: pos.x, top: pos.y, width: CARD_W }}
        >
          {/* Selection badge */}
          {sel && (
            <span className={`absolute -top-2 left-1/2 -translate-x-1/2 text-[9px] font-semibold px-1.5 py-0.5 rounded ${
              sel === 'before' ? 'bg-amber-400 text-black' : 'bg-[var(--accent-cyan)] text-black'
            }`}>
              {sel === 'before' ? 'Before' : 'After'}
            </span>
          )}

          {/* Latest badge */}
          {isLatest && !sel && (
            <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[9px] font-medium px-1.5 py-0.5 rounded bg-green-500/80 text-black">
              Latest
            </span>
          )}

          {/* Connector line to previous card */}
          {i > 0 && (
            <div
              className="absolute bg-white/10"
              style={{ right: '100%', top: '50%', width: CARD_GAP, height: 1 }}
            />
          )}

          {/* Header: icon + message */}
          <div className="flex items-start gap-2">
            <GitCommit size={14} className={`${iconColor} mt-0.5 flex-shrink-0`} />
            <span className="text-[11px] text-white/70 leading-tight line-clamp-2 font-medium">
              {cleanMessage}
            </span>
          </div>

          {/* Stats row */}
          {(cp.filesChanged > 0 || cp.insertions > 0 || cp.deletions > 0) && (
            <div className="flex items-center gap-2 text-[9px] font-mono ml-[22px]">
              <span className="text-white/30">{cp.filesChanged} file{cp.filesChanged !== 1 ? 's' : ''}</span>
              {cp.insertions > 0 && <span className="text-green-400">+{cp.insertions}</span>}
              {cp.deletions > 0 && <span className="text-red-400">-{cp.deletions}</span>}
            </div>
          )}

          {/* File list */}
          {cp.files.length > 0 && (
            <div className="ml-[22px] space-y-0.5">
              {cp.files.map((file) => (
                <div key={file} className="flex items-center gap-1 text-[9px] text-white/25 truncate">
                  <FileText size={8} className="flex-shrink-0" />
                  <span className="truncate">{file.split('/').pop()}</span>
                </div>
              ))}
              {cp.filesChanged > 5 && (
                <span className="text-[9px] text-white/20 ml-3">+{cp.filesChanged - 5} more</span>
              )}
            </div>
          )}

          {/* Visual diff badge */}
          {visualDiffs.has(cp.hash) && visualDiffs.get(cp.hash) !== null && (
            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded self-start ml-[22px] ${
              (visualDiffs.get(cp.hash)!) > 5 ? 'bg-orange-400/10 text-orange-400' : 'bg-green-400/10 text-green-400'
            }`}>
              {visualDiffs.get(cp.hash)!.toFixed(1)}% visual change
            </span>
          )}

          {/* Timestamp + author */}
          <div className="flex items-center justify-between ml-[22px] mt-0.5">
            <span className="text-[9px] text-white/25">
              {new Date(cp.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span className="text-[9px] text-white/20 truncate max-w-[60px]">{cp.author}</span>
          </div>

          {/* Rollback button */}
          {rollbackTarget === cp.hash ? (
            <span className="text-[9px] text-yellow-400 animate-pulse ml-[22px]">Rolling back...</span>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation()
                if (confirm(`Rollback to "${cleanMessage}"?\nThis will discard all changes after this point.`))
                  handleRollback(cp.hash, cp.message)
              }}
              className="opacity-0 group-hover:opacity-100 flex items-center gap-1 text-[9px] text-white/30 hover:text-orange-400 transition-all ml-[22px]"
            >
              <RotateCcw size={9} /> Rollback
            </button>
          )}

          {/* Short hash */}
          <span className="text-[8px] text-white/15 font-mono ml-[22px]">{cp.hash.slice(0, 7)}</span>
        </motion.div>
      )
    })}
  </div>
</div>
```

Also add the missing state declarations near the other state:
```typescript
const [isPanning, setIsPanning] = useState(false)
const [spaceHeld, setSpaceHeld] = useState(false)
const spaceRef = useRef(false)
```

**Step 2: Add imports** — Add `useRef, useMemo` to the React import (already has `useEffect, useState, useCallback`). Add `ZoomIn, ZoomOut, Maximize, Hand` to lucide-react imports.

**Step 3: Verify** — `npx tsc --noEmit` clean. Cards should render at their positions but no pan/zoom interaction yet.

---

### Task 3: Add wheel and pointer event handlers for pan/zoom

**Files:**
- Modify: `src/renderer/components/CheckpointTimeline/Timeline.tsx`

**What:** Wire up scroll-to-pan, Ctrl+scroll-to-zoom, and middle-click/space-drag-to-pan.

**Step 1: Add the zoomToward helper**

```typescript
const zoomToward = useCallback((screenX: number, screenY: number, newZoom: number) => {
  const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newZoom))
  setPanX((px) => {
    const wx = (screenX - px) / zoom
    return screenX - wx * clamped
  })
  setPanY((py) => {
    const wy = (screenY - py) / zoom
    return screenY - wy * clamped
  })
  setZoom(clamped)
}, [zoom])
```

Note: This reads `zoom` from closure for the world-point calculation. The `setPanX`/`setPanY` updater functions use the latest values. A small simplification vs the Gallery's store-based approach, sufficient for local state.

**Step 2: Add wheel event handler**

```typescript
useEffect(() => {
  const el = containerRef.current
  if (!el) return
  const handler = (e: WheelEvent) => {
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) {
      const rect = el.getBoundingClientRect()
      const factor = Math.exp(-e.deltaY * ZOOM_SENSITIVITY)
      zoomToward(e.clientX - rect.left, e.clientY - rect.top, zoom * factor)
    } else {
      setPanX((v) => v - e.deltaX)
      setPanY((v) => v - e.deltaY)
    }
  }
  el.addEventListener('wheel', handler, { passive: false })
  return () => el.removeEventListener('wheel', handler)
}, [zoom, zoomToward])
```

**Step 3: Add pointer event handlers for drag-to-pan**

```typescript
const panStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)

const handlePointerDown = useCallback((e: React.PointerEvent) => {
  if (e.button === 1 || (e.button === 0 && spaceRef.current)) {
    setIsPanning(true)
    panStart.current = { x: e.clientX, y: e.clientY, panX, panY }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    e.preventDefault()
  }
}, [panX, panY])

const handlePointerMove = useCallback((e: React.PointerEvent) => {
  if (!panStart.current) return
  setPanX(panStart.current.panX + (e.clientX - panStart.current.x))
  setPanY(panStart.current.panY + (e.clientY - panStart.current.y))
}, [])

const handlePointerUp = useCallback(() => {
  setIsPanning(false)
  panStart.current = null
}, [])
```

**Step 4: Wire pointer handlers to the container div**

Add to the canvas `<div ref={containerRef} ...>`:
```
onPointerDown={handlePointerDown}
onPointerMove={handlePointerMove}
onPointerUp={handlePointerUp}
```

**Step 5: Verify** — `npx tsc --noEmit` clean. Test: scroll to pan, Ctrl+scroll to zoom, middle-click drag to pan.

---

### Task 4: Add zoom controls HUD

**Files:**
- Modify: `src/renderer/components/CheckpointTimeline/Timeline.tsx`

**What:** Add the bottom-right zoom controls matching the Gallery.

**Step 1: Add zoom helper functions**

```typescript
const zoomIn = useCallback(() => {
  zoomToward(containerSize.width / 2, containerSize.height / 2, zoom + ZOOM_STEP)
}, [containerSize, zoom, zoomToward])

const zoomOut = useCallback(() => {
  zoomToward(containerSize.width / 2, containerSize.height / 2, zoom - ZOOM_STEP)
}, [containerSize, zoom, zoomToward])

const zoomTo100 = useCallback(() => {
  const cx = containerSize.width / 2
  const cy = containerSize.height / 2
  const wx = (cx - panX) / zoom
  const wy = (cy - panY) / zoom
  setViewport({ zoom: 1, panX: cx - wx, panY: cy - wy })
}, [containerSize, panX, panY, zoom, setViewport])

const fitAll = useCallback(() => {
  if (timelineOrder.length === 0 || containerSize.width === 0) return
  const PAD = 48
  const worldW = totalWidth + PAD * 2
  // Estimate card height at ~220px (CSS auto-height, but this is a reasonable bound)
  const CARD_H_EST = 220
  const worldH = CARD_H_EST + PAD * 2
  const newZoom = Math.max(MIN_ZOOM, Math.min(1, containerSize.width / worldW, containerSize.height / worldH))
  setViewport({
    zoom: newZoom,
    panX: (containerSize.width - worldW * newZoom) / 2 + PAD * newZoom,
    panY: (containerSize.height - CARD_H_EST * newZoom) / 2,
  })
}, [containerSize, totalWidth, timelineOrder.length, setViewport])
```

**Step 2: Add the HUD inside the canvas container, after the world-space div**

```tsx
{/* Zoom controls HUD */}
<div className="absolute bottom-3 right-3 flex items-center gap-0.5 bg-black/70 backdrop-blur-md border border-white/10 rounded-lg px-1.5 py-1 z-10 select-none">
  <button onClick={zoomOut} className="p-1.5 hover:bg-white/10 rounded text-white/50 hover:text-white/80 transition-colors" title="Zoom out (Cmd+-)">
    <ZoomOut size={14} />
  </button>
  <button onClick={zoomTo100} className="text-[11px] text-white/50 hover:text-white/80 min-w-[44px] text-center font-mono px-1 py-0.5 hover:bg-white/10 rounded transition-colors" title="Zoom to 100% (Cmd+1)">
    {Math.round(zoom * 100)}%
  </button>
  <button onClick={zoomIn} className="p-1.5 hover:bg-white/10 rounded text-white/50 hover:text-white/80 transition-colors" title="Zoom in (Cmd++)">
    <ZoomIn size={14} />
  </button>
  <div className="w-px h-4 bg-white/10 mx-0.5" />
  <button onClick={fitAll} className="p-1.5 hover:bg-white/10 rounded text-white/50 hover:text-white/80 transition-colors" title="Fit all (Cmd+0)">
    <Maximize size={14} />
  </button>
</div>
```

**Step 3: Verify** — `npx tsc --noEmit` clean. Zoom buttons work.

---

### Task 5: Add keyboard shortcuts and space-key hand tool

**Files:**
- Modify: `src/renderer/components/CheckpointTimeline/Timeline.tsx`

**What:** Match Gallery's keyboard shortcuts (Cmd+0, Cmd+1, Cmd++, Cmd+-) and Space to hold for pan mode.

**Step 1: Space key handler**

```typescript
useEffect(() => {
  const onKeyDown = (e: KeyboardEvent) => {
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
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  return () => {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
  }
}, [])
```

**Step 2: Keyboard zoom shortcuts**

```typescript
useEffect(() => {
  const el = containerRef.current
  if (!el) return
  el.tabIndex = 0
  const handler = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    if ((e.target as HTMLElement).closest('.xterm')) return
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key === '0') { e.preventDefault(); fitAll() }
    else if (mod && e.key === '1') { e.preventDefault(); zoomTo100() }
    else if (mod && (e.key === '+' || e.key === '=')) { e.preventDefault(); zoomIn() }
    else if (mod && e.key === '-') { e.preventDefault(); zoomOut() }
  }
  el.addEventListener('keydown', handler)
  return () => el.removeEventListener('keydown', handler)
}, [fitAll, zoomTo100, zoomIn, zoomOut])
```

**Step 3: Hand tool indicator** — Add inside canvas container:

```tsx
{spaceHeld && !isPanning && (
  <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-black/70 backdrop-blur-md border border-white/10 rounded-lg px-3 py-1.5 z-10 pointer-events-none select-none">
    <Hand size={14} className="text-white/60" />
    <span className="text-[11px] text-white/50">Drag to pan</span>
  </div>
)}
```

**Step 4: Verify** — `npx tsc --noEmit` clean. Space+drag pans, Cmd+0 fits all.

---

### Task 6: Auto-fit on load and on tab switch

**Files:**
- Modify: `src/renderer/components/CheckpointTimeline/Timeline.tsx`

**What:** Automatically `fitAll()` when checkpoints load or when switching to the timeline tab, so cards are visible immediately.

**Step 1: Auto-fit after checkpoints load**

```typescript
const didAutoFit = useRef(false)

// Reset auto-fit flag when checkpoints change
useEffect(() => { didAutoFit.current = false }, [checkpoints])

useEffect(() => {
  if (didAutoFit.current || timelineOrder.length === 0 || containerSize.width === 0) return
  didAutoFit.current = true
  requestAnimationFrame(() => fitAll())
}, [timelineOrder.length, containerSize, fitAll])
```

**Step 2: Re-fit when switching to timeline tab**

The existing `activeCanvasTab` effect already reloads checkpoints. After reload, the auto-fit will trigger via the `checkpoints` change → `didAutoFit` reset → auto-fit effect.

**Step 3: Verify** — `npx tsc --noEmit` clean. Opening timeline auto-fits all cards in view.

---

### Task 7: Final verification

**Step 1:** Run `npx tsc --noEmit` — clean compile

**Step 2:** Run `npm test` — all tests pass

**Step 3:** Run `npm run build` — production build succeeds

**Step 4:** Manual test in dev mode (`npm run dev`):
- Open TestCanvas project
- Navigate to Timeline tab
- Verify: cards render on a dark canvas with dot grid
- Verify: scroll to pan, Ctrl+scroll to zoom toward cursor
- Verify: zoom controls HUD works (−, %, +, Fit All)
- Verify: Space+drag shows hand tool and pans
- Verify: Cmd+0 fits all, Cmd+1 zooms to 100%
- Verify: if gitAhead > 0, amber dashed divider appears between pushed/unpushed commits
- Verify: unpushed cards have amber-tinted border
- Verify: click cards to select Before/After still works
- Verify: rollback button still works
- Verify: + Checkpoint button still creates checkpoints

**Step 5:** Commit

```bash
git add src/renderer/components/CheckpointTimeline/Timeline.tsx
git commit -m "feat(timeline): zoomable canvas with push divider

Convert Timeline from horizontal scroll to pan/zoom canvas matching
Gallery controls. Add visual divider between pushed and unpushed
commits using gitAhead from tab state."
```

---

## Key files
- `src/renderer/components/CheckpointTimeline/Timeline.tsx` — sole file modified
- `src/renderer/components/Gallery/CanvasBoard.tsx` — reference for pan/zoom patterns (not modified)
- `src/renderer/stores/tabs.ts` — provides `gitAhead` via `useActiveTab()` (not modified)
