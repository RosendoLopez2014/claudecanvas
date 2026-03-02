import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { LayoutGrid, GitBranch, Layers } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { TerminalView } from '../Terminal/TerminalView'
import { BootOverlay } from '../BootOverlay/BootOverlay'
import { CanvasPanel } from '../Canvas/CanvasPanel'
import { FileExplorer } from '../FileExplorer/FileExplorer'
import { SplitPaneHeader, getGridStyle, shouldSpanFull } from './SplitViewGrid'
import type { SplitViewTab } from './SplitViewGrid'
import { useWorkspaceStore } from '@/stores/workspace'
import type { SplitViewScope } from '@/stores/workspace'
import { useTabsStore, useActiveTab, type TabState } from '@/stores/tabs'
import { useTabMcpInit } from '@/hooks/useTabMcpInit'

// Terminal gets a narrow column in desktop mode so canvas is as wide as possible
const TERMINAL_MIN = 380

// No CSS transition on canvas width — snap open/close like VS Code panels.
// Transitions caused visual glitches (expanding clear box) and terminal refit lag.

/**
 * Stable selector: extracts tab IDs, project paths, and project names.
 * NOTE: Zustand v5's create() ignores equality functions (third arg).
 * We subscribe to s.tabs (stable store ref) and derive in useMemo.
 */
function useTabList() {
  const tabs = useTabsStore((s) => s.tabs)
  return useMemo(
    () => tabs.map((t) => ({ id: t.id, projectPath: t.project.path, projectName: t.project.name })),
    [tabs]
  )
}

/** Extra tab metadata needed for split view pane headers */
function useSplitViewTabs(): SplitViewTab[] {
  const tabs = useTabsStore((s) => s.tabs)
  return useMemo(
    () => tabs.map((t) => ({
      id: t.id,
      projectName: t.project.name,
      branch: t.worktreeBranch,
      devStatus: t.dev.status,
    })),
    [tabs]
  )
}

// ── Split View Dropdown ────────────────────────────────────────────────

function SplitDropdown({ canSplitBranches, canSplitAll, onSelect, onClose }: {
  canSplitBranches: boolean
  canSplitAll: boolean
  onSelect: (scope: SplitViewScope) => void
  onClose: () => void
}) {
  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element).closest('[data-split-dropdown]')) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <motion.div
      data-split-dropdown
      className="absolute top-8 right-0 w-44 py-1 rounded-lg bg-[var(--bg-secondary)] border border-white/10 shadow-xl z-20"
      initial={{ opacity: 0, y: -4, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.95 }}
      transition={{ duration: 0.12 }}
    >
      <button
        disabled={!canSplitBranches}
        onClick={() => { onSelect('project'); onClose() }}
        className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-left hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <GitBranch size={12} className="text-[var(--accent-cyan)] shrink-0" />
        <div>
          <div className="text-white/70">Split Branches</div>
          <div className="text-[9px] text-white/30">Same project, all branches</div>
        </div>
      </button>
      <button
        disabled={!canSplitAll}
        onClick={() => { onSelect('session'); onClose() }}
        className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-left hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <Layers size={12} className="text-[var(--accent-coral,#FF6B4A)] shrink-0" />
        <div>
          <div className="text-white/70">Split All</div>
          <div className="text-[9px] text-white/30">All open tabs</div>
        </div>
      </button>
    </motion.div>
  )
}

// ── Per-tab wrapper (calls hooks that can't be inside .map()) ────────

interface TabPaneProps {
  tabId: string
  projectPath: string
  projectName: string
  isActive: boolean
  isGridChild: boolean
  isHidden: boolean
  splitIndex: number
  splitGridCount: number
  splitTab: SplitViewTab | undefined
  splitViewActive: boolean
  onSelectSplitPane: (id: string) => void
}

function TabPane({
  tabId, projectPath, projectName,
  isActive, isGridChild, isHidden,
  splitIndex, splitGridCount, splitTab,
  splitViewActive, onSelectSplitPane,
}: TabPaneProps) {
  // Per-tab MCP session lifecycle
  useTabMcpInit(tabId, projectPath)

  return (
    <div
      className={
        isGridChild
          ? `flex flex-col min-w-0 min-h-0 bg-[var(--bg-primary)] border overflow-hidden transition-colors duration-150 ${
              isActive ? 'border-[var(--accent-cyan)]/40' : 'border-white/10'
            }`
          : 'absolute inset-0'
      }
      style={
        isGridChild
          ? {
              order: splitIndex,
              ...(shouldSpanFull(splitGridCount, splitIndex) ? { gridColumn: '1 / -1' } : {}),
            }
          : { visibility: isHidden ? 'hidden' : 'visible' }
      }
    >
      {/* Pane header — always mounted to keep child index stable, hidden when not in grid */}
      <div style={isGridChild ? undefined : { display: 'none' }}>
        {splitTab && (
          <SplitPaneHeader
            tab={splitTab}
            index={splitIndex >= 0 ? splitIndex : 0}
            onSelect={() => onSelectSplitPane(tabId)}
          />
        )}
      </div>

      {/* TerminalView — ALWAYS at child index 1, never remounted */}
      <div
        className={isGridChild ? 'flex-1 min-h-0' : 'h-full'}
        onMouseDown={isGridChild ? () => useTabsStore.getState().setActiveTab(tabId) : undefined}
      >
        <TerminalView
          cwd={projectPath}
          tabId={tabId}
          isTabActive={isGridChild || isActive}
        />
      </div>

      {/* Boot overlay — always mounted so it survives tab switches.
          Parent div handles visibility:hidden when tab is inactive. */}
      {!splitViewActive && (
        <BootOverlay
          tabId={tabId}
          projectName={projectName}
        />
      )}
    </div>
  )
}

