import { useTabState } from '@/hooks/useTabState'
import type { CanvasTab } from '@/types/canvas'
import { useWorkspaceStore } from '@/stores/workspace'
import { useFileWatcher } from '@/hooks/useFileWatcher'
import { useInspector } from '@/hooks/useInspector'
import { useRef, useCallback, useState, useEffect } from 'react'
import { X, RotateCw, Camera, Monitor, ChevronDown, XCircle } from 'lucide-react'
import { ScreenshotOverlay } from './ScreenshotOverlay'
import { ConsoleOverlay } from './ConsoleOverlay'
import { Gallery } from '../Gallery/Gallery'
import { Timeline } from '../CheckpointTimeline/Timeline'
import { DiffView } from '../DiffView/DiffView'
import { DeployLog } from './DeployLog'
import { A11yAudit } from './A11yAudit'
import { PerfMetrics } from './PerfMetrics'
import { DesignFeedback } from './DesignFeedback'
import { VIEWPORT_PRESETS } from '../../../shared/constants'

export function CanvasPanel() {
  const { tab, update } = useTabState()
  const activeTab = tab?.activeCanvasTab || 'preview'
  const previewUrl = tab?.previewUrl || null
  const screenshotMode = tab?.screenshotMode || false
  const viewportWidth = tab?.viewportWidth ?? 0
  const { closeCanvas } = useWorkspaceStore()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const { injectInspector, clearHighlight } = useInspector(iframeRef)
  const inspectorActive = tab?.inspectorActive ?? false
  const selectedCount = tab?.selectedElements.length ?? 0
  const [showViewportMenu, setShowViewportMenu] = useState(false)

  // Recover dev server state after HMR — query main process for running servers
  // Uses stale-closure guard: captures project path at effect start, verifies
  // it still matches when the async response arrives (prevents cross-tab leaks)
  useEffect(() => {
    if (previewUrl || !tab?.project?.path) return
    let stale = false
    const capturedPath = tab.project.path
    window.api.dev.status(capturedPath).then(({ running, url }) => {
      if (stale) return // Tab switched before response
      if (running && url) {
        update({ previewUrl: url, dev: { status: 'running', url } })
      }
    })
    return () => { stale = true }
  }, [tab?.project?.path]) // eslint-disable-line react-hooks/exhaustive-deps

  const reloadIframe = useCallback(() => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src
    }
  }, [])

  useFileWatcher(
    useCallback((_path: string) => {
      // HMR handles most updates; watcher for non-HMR scenarios
    }, [])
  )

  const tabs: CanvasTab[] = ['preview', 'gallery', 'timeline', 'diff', 'deploy', 'a11y']
  const currentPreset = VIEWPORT_PRESETS.find((p) => p.width === viewportWidth) || VIEWPORT_PRESETS[0]

  return (
    <div data-canvas-panel className={`h-full flex flex-col bg-[var(--bg-secondary)] ${inspectorActive ? 'border-t-2 border-[var(--accent-cyan)]' : ''}`}>
      {/* Tab bar with controls */}
      <div className="h-8 flex items-center justify-between px-2 border-b border-white/10">
        <div className="flex items-center gap-1">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => update({ activeCanvasTab: tab })}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                activeTab === tab
                  ? 'bg-white/10 text-white'
                  : 'text-white/40 hover:text-white/60'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {/* Viewport preset dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowViewportMenu((v) => !v)}
              className="flex items-center gap-1 px-2 py-1 text-xs text-white/50 hover:text-white/80 hover:bg-white/10 rounded transition-colors"
              title="Viewport size"
            >
              <Monitor size={11} />
              <span>{currentPreset.label}</span>
              {viewportWidth > 0 && <span className="text-white/30">{viewportWidth}px</span>}
              <ChevronDown size={10} />
            </button>

            {showViewportMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowViewportMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 bg-[var(--bg-secondary)] border border-white/10 rounded-lg py-1 shadow-xl min-w-[180px]">
                  {VIEWPORT_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      onClick={() => {
                        update({ viewportWidth: preset.width })
                        setShowViewportMenu(false)
                      }}
                      className={`w-full flex items-center justify-between px-3 py-1.5 text-xs hover:bg-white/5 transition-colors ${
                        viewportWidth === preset.width ? 'text-[var(--accent-cyan)]' : 'text-white/60'
                      }`}
                    >
                      <span>{preset.label}</span>
                      {preset.width > 0 && <span className="text-white/30">{preset.width}px</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Clear selection button (visible when inspector has selections) */}
          {inspectorActive && selectedCount > 0 && (
            <>
              <button
                onClick={clearHighlight}
                className="flex items-center gap-1 px-2 py-1 text-xs text-cyan-400 hover:text-cyan-300 hover:bg-white/10 rounded transition-colors"
                title="Clear inspector selection"
              >
                <XCircle size={11} />
                <span>Clear ({selectedCount})</span>
              </button>
              <div className="w-px h-3 bg-white/10 mx-0.5" />
            </>
          )}

          <PerfMetrics />

          <div className="w-px h-3 bg-white/10 mx-0.5" />

          <button
            onClick={reloadIframe}
            className="p-1 hover:bg-white/10 rounded transition-colors"
            title="Reload preview"
          >
            <RotateCw size={12} className="text-white/40" />
          </button>
          <button
            onClick={() => {
              update({ activeCanvasTab: 'preview', screenshotMode: true })
            }}
            className={`p-1 hover:bg-white/10 rounded transition-colors ${screenshotMode ? 'bg-cyan-500/20' : ''}`}
            title="Capture screenshot"
          >
            <Camera size={12} className={screenshotMode ? 'text-cyan-400' : 'text-white/40'} />
          </button>
          <DesignFeedback />
          <button onClick={closeCanvas} className="p-1 hover:bg-white/10 rounded transition-colors" title="Close canvas">
            <X size={12} className="text-white/40" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 relative overflow-hidden">
        {activeTab === 'preview' &&
          (previewUrl ? (
            <>
              <div className="w-full h-full flex justify-center bg-neutral-100">
                <iframe
                  ref={iframeRef}
                  name="claude-canvas-preview"
                  src={previewUrl}
                  className="h-full border-0 bg-white"
                  style={{ width: viewportWidth > 0 ? `${viewportWidth}px` : '100%', maxWidth: '100%' }}
                  title="Canvas Preview"
                  sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
                  onLoad={injectInspector}
                />
              </div>
              {screenshotMode && <ScreenshotOverlay />}
              {inspectorActive && (
                <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 px-3 py-1 rounded-full bg-[var(--accent-cyan)]/10 border border-[var(--accent-cyan)]/30 text-[10px] text-cyan-300 pointer-events-none">
                  Click elements to inspect &middot; Press ESC to exit
                </div>
              )}
              <ConsoleOverlay />
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-white/30 text-sm">
              Start a dev server to see your app here
            </div>
          ))}
        {activeTab === 'gallery' && <Gallery />}
        {activeTab === 'timeline' && <Timeline />}
        {activeTab === 'diff' && <DiffView />}
        {activeTab === 'deploy' && <DeployLog />}
        {activeTab === 'a11y' && <A11yAudit />}
      </div>
    </div>
  )
}
