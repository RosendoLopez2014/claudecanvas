import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { LayoutGrid } from 'lucide-react'
import { TerminalView } from '../Terminal/TerminalView'
import { BootOverlay } from '../BootOverlay/BootOverlay'
import { CanvasPanel } from '../Canvas/CanvasPanel'
import { FileExplorer } from '../FileExplorer/FileExplorer'
import { SplitPaneHeader, getGridStyle, shouldSpanFull } from './SplitViewGrid'
import type { SplitViewTab } from './SplitViewGrid'
import { useWorkspaceStore } from '@/stores/workspace'
import { useCanvasStore } from '@/stores/canvas'
import { useTabsStore } from '@/stores/tabs'

// Terminal gets a narrow column in desktop mode so canvas is as wide as possible
const TERMINAL_MIN = 380

const TRANSITION = 'width 300ms cubic-bezier(0.25, 0.1, 0.25, 1)'

/**
 * Stable selector: only extracts tab IDs and project paths.
 * Returns the same reference when unrelated tab fields (git sync, token usage, etc.) change.
 */
function useTabList() {
  const raw = useTabsStore((s) => s.tabs)
  // Memoize: only re-compute when the number of tabs or their IDs/paths change
  return useMemo(
    () => raw.map((t) => ({ id: t.id, projectPath: t.project.path })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [raw.length, ...raw.map((t) => t.id)]
  )
}

/** Extra tab metadata needed only for split view pane headers */
function useSplitViewTabs(): SplitViewTab[] {
  const tabs = useTabsStore((s) => s.tabs)
  return useMemo(
    () => tabs.map((t) => ({
      id: t.id,
      projectName: t.project.name,
      branch: t.worktreeBranch,
      devStatus: t.dev.status,
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabs.length, ...tabs.map((t) => `${t.id}:${t.project.name}:${t.worktreeBranch}:${t.dev.status}`)]
  )
}

export function Workspace() {
  const renderT0 = performance.now()
  const { mode, fileExplorerOpen, splitViewActive } = useWorkspaceStore()
  const { viewportMode } = useCanvasStore()
  const tabList = useTabList()
  const splitTabs = useSplitViewTabs()
  const activeTabId = useTabsStore((s) => s.activeTabId)

  useEffect(() => {
    console.log(`[TAB-DEBUG] Workspace render took ${(performance.now() - renderT0).toFixed(1)}ms`)
  })
  const showCanvas = mode === 'terminal-canvas'
  const isMobile = viewportMode === 'mobile'

  const containerRef = useRef<HTMLDivElement>(null)
  const [canvasWidth, setCanvasWidth] = useState(0)
  const [isAnimating, setIsAnimating] = useState(false)
  const dividerDragging = useRef(false)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(0)

  // Compute target canvas width based on mode + viewport
  const computeCanvasWidth = useCallback(() => {
    const container = containerRef.current
    if (!container) return 0
    if (!showCanvas) return 0
    if (isMobile) return Math.min(420, container.clientWidth * 0.45)
    // Desktop: canvas gets everything except the terminal minimum
    return Math.max(400, container.clientWidth - TERMINAL_MIN)
  }, [showCanvas, isMobile])

  // Animate canvas open/close and viewport changes
  useEffect(() => {
    const target = computeCanvasWidth()
    if (target === canvasWidth) return

    setIsAnimating(true)
    setCanvasWidth(target)

    const timer = setTimeout(() => setIsAnimating(false), 320)
    return () => clearTimeout(timer)
  }, [showCanvas, isMobile, computeCanvasWidth]) // eslint-disable-line react-hooks/exhaustive-deps

  // Recompute canvas width on window resize (e.g. after maximize)
  useEffect(() => {
    if (!showCanvas) return
    const onResize = () => {
      if (dividerDragging.current) return
      const target = computeCanvasWidth()
      setCanvasWidth(target)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [showCanvas, computeCanvasWidth])

  // Divider drag handlers
  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dividerDragging.current = true
    dragStartX.current = e.clientX
    dragStartWidth.current = canvasWidth

    const onMouseMove = (ev: MouseEvent) => {
      const delta = dragStartX.current - ev.clientX
      const container = containerRef.current
      if (!container) return
      const maxWidth = container.clientWidth - 300
      const newWidth = Math.max(200, Math.min(maxWidth, dragStartWidth.current + delta))
      setCanvasWidth(newWidth)
    }

    const onMouseUp = () => {
      dividerDragging.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [canvasWidth])

  const shouldTransition = isAnimating || !dividerDragging.current

  // Auto-exit split view when tab count drops below 2
  const tabCount = tabList.length
  useEffect(() => {
    if (splitViewActive && tabCount < 2) {
      useWorkspaceStore.getState().exitSplitView()
    }
  }, [splitViewActive, tabCount])

  const handleSelectSplitPane = useCallback((id: string) => {
    useTabsStore.getState().setActiveTab(id)
    useWorkspaceStore.getState().exitSplitView()
  }, [])

  return (
    <div ref={containerRef} className="h-full flex overflow-hidden relative">
      {/* File explorer sidebar */}
      {fileExplorerOpen && <FileExplorer />}

      {/* Floating split view toggle — always visible when 2+ tabs */}
      {tabList.length >= 2 && (
        <button
          onClick={() => useWorkspaceStore.getState().toggleSplitView()}
          className={`absolute top-1.5 right-2 z-10 flex items-center gap-1.5 px-2 py-1 rounded transition-colors text-[10px] ${
            splitViewActive
              ? 'bg-[var(--accent-cyan)]/15 text-[var(--accent-cyan)] hover:bg-[var(--accent-cyan)]/25'
              : 'bg-white/5 text-white/25 hover:bg-white/10 hover:text-white/50'
          }`}
          title={splitViewActive ? 'Exit Split View (Esc)' : 'Split View (\u2318\u21e7S)'}
        >
          <LayoutGrid size={11} />
          <span>Split</span>
        </button>
      )}

      {/*
       * Terminal pane container — switches layout mode but NEVER remounts TerminalView.
       * Normal mode: position:relative with absolute-positioned children (only active visible).
       * Split view: CSS Grid showing all terminals side by side.
       */}
      <div
        className={
          splitViewActive
            ? 'h-full flex-1 min-w-0 grid gap-px bg-white/5'
            : 'h-full flex-1 min-w-[300px] relative'
        }
        style={splitViewActive ? getGridStyle(tabList.length) : undefined}
      >
        {tabList.map((tab, index) => {
          const isActive = tab.id === activeTabId
          const splitTab = splitTabs.find((s) => s.id === tab.id)

          return (
            <div
              key={tab.id}
              className={
                splitViewActive
                  ? `flex flex-col min-w-0 min-h-0 bg-[var(--bg-primary)] border overflow-hidden transition-colors duration-150 ${
                      isActive ? 'border-[var(--accent-cyan)]/40' : 'border-white/10'
                    }`
                  : 'absolute inset-0'
              }
              style={
                splitViewActive
                  ? shouldSpanFull(tabList.length, index) ? { gridColumn: '1 / -1' } : undefined
                  : { visibility: isActive ? 'visible' : 'hidden' }
              }
            >
              {/* Pane header — always mounted to keep child index stable, hidden when not split */}
              <div style={splitViewActive ? undefined : { display: 'none' }}>
                {splitTab && (
                  <SplitPaneHeader
                    tab={splitTab}
                    index={index}
                    onSelect={() => handleSelectSplitPane(tab.id)}
                  />
                )}
              </div>

              {/* TerminalView — ALWAYS at child index 1, never remounted */}
              <div
                className={splitViewActive ? 'flex-1 min-h-0' : 'h-full'}
                onMouseDown={splitViewActive ? () => useTabsStore.getState().setActiveTab(tab.id) : undefined}
              >
                <TerminalView
                  cwd={tab.projectPath}
                  tabId={tab.id}
                  isTabActive={splitViewActive || isActive}
                />
              </div>

              {/* Boot overlay — covers terminal until Claude is ready */}
              {!splitViewActive && isActive && (
                <BootOverlay
                  tabId={tab.id}
                  projectName={tab.projectPath.split('/').pop() || 'project'}
                />
              )}
            </div>
          )
        })}
      </div>

      {/* Canvas pane — collapsed to 0 during split view, animated width otherwise */}
      <div
        className="h-full flex overflow-hidden"
        style={{
          width: splitViewActive ? 0 : canvasWidth,
          transition: shouldTransition && !splitViewActive ? TRANSITION : 'none',
          willChange: isAnimating ? 'width' : 'auto'
        }}
      >
        {/* Divider */}
        {canvasWidth > 0 && !splitViewActive && (
          <div
            className="h-full flex-shrink-0 flex items-center justify-center group cursor-col-resize"
            style={{ width: 6 }}
            onMouseDown={onDividerMouseDown}
          >
            <div className="w-px h-full bg-white/10 group-hover:bg-cyan-400/40 transition-colors duration-200" />
          </div>
        )}

        {/* Canvas content — always mounted, visibility controlled by width */}
        <div className="flex-1 h-full min-w-0 overflow-hidden">
          <CanvasPanel />
        </div>
      </div>
    </div>
  )
}