// ── Workspace ──────────────────────────────────────────────────────────

export function Workspace() {
  const { mode, fileExplorerOpen, splitViewActive, splitViewScope, canvasFullscreen } = useWorkspaceStore()
  const currentTab = useActiveTab()
  const viewportMode = currentTab?.viewportMode ?? 'desktop'
  const tabList = useTabList()
  const splitTabs = useSplitViewTabs()
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const [splitMenuOpen, setSplitMenuOpen] = useState(false)

  const showCanvas = mode === 'terminal-canvas'
  const isMobile = viewportMode === 'mobile'
  const viewportWidth = currentTab?.viewportWidth ?? 0

  // ── Split view scope logic ─────────────────────────────────────────────
  const activeProjectName = tabList.find((t) => t.id === activeTabId)?.projectName ?? null

  const activeProjectBranchCount = activeProjectName
    ? tabList.filter((t) => t.projectName === activeProjectName).length
    : 0

  const canSplitBranches = activeProjectBranchCount >= 2
  const canSplitAll = tabList.length >= 2

  // IDs of tabs in the split grid — depends on scope
  const splitGridIds = useMemo(() => {
    if (!splitViewActive) return new Set<string>()
    if (splitViewScope === 'session') {
      return new Set(tabList.map((t) => t.id))
    }
    // project scope
    if (!activeProjectName) return new Set<string>()
    return new Set(tabList.filter((t) => t.projectName === activeProjectName).map((t) => t.id))
  }, [splitViewActive, splitViewScope, activeProjectName, tabList])

  // Ordered list of split tab IDs — in session scope, group by project name
  const splitGridOrder = useMemo(() => {
    if (!splitViewActive) return [] as string[]
    const inGrid = tabList.filter((t) => splitGridIds.has(t.id))
    if (splitViewScope === 'session') {
      inGrid.sort((a, b) => a.projectName.localeCompare(b.projectName))
    }
    return inGrid.map((t) => t.id)
  }, [splitViewActive, splitViewScope, tabList, splitGridIds])

  const splitGridCount = splitGridOrder.length

  // ── Canvas width logic ─────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null)
  const [canvasWidth, setCanvasWidth] = useState(0)
  const dividerDragging = useRef(false)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(0)

  const computeCanvasWidth = useCallback(() => {
    const container = containerRef.current
    if (!container) return 0
    if (!showCanvas) return 0
    // Device viewports: shrink canvas to fit the device + padding
    if (viewportWidth > 0 && viewportWidth <= 430) {
      return Math.min(500, Math.max(380, container.clientWidth * 0.38))
    }
    if (viewportWidth > 430 && viewportWidth <= 800) {
      return Math.min(620, Math.max(450, container.clientWidth * 0.45))
    }
    if (isMobile) return Math.min(420, container.clientWidth * 0.45)
    return Math.max(400, container.clientWidth - TERMINAL_MIN)
  }, [showCanvas, isMobile, viewportWidth])

  useEffect(() => {
    const target = computeCanvasWidth()
    if (target === canvasWidth) return
    setCanvasWidth(target)
    // Nudge terminals to re-fit after the snap layout change
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
  }, [showCanvas, isMobile, viewportWidth, computeCanvasWidth]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!showCanvas) return
    const onResize = () => {
      if (dividerDragging.current) return
      setCanvasWidth(computeCanvasWidth())
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [showCanvas, computeCanvasWidth])

  // Refit terminals when entering/exiting fullscreen canvas
  useEffect(() => {
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
  }, [canvasFullscreen])

  // ── Divider drag via Pointer Capture ────────────────────────────────
  // setPointerCapture guarantees all pointer events are delivered to the
  // capturing element even if the cursor leaves the window, fixing the
  // "divider sticks to mouse" bug that occurs with document-level listeners.

  const onDividerPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    dividerDragging.current = true
    dragStartX.current = e.clientX
    dragStartWidth.current = canvasWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [canvasWidth])

  const onDividerPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dividerDragging.current) return
    const delta = dragStartX.current - e.clientX
    const container = containerRef.current
    if (!container) return
    const maxWidth = container.clientWidth - 300
    setCanvasWidth(Math.max(200, Math.min(maxWidth, dragStartWidth.current + delta)))
  }, [])

  const onDividerPointerUp = useCallback(() => {
    dividerDragging.current = false
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])


  // Auto-exit split view when grid drops below 2 tabs
  useEffect(() => {
    if (splitViewActive && splitGridCount < 2) {
      useWorkspaceStore.getState().exitSplitView()
    }
  }, [splitViewActive, splitGridCount])

  const handleSelectSplitPane = useCallback((id: string) => {
    useTabsStore.getState().setActiveTab(id)
    useWorkspaceStore.getState().exitSplitView()
  }, [])

  const handleSplitSelect = useCallback((scope: SplitViewScope) => {
    useWorkspaceStore.getState().enterSplitView(scope)
  }, [])

  // Show button when either split option is available
  const showSplitButton = canSplitBranches || canSplitAll

  return (
    <div ref={containerRef} className="h-full flex overflow-hidden relative">
      {/* File explorer sidebar */}
      {fileExplorerOpen && <FileExplorer />}

      {/* Split view button with dropdown */}
      {showSplitButton && (
        <div className="absolute top-1.5 right-2 z-10" data-split-dropdown>
          <button
            onClick={() => {
              if (splitViewActive) {
                useWorkspaceStore.getState().exitSplitView()
              } else {
                setSplitMenuOpen((prev) => !prev)
              }
            }}
            className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors text-[10px] ${
              splitViewActive
                ? 'bg-[var(--accent-cyan)]/15 text-[var(--accent-cyan)] hover:bg-[var(--accent-cyan)]/25'
                : 'bg-white/5 text-white/25 hover:bg-white/10 hover:text-white/50'
            }`}
            title={splitViewActive ? 'Exit Split View (Esc)' : 'Split View (\u2318\u21e7S)'}
          >
            <LayoutGrid size={11} />
            <span>Split</span>
          </button>

          <AnimatePresence>
            {splitMenuOpen && !splitViewActive && (
              <SplitDropdown
                canSplitBranches={canSplitBranches}
                canSplitAll={canSplitAll}
                onSelect={handleSplitSelect}
                onClose={() => setSplitMenuOpen(false)}
              />
            )}
          </AnimatePresence>
        </div>
      )}

      {/*
       * Terminal pane container — switches layout mode but NEVER remounts TerminalView.
       *
       * Normal mode: position:relative with absolute-positioned children (only active visible).
       * Split view: CSS Grid for in-scope tabs. Out-of-scope tabs stay
       *   absolutely positioned + hidden (preserving their PTY sessions).
       */}
      <div
        className={
          splitViewActive
            ? 'h-full flex-1 min-w-0 grid gap-px bg-white/5 relative'
            : canvasFullscreen
              ? 'h-full relative overflow-hidden'
              : showCanvas
                ? 'h-full flex-1 min-w-[300px] relative'
                : 'h-full flex-1 min-w-0 relative'
        }
        style={
          splitViewActive
            ? getGridStyle(splitGridCount)
            : canvasFullscreen
              ? { width: 0 }
              : undefined
        }
      >
        {tabList.map((tab) => {
          const isActive = tab.id === activeTabId
          const inSplitGrid = splitGridIds.has(tab.id)
          const splitIndex = inSplitGrid ? splitGridOrder.indexOf(tab.id) : -1
          const splitTab = splitTabs.find((s) => s.id === tab.id)

          const isGridChild = splitViewActive && inSplitGrid
          const isHidden = splitViewActive ? !inSplitGrid : !isActive

          return (
            <TabPane
              key={tab.id}
              tabId={tab.id}
              projectPath={tab.projectPath}
              projectName={tab.projectPath.split('/').pop() || 'project'}
              isActive={isActive}
              isGridChild={isGridChild}
              isHidden={isHidden}
              splitIndex={splitIndex}
              splitGridCount={splitGridCount}
              splitTab={splitTab}
              splitViewActive={splitViewActive}
              onSelectSplitPane={handleSelectSplitPane}
            />
          )
        })}
      </div>

      {/* Canvas pane — collapsed to 0 during split view, full-width when fullscreen */}
      <div
        className={`h-full flex overflow-hidden bg-[var(--bg-secondary)] ${canvasFullscreen ? 'flex-1' : ''}`}
        style={{
          width: canvasFullscreen ? undefined : (splitViewActive ? 0 : canvasWidth),
          opacity: (canvasFullscreen || canvasWidth > 0) && !splitViewActive ? 1 : 0,
          transition: 'opacity 150ms ease',
        }}
      >
        {!canvasFullscreen && canvasWidth > 0 && !splitViewActive && (
          <div
            className="h-full flex-shrink-0 flex items-center justify-center group cursor-col-resize"
            style={{ width: 10, touchAction: 'none' }}
            onPointerDown={onDividerPointerDown}
            onPointerMove={onDividerPointerMove}
            onPointerUp={onDividerPointerUp}
            onLostPointerCapture={onDividerPointerUp}
          >
            <div className="w-px h-full bg-white/10 group-hover:bg-cyan-400/40 transition-colors duration-200" />
          </div>
        )}
        <div className="flex-1 h-full min-w-0 overflow-hidden">
          <CanvasPanel />
        </div>
      </div>
    </div>
  )
}
