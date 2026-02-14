import { useRef, useEffect, useState, useCallback } from 'react'
import { TerminalView } from '../Terminal/TerminalView'
import { CanvasPanel } from '../Canvas/CanvasPanel'
import { FileExplorer } from '../FileExplorer/FileExplorer'
import { useWorkspaceStore } from '@/stores/workspace'
import { useCanvasStore } from '@/stores/canvas'
import { useProjectStore } from '@/stores/project'
import { useTabsStore } from '@/stores/tabs'

const TERMINAL_ONLY_WIDTH = 960
const CANVAS_MOBILE_WIDTH = 1100
const WINDOW_HEIGHT = 800

// Terminal gets a narrow column in desktop mode so canvas is as wide as possible
const TERMINAL_MIN = 380

const TRANSITION = 'width 300ms cubic-bezier(0.25, 0.1, 0.25, 1)'

export function Workspace() {
  const { mode, fileExplorerOpen } = useWorkspaceStore()
  const { viewportMode } = useCanvasStore()
  const { currentProject } = useProjectStore()
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const activeTab = useTabsStore((s) => s.getActiveTab())
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

  // Animate window size on canvas open/close
  useEffect(() => {
    if (!showCanvas) {
      window.api.window.setSize(TERMINAL_ONLY_WIDTH, WINDOW_HEIGHT, true)
    } else if (isMobile) {
      window.api.window.setSize(CANVAS_MOBILE_WIDTH, WINDOW_HEIGHT, true)
    } else {
      // Desktop: maximize to give canvas maximum real estate
      window.api.window.maximize()
    }
  }, [showCanvas, isMobile])

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

  return (
    <div ref={containerRef} className="h-full flex overflow-hidden">
      {/* File explorer sidebar */}
      {fileExplorerOpen && <FileExplorer />}

      {/* Terminal pane — takes remaining space */}
      <div className="h-full flex-1 min-w-[300px]">
        <TerminalView
          cwd={activeTab?.project.path || currentProject?.path}
          tabId={activeTabId || undefined}
        />
      </div>

      {/* Canvas pane — animated width, always mounted to avoid remount cost */}
      <div
        className="h-full flex overflow-hidden"
        style={{
          width: canvasWidth,
          transition: shouldTransition ? TRANSITION : 'none',
          willChange: isAnimating ? 'width' : 'auto'
        }}
      >
        {/* Divider */}
        {canvasWidth > 0 && (
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
