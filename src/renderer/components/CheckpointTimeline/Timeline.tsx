import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useProjectStore } from '@/stores/project'
import { useTabsStore, useActiveTab } from '@/stores/tabs'
import { useToastStore } from '@/stores/toast'
import { GitCommit, Plus, RotateCcw, FileText, Info, X, ZoomIn, ZoomOut, Maximize, Hand, GitCompare } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface Checkpoint {
  hash: string
  message: string
  date: string
  author: string
  filesChanged: number
  insertions: number
  deletions: number
  files: string[]
}

/** Visual diff percentage per checkpoint (compared to previous) */
type DiffMap = Map<string, number | null>

// ─── Canvas constants ────────────────────────────────────────────────
const MIN_ZOOM = 0.1
const MAX_ZOOM = 3
const ZOOM_SENSITIVITY = 0.005
const ZOOM_STEP = 0.15
const CARD_W = 200
const CARD_GAP = 40
const DIVIDER_W = 80

export function Timeline() {
  const { currentProject } = useProjectStore()
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([])
  const [visualDiffs, setVisualDiffs] = useState<DiffMap>(new Map())
  const [showHelp, setShowHelp] = useState(false)
  const [compareMode, setCompareMode] = useState(false)
  const currentTab = useActiveTab()
  const diffBeforeHash = currentTab?.diffBeforeHash ?? null
  const diffAfterHash = currentTab?.diffAfterHash ?? null

  const loadCheckpoints = useCallback(async () => {
    if (!currentProject?.path) return
    await window.api.git.init(currentProject.path)
    const log = (await window.api.git.log(currentProject.path, 50)) as Checkpoint[]
    setCheckpoints(log)
  }, [currentProject?.path])

  useEffect(() => {
    loadCheckpoints()
  }, [loadCheckpoints])

  // Compute visual diffs between adjacent checkpoints
  useEffect(() => {
    if (!currentProject?.path || checkpoints.length < 2) return
    let cancelled = false

    async function computeDiffs() {
      const diffs: DiffMap = new Map()
      for (let i = 0; i < checkpoints.length - 1; i++) {
        const current = checkpoints[i]
        const previous = checkpoints[i + 1]
        const [imgA, imgB] = await Promise.all([
          window.api.screenshot.loadCheckpoint(current.hash, currentProject!.path),
          window.api.screenshot.loadCheckpoint(previous.hash, currentProject!.path),
        ])
        if (cancelled) return
        if (imgA && imgB) {
          const result = await window.api.visualDiff.compare(imgA, imgB)
          if (cancelled) return
          diffs.set(current.hash, result?.diffPercent ?? null)
        } else {
          diffs.set(current.hash, null)
        }
      }
      if (!cancelled) setVisualDiffs(diffs)
    }

    computeDiffs()
    return () => { cancelled = true }
  }, [checkpoints, currentProject?.path])

  // Reload when switching to timeline tab
  const activeCanvasTab = currentTab?.activeCanvasTab ?? 'preview'
  useEffect(() => {
    if (activeCanvasTab === 'timeline') loadCheckpoints()
  }, [activeCanvasTab, loadCheckpoints])

  const createCheckpoint = useCallback(async () => {
    if (!currentProject?.path) return
    await window.api.git.init(currentProject.path)
    const message = `Checkpoint at ${new Date().toLocaleTimeString()}`
    const result = await window.api.git.checkpoint(currentProject.path, message)
    if (result?.error === 'nothing-to-commit') {
      useToastStore.getState().addToast('No changes to checkpoint', 'info')
      return
    }
    if (result?.error) {
      useToastStore.getState().addToast(`Checkpoint failed: ${result.error}`, 'error')
      return
    }
    if (result?.hash) {
      await window.api.screenshot.captureCheckpoint(result.hash, currentProject.path)
    }
    useToastStore.getState().addToast('Checkpoint created', 'success')
    loadCheckpoints()
  }, [loadCheckpoints, currentProject?.path])

  const updateDiffHashes = useCallback((before: string | null, after: string | null) => {
    const tab = useTabsStore.getState().getActiveTab()
    if (tab) useTabsStore.getState().updateTab(tab.id, { diffBeforeHash: before, diffAfterHash: after })
  }, [])

  const handleClick = useCallback(
    (hash: string) => {
      if (!compareMode) return // Only select when compare mode is active
      if (hash === diffBeforeHash) {
        updateDiffHashes(null, null)
        return
      }
      if (hash === diffAfterHash) {
        updateDiffHashes(diffBeforeHash, null)
        return
      }
      if (!diffBeforeHash) {
        updateDiffHashes(hash, null)
        return
      }
      updateDiffHashes(diffBeforeHash, hash)
      setCompareMode(false) // Exit compare mode after selecting both
      const tab = useTabsStore.getState().getActiveTab()
      if (tab) useTabsStore.getState().updateTab(tab.id, { activeCanvasTab: 'diff' })
    },
    [compareMode, diffBeforeHash, diffAfterHash, updateDiffHashes]
  )

  const toggleCompareMode = useCallback(() => {
    if (compareMode) {
      // Exiting compare mode — clear selection
      setCompareMode(false)
      updateDiffHashes(null, null)
    } else {
      setCompareMode(true)
    }
  }, [compareMode, updateDiffHashes])

  const [rollbackTarget, setRollbackTarget] = useState<string | null>(null)

  const handleRollback = useCallback(async (hash: string, message: string) => {
    if (!currentProject?.path) return
    setRollbackTarget(hash)
    const result = await window.api.git.rollback(currentProject.path, hash)
    setRollbackTarget(null)
    if (result.success) {
      useToastStore.getState().addToast(`Rolled back to: ${message}`, 'success')
      loadCheckpoints()
    } else {
      useToastStore.getState().addToast(`Rollback failed: ${result.error}`, 'error')
    }
  }, [currentProject?.path, loadCheckpoints])

  const getSelectionState = useCallback((hash: string): 'before' | 'after' | null => {
    if (hash === diffBeforeHash) return 'before'
    if (hash === diffAfterHash) return 'after'
    return null
  }, [diffBeforeHash, diffAfterHash])

  // Reverse so oldest is on the left, newest on the right (natural timeline order)
  const timelineOrder = useMemo(() => [...checkpoints].reverse(), [checkpoints])

  // ─── Canvas viewport state ───────────────────────────────────────────
  const [panX, setPanX] = useState(0)
  const [panY, setPanY] = useState(0)
  const [zoom, setZoom] = useState(1)
  const panXRef = useRef(panX)
  panXRef.current = panX
  const panYRef = useRef(panY)
  panYRef.current = panY
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const containerElRef = useRef<HTMLDivElement | null>(null)
  const [canvasReady, setCanvasReady] = useState(false)
  const containerRef = useCallback((el: HTMLDivElement | null) => {
    containerElRef.current = el
    setCanvasReady(!!el)
  }, [])
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const spaceRef = useRef(false)

  const setViewport = useCallback((v: { panX?: number; panY?: number; zoom?: number }) => {
    if (v.panX !== undefined) setPanX(v.panX)
    if (v.panY !== undefined) setPanY(v.panY)
    if (v.zoom !== undefined) setZoom(v.zoom)
  }, [])

  // Track container size — re-run when canvas mounts via callback ref
  useEffect(() => {
    const el = containerElRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [canvasReady])

  // ─── Push divider: how many commits are ahead of remote ──────────────
  const gitAhead = currentTab?.gitAhead ?? 0

  // ─── Horizontal layout ───────────────────────────────────────────────
  const { cardPositions, dividerX, totalWidth } = useMemo(() => {
    const positions: Record<string, { x: number; y: number }> = {}
    const dividerIndex = gitAhead > 0 ? Math.max(0, timelineOrder.length - gitAhead) : -1
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

  // ─── Zoom toward cursor ──────────────────────────────────────────────
  const zoomToward = useCallback((screenX: number, screenY: number, newZoom: number) => {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newZoom))
    const currentZoom = zoomRef.current
    const wx = (screenX - panXRef.current) / currentZoom
    const wy = (screenY - panYRef.current) / currentZoom
    setPanX(screenX - wx * clamped)
    setPanY(screenY - wy * clamped)
    setZoom(clamped)
  }, [])

  // ─── Wheel: scroll=pan, Ctrl+scroll=zoom ─────────────────────────────
  useEffect(() => {
    const el = containerElRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect()
        const factor = Math.exp(-e.deltaY * ZOOM_SENSITIVITY)
        zoomToward(e.clientX - rect.left, e.clientY - rect.top, zoomRef.current * factor)
      } else {
        setPanX((v) => v - e.deltaX)
        setPanY((v) => v - e.deltaY)
      }
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [canvasReady, zoomToward])

  // ─── Pointer drag to pan ─────────────────────────────────────────────
  const panStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button === 1 || (e.button === 0 && spaceRef.current)) {
      setIsPanning(true)
      panStart.current = { x: e.clientX, y: e.clientY, panX: panXRef.current, panY: panYRef.current }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      e.preventDefault()
    }
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!panStart.current) return
    setPanX(panStart.current.panX + (e.clientX - panStart.current.x))
    setPanY(panStart.current.panY + (e.clientY - panStart.current.y))
  }, [])

  const handlePointerUp = useCallback(() => {
    setIsPanning(false)
    panStart.current = null
  }, [])

  // ─── Zoom helpers ────────────────────────────────────────────────────
  const zoomIn = useCallback(() => {
    zoomToward(containerSize.width / 2, containerSize.height / 2, zoomRef.current + ZOOM_STEP)
  }, [containerSize, zoomToward])

  const zoomOut = useCallback(() => {
    zoomToward(containerSize.width / 2, containerSize.height / 2, zoomRef.current - ZOOM_STEP)
  }, [containerSize, zoomToward])

  const zoomTo100 = useCallback(() => {
    const cx = containerSize.width / 2
    const cy = containerSize.height / 2
    const wx = (cx - panXRef.current) / zoomRef.current
    const wy = (cy - panYRef.current) / zoomRef.current
    setViewport({ zoom: 1, panX: cx - wx, panY: cy - wy })
  }, [containerSize, setViewport])

  const fitAll = useCallback(() => {
    if (timelineOrder.length === 0 || containerSize.width === 0) return
    const PAD = 48
    const worldW = totalWidth + PAD * 2
    const CARD_H_EST = 220
    const worldH = CARD_H_EST + PAD * 2
    const newZoom = Math.max(MIN_ZOOM, Math.min(1, containerSize.width / worldW, containerSize.height / worldH))
    setViewport({
      zoom: newZoom,
      panX: (containerSize.width - worldW * newZoom) / 2 + PAD * newZoom,
      panY: (containerSize.height - CARD_H_EST * newZoom) / 2,
    })
  }, [containerSize, totalWidth, timelineOrder.length, setViewport])

  // ─── Space key for hand tool ─────────────────────────────────────────
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

  // ─── Keyboard zoom shortcuts ─────────────────────────────────────────
  useEffect(() => {
    const el = containerElRef.current
    if (!el) return
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
  }, [canvasReady, fitAll, zoomTo100, zoomIn, zoomOut])

  // ─── Auto-fit on load ────────────────────────────────────────────────
  const didAutoFit = useRef(false)

  useEffect(() => { didAutoFit.current = false }, [checkpoints])

  useEffect(() => {
    if (didAutoFit.current || timelineOrder.length === 0 || containerSize.width === 0) return
    didAutoFit.current = true
    const id = requestAnimationFrame(() => fitAll())
    return () => cancelAnimationFrame(id)
  }, [timelineOrder.length, containerSize, fitAll])

  if (checkpoints.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-white/30 text-sm">
        <div className="text-center space-y-3">
          <p>No checkpoints yet</p>
          <button
            onClick={createCheckpoint}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--accent-cyan)]/20 text-[var(--accent-cyan)] rounded-lg text-xs hover:bg-[var(--accent-cyan)]/30 transition"
          >
            <Plus size={12} /> Create first checkpoint
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Controls */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <div className="flex items-center gap-3">
          <span className="text-xs text-white/40">{checkpoints.length} checkpoints</span>
          {compareMode && !diffBeforeHash && (
            <span className="text-[10px] text-amber-400/80 animate-pulse">
              Click a &quot;Before&quot; checkpoint...
            </span>
          )}
          {compareMode && diffBeforeHash && !diffAfterHash && (
            <span className="text-[10px] text-amber-400/80 animate-pulse">
              Now click an &quot;After&quot; checkpoint...
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHelp((v) => !v)}
            className="p-1 rounded hover:bg-white/5 text-white/30 hover:text-white/50 transition"
            title="How to use the timeline"
          >
            <Info size={13} />
          </button>
          <button
            onClick={toggleCompareMode}
            className={`flex items-center gap-1 px-3 py-1 rounded text-xs transition ${
              compareMode
                ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
                : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/60'
            }`}
            title="Compare two checkpoints"
          >
            <GitCompare size={10} /> {compareMode ? 'Cancel Compare' : 'Compare'}
          </button>
          {diffBeforeHash && diffAfterHash && (
            <button
              onClick={() => { const tab = useTabsStore.getState().getActiveTab(); if (tab) useTabsStore.getState().updateTab(tab.id, { activeCanvasTab: 'diff' }) }}
              className="flex items-center gap-1 px-3 py-1 bg-amber-500/20 text-amber-400 rounded text-xs hover:bg-amber-500/30 transition"
            >
              View Diff
            </button>
          )}
          <button
            onClick={createCheckpoint}
            className="flex items-center gap-1 px-3 py-1 bg-[var(--accent-cyan)]/20 text-[var(--accent-cyan)] rounded text-xs hover:bg-[var(--accent-cyan)]/30 transition"
          >
            <Plus size={10} /> Checkpoint
          </button>
        </div>
      </div>

      {/* Help banner */}
      <AnimatePresence>
        {showHelp && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-white/5"
          >
            <div className="px-4 py-3 bg-[var(--accent-cyan)]/5 flex gap-3">
              <div className="flex-1 space-y-1.5">
                <p className="text-xs font-medium text-[var(--accent-cyan)]">Timeline &mdash; Track your project&apos;s evolution</p>
                <ul className="text-[11px] text-white/50 space-y-1 leading-relaxed">
                  <li><span className="text-white/70">Save snapshots</span> &mdash; Click <strong>+ Checkpoint</strong> to save the current state. Do this before and after major changes.</li>
                  <li><span className="text-white/70">Compare changes</span> &mdash; Click any two checkpoints to select &quot;Before&quot; and &quot;After&quot;, then view a visual diff.</li>
                  <li><span className="text-white/70">Undo mistakes</span> &mdash; Hover a checkpoint and click <strong>Rollback</strong> to restore your project to that exact state.</li>
                  <li><span className="text-white/70">Tip:</span> Create checkpoints frequently &mdash; before trying risky changes, after completing features, or whenever things &quot;work&quot;.</li>
                </ul>
              </div>
              <button
                onClick={() => setShowHelp(false)}
                className="self-start p-0.5 rounded hover:bg-white/10 text-white/30 hover:text-white/50 transition"
              >
                <X size={12} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden outline-none"
        tabIndex={0}
        style={{
          cursor: isPanning ? 'grabbing' : spaceHeld ? 'grab' : 'default',
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
          {/* Push divider */}
          {dividerX >= 0 && (
            <div
              className="absolute flex flex-col items-center gap-1"
              style={{ left: dividerX, top: -20, width: 0, height: 'calc(100% + 40px)' }}
            >
              <span className="text-[9px] text-amber-400/70 whitespace-nowrap bg-[#18181B] px-1.5 py-0.5 rounded">
                {gitAhead} unpushed
              </span>
              <div className="flex-1 border-l border-dashed border-amber-400/30" />
              <span className="text-[9px] text-white/20 whitespace-nowrap bg-[#18181B] px-1.5 py-0.5 rounded">
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
                transition={{ delay: Math.min(i * 0.03, 0.5) }}
                onClick={() => handleClick(cp.hash)}
                role={compareMode ? 'button' : undefined}
                tabIndex={compareMode ? 0 : undefined}
                onKeyDown={compareMode ? (e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(cp.hash) } : undefined}
                className={`group absolute flex flex-col gap-1.5 p-3 rounded-lg border transition ${compareMode ? 'cursor-pointer' : 'cursor-default'} ${borderColor}`}
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
                {i > 0 && (() => {
                  const afterDivider = gitAhead > 0 && i === Math.max(0, timelineOrder.length - gitAhead)
                  const connectorWidth = afterDivider ? CARD_GAP + DIVIDER_W : CARD_GAP
                  return (
                    <div
                      className="absolute bg-white/10"
                      style={{ right: '100%', top: '50%', width: connectorWidth, height: 1 }}
                    />
                  )
                })()}

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

        {/* Hand tool indicator */}
        {spaceHeld && !isPanning && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-black/70 backdrop-blur-md border border-white/10 rounded-lg px-3 py-1.5 z-10 pointer-events-none select-none">
            <Hand size={14} className="text-white/60" />
            <span className="text-[11px] text-white/50">Drag to pan</span>
          </div>
        )}
      </div>
    </div>
  )
}
