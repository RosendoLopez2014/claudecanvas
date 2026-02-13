import { useCanvasStore, CanvasTab } from '@/stores/canvas'
import { useWorkspaceStore } from '@/stores/workspace'
import { useFileWatcher } from '@/hooks/useFileWatcher'
import { useInspector } from '@/hooks/useInspector'
import { useRef, useCallback } from 'react'
import { X, RotateCw } from 'lucide-react'

export function CanvasPanel() {
  const { previewUrl, activeTab, setActiveTab } = useCanvasStore()
  const { closeCanvas } = useWorkspaceStore()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const { injectInspector } = useInspector(iframeRef)

  const reloadIframe = useCallback(() => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src
    }
  }, [])

  // Reload canvas on file changes (debounced by chokidar's awaitWriteFinish)
  useFileWatcher(
    useCallback((_path: string) => {
      // HMR handles most updates automatically via the Vite dev server.
      // This watcher is here for non-HMR scenarios (e.g. CSS-only files,
      // static assets) where a hard reload may be needed.
    }, [])
  )

  const tabs: CanvasTab[] = ['preview', 'gallery', 'timeline', 'diff']

  return (
    <div className="h-full flex flex-col bg-[var(--bg-secondary)]">
      {/* Tab bar with controls */}
      <div className="h-8 flex items-center justify-between px-2 border-b border-white/10">
        <div className="flex items-center gap-1">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
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
          <button
            onClick={reloadIframe}
            className="p-1 hover:bg-white/10 rounded transition-colors"
          >
            <RotateCw size={12} className="text-white/40" />
          </button>
          <button onClick={closeCanvas} className="p-1 hover:bg-white/10 rounded transition-colors">
            <X size={12} className="text-white/40" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 relative">
        {activeTab === 'preview' &&
          (previewUrl ? (
            <iframe
              ref={iframeRef}
              src={previewUrl}
              className="w-full h-full border-0 bg-white"
              title="Canvas Preview"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
              onLoad={injectInspector}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-white/30 text-sm">
              Start a dev server to see your app here
            </div>
          ))}
        {activeTab === 'gallery' && (
          <div className="h-full flex items-center justify-center text-white/30 text-sm">
            Gallery — component variants
          </div>
        )}
        {activeTab === 'timeline' && (
          <div className="h-full flex items-center justify-center text-white/30 text-sm">
            Timeline — checkpoint snapshots
          </div>
        )}
        {activeTab === 'diff' && (
          <div className="h-full flex items-center justify-center text-white/30 text-sm">
            Diff — visual comparison
          </div>
        )}
      </div>
    </div>
  )
}
