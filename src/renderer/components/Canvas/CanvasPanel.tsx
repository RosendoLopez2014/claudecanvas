import { useTabState } from '@/hooks/useTabState'
import { type CanvasTab } from '@/stores/canvas'
import { useWorkspaceStore } from '@/stores/workspace'
import { useFileWatcher } from '@/hooks/useFileWatcher'
import { useInspector } from '@/hooks/useInspector'
import { useRef, useCallback } from 'react'
import { X, RotateCw, Camera, Monitor, Smartphone } from 'lucide-react'
import { ScreenshotOverlay } from './ScreenshotOverlay'
import { Gallery } from '../Gallery/Gallery'
import { Timeline } from '../CheckpointTimeline/Timeline'
import { DiffView } from '../DiffView/DiffView'

export function CanvasPanel() {
  const { tab, update } = useTabState()
  const activeTab = tab?.activeCanvasTab || 'preview'
  const previewUrl = tab?.previewUrl || null
  const screenshotMode = tab?.screenshotMode || false
  const viewportMode = tab?.viewportMode || 'desktop'
  const { closeCanvas } = useWorkspaceStore()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const { injectInspector } = useInspector(iframeRef)

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

  const tabs: CanvasTab[] = ['preview', 'gallery', 'timeline', 'diff']
  const isMobile = viewportMode === 'mobile'

  return (
    <div data-canvas-panel className="h-full flex flex-col bg-[var(--bg-secondary)]">
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
          {/* Viewport toggles */}
          <button
            onClick={() => update({ viewportMode: 'desktop' })}
            className={`p-1 hover:bg-white/10 rounded transition-colors ${!isMobile ? 'bg-white/10' : ''}`}
            title="Desktop view"
          >
            <Monitor size={12} className={!isMobile ? 'text-white' : 'text-white/40'} />
          </button>
          <button
            onClick={() => update({ viewportMode: 'mobile' })}
            className={`p-1 hover:bg-white/10 rounded transition-colors ${isMobile ? 'bg-white/10' : ''}`}
            title="Mobile view (375px)"
          >
            <Smartphone size={12} className={isMobile ? 'text-white' : 'text-white/40'} />
          </button>

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
              <iframe
                ref={iframeRef}
                name="claude-canvas-preview"
                src={previewUrl}
                className="w-full h-full border-0 bg-white"
                title="Canvas Preview"
                sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
                onLoad={injectInspector}
              />
              {screenshotMode && <ScreenshotOverlay />}
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-white/30 text-sm">
              Start a dev server to see your app here
            </div>
          ))}
        {activeTab === 'gallery' && <Gallery />}
        {activeTab === 'timeline' && <Timeline />}
        {activeTab === 'diff' && <DiffView />}
      </div>
    </div>
  )
}
