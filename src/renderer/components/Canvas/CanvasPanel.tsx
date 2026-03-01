import { useTabState } from '@/hooks/useTabState'
import type { CanvasTab } from '@/types/canvas'
import { useWorkspaceStore } from '@/stores/workspace'
import { useTabsStore } from '@/stores/tabs'
import { useToastStore } from '@/stores/toast'
import { useFileWatcher } from '@/hooks/useFileWatcher'
import { useInspector } from '@/hooks/useInspector'
import { useRef, useCallback, useState, useEffect } from 'react'
import { X, RotateCw, Camera, Monitor, Smartphone, Tablet, ChevronDown, XCircle, Maximize, Minimize, ArrowLeft, ArrowRight, Globe, ScanLine } from 'lucide-react'
import type { DeviceType } from '../../../shared/constants'
import { ScreenshotOverlay } from './ScreenshotOverlay'
import { ConsoleOverlay } from './ConsoleOverlay'
import { Gallery } from '../Gallery/Gallery'
import { Timeline } from '../CheckpointTimeline/Timeline'
import { DiffView } from '../DiffView/DiffView'
import { DeployLog } from './DeployLog'
import { A11yAudit } from './A11yAudit'
import { CriticPanel } from './CriticPanel'
import { PerfMetrics } from './PerfMetrics'
import { DesignFeedback } from './DesignFeedback'
import { VIEWPORT_PRESETS } from '../../../shared/constants'

const DEVICE_ICONS: Record<string, typeof Monitor> = {
  none: Maximize,
  mobile: Smartphone,
  tablet: Tablet,
}

// Natural device dimensions (screen + bezels)
const DEVICE_DIMS = {
  mobile: { w: 414, h: 896, padTop: 48, padBot: 34, padX: 12, frameR: 48, screenR: 40 },
  tablet: { w: 796, h: 1072, padTop: 28, padBot: 28, padX: 14, frameR: 22, screenR: 12 },
}

/** Realistic device frame that auto-scales to fit its container */
function DeviceFrame({ device, children }: { device: DeviceType; children: React.ReactNode }) {
  if (device === 'none') return <>{children}</>

  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.7)
  const isMobile = device === 'mobile'
  const dims = DEVICE_DIMS[device]

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const compute = () => {
      const { width, height } = el.getBoundingClientRect()
      const s = Math.min(1, (height - 24) / dims.h, (width - 24) / dims.w)
      setScale(Math.max(0.3, s))
    }
    compute()
    const obs = new ResizeObserver(compute)
    obs.observe(el)
    return () => obs.disconnect()
  }, [dims.w, dims.h])

  return (
    <div ref={containerRef} className="w-full h-full flex items-center justify-center">
      {/* Scaled wrapper — layout size matches visual size */}
      <div style={{ width: dims.w * scale, height: dims.h * scale }}>
        <div
          style={{
            width: dims.w,
            height: dims.h,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            padding: `${dims.padTop}px ${dims.padX}px ${dims.padBot}px`,
            borderRadius: dims.frameR,
            background: 'linear-gradient(145deg, #2a2a2e 0%, #1a1a1e 100%)',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 25px 60px -12px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)',
            display: 'flex',
            flexDirection: 'column' as const,
            position: 'relative' as const,
          }}
        >
          {/* Dynamic Island (mobile only) */}
          {isMobile && (
            <div
              style={{
                position: 'absolute',
                top: 14,
                left: '50%',
                transform: 'translateX(-50%)',
                width: 100,
                height: 28,
                borderRadius: 14,
                background: '#000',
                boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.5)',
              }}
            />
          )}

          {/* Screen area — fills remaining space */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              borderRadius: dims.screenR,
              overflow: 'hidden',
              background: '#fff',
            }}
          >
            {children}
          </div>

          {/* Home Indicator */}
          <div
            style={{
              position: 'absolute',
              bottom: isMobile ? 11 : 9,
              left: '50%',
              transform: 'translateX(-50%)',
              width: isMobile ? 120 : 80,
              height: 4,
              borderRadius: 2,
              background: 'rgba(255,255,255,0.15)',
            }}
          />
        </div>
      </div>
    </div>
  )
}

/** Mini browser toolbar — back/forward, URL bar, reload */
function BrowserBar({ iframeRef, previewUrl, onReload }: {
  iframeRef: React.RefObject<HTMLIFrameElement | null>
  previewUrl: string
  onReload: () => void
}) {
  const [currentUrl, setCurrentUrl] = useState(previewUrl)
  const [editUrl, setEditUrl] = useState(previewUrl)
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Sync when previewUrl changes
  useEffect(() => {
    setCurrentUrl(previewUrl)
    if (!editing) setEditUrl(previewUrl)
  }, [previewUrl, editing])

  // Track iframe navigation via src changes on load
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    const handleLoad = () => {
      // Try same-origin access first, fall back to iframe.src
      let url = ''
      try { url = iframe.contentWindow?.location.href || '' } catch {}
      if (!url) url = iframe.src || previewUrl
      setCurrentUrl(url)
      if (!editing) setEditUrl(url)
    }
    iframe.addEventListener('load', handleLoad)
    return () => iframe.removeEventListener('load', handleLoad)
  }, [iframeRef, previewUrl, editing])

  const goBack = useCallback(() => {
    try { iframeRef.current?.contentWindow?.history.back() } catch {}
  }, [iframeRef])

  const goForward = useCallback(() => {
    try { iframeRef.current?.contentWindow?.history.forward() } catch {}
  }, [iframeRef])

  const navigate = useCallback((url: string) => {
    if (!iframeRef.current) return
    let target = url.trim()
    // Allow relative paths like /about
    if (target.startsWith('/')) {
      const base = new URL(previewUrl)
      target = base.origin + target
    } else if (!target.startsWith('http://') && !target.startsWith('https://')) {
      target = 'http://' + target
    }
    iframeRef.current.src = target
    setCurrentUrl(target)
    setEditing(false)
  }, [iframeRef, previewUrl])

  // Display: show full URL but highlight the path portion
  const displayUrl = currentUrl || previewUrl

  return (
    <div className="flex items-center gap-1 px-2 py-1 bg-[var(--bg-primary)] border-b border-white/5">
      <button
        onClick={goBack}
        className="p-1 rounded hover:bg-white/10 transition-colors"
        title="Back"
      >
        <ArrowLeft size={12} className="text-white/40" />
      </button>
      <button
        onClick={goForward}
        className="p-1 rounded hover:bg-white/10 transition-colors"
        title="Forward"
      >
        <ArrowRight size={12} className="text-white/40" />
      </button>
      <button
        onClick={onReload}
        className="p-1 rounded hover:bg-white/10 transition-colors"
        title="Reload"
      >
        <RotateCw size={11} className="text-white/40" />
      </button>
      <div
        className="flex-1 flex items-center gap-1.5 px-2 py-0.5 rounded bg-white/5 hover:bg-white/8 border border-white/5 cursor-text min-w-0"
        onClick={() => {
          setEditing(true)
          setEditUrl(currentUrl)
          setTimeout(() => inputRef.current?.select(), 0)
        }}
      >
        <Globe size={10} className="text-white/20 flex-shrink-0" />
        {editing ? (
          <input
            ref={inputRef}
            type="text"
            value={editUrl}
            onChange={(e) => setEditUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') navigate(editUrl)
              if (e.key === 'Escape') setEditing(false)
            }}
            onBlur={() => setEditing(false)}
            className="flex-1 bg-transparent text-[11px] text-white/80 outline-none min-w-0"
            autoFocus
          />
        ) : (
          <span className="text-[11px] text-white/40 truncate">{displayUrl}</span>
        )}
      </div>
    </div>
  )
}

export function CanvasPanel() {
  const { tab, update } = useTabState()
  const activeTab = tab?.activeCanvasTab || 'preview'
  const previewUrl = tab?.previewUrl || null
  const screenshotMode = tab?.screenshotMode || false
  const viewportWidth = tab?.viewportWidth ?? 0
  const { closeCanvas, canvasFullscreen, toggleCanvasFullscreen } = useWorkspaceStore()
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

  const captureFullPreview = useCallback(async () => {
    const iframe = iframeRef.current
    if (!iframe) return
    const rect = iframe.getBoundingClientRect()
    try {
      const filepath = await window.api.screenshot.capture({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      })
      const activeTab = useTabsStore.getState().getActiveTab()
      if (activeTab?.ptyId) {
        window.api.pty.write(
          activeTab.ptyId,
          `Look at this full-page screenshot I just captured: ${filepath}\r`
        )
      }
      useToastStore.getState().addToast('Full screenshot pasted to terminal', 'success')
    } catch {
      useToastStore.getState().addToast('Screenshot capture failed', 'error')
    }
  }, [])

  useFileWatcher(
    useCallback((_path: string) => {
      // HMR handles most updates; watcher for non-HMR scenarios
    }, [])
  )

  const tabs: CanvasTab[] = ['preview', 'gallery', 'timeline', 'diff', 'deploy', 'a11y', 'critic']
  const currentPreset = VIEWPORT_PRESETS.find((p) => p.width === viewportWidth) || VIEWPORT_PRESETS[0]

  return (
    <div data-canvas-panel className={`h-full flex flex-col bg-[var(--bg-secondary)] ${inspectorActive ? 'border-t-2 border-[var(--accent-cyan)]' : ''}`}>
      {/* Tab bar with controls */}
      <div className="h-8 flex items-center px-2 border-b border-white/10 gap-1">
        <div className="flex items-center gap-0.5 overflow-x-auto flex-shrink min-w-0 scrollbar-none">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => update({ activeCanvasTab: tab })}
              className={`px-2 py-1 text-[11px] rounded transition-colors whitespace-nowrap flex-shrink-0 ${
                activeTab === tab
                  ? 'bg-white/10 text-white'
                  : 'text-white/40 hover:text-white/60'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex-shrink-0 ml-auto" />
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Viewport preset dropdown */}
          <div className="relative">
            {(() => {
              const Icon = DEVICE_ICONS[currentPreset.device] || Monitor
              return (
                <button
                  onClick={() => setShowViewportMenu((v) => !v)}
                  className="flex items-center gap-1.5 px-2 py-1 text-xs text-white/50 hover:text-white/80 hover:bg-white/10 rounded transition-colors"
                  title="Viewport size"
                >
                  <Icon size={12} />
                  <span>{currentPreset.label}</span>
                  {viewportWidth > 0 && <span className="text-white/30">{viewportWidth}px</span>}
                  <ChevronDown size={10} />
                </button>
              )
            })()}

            {showViewportMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowViewportMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 bg-[var(--bg-primary)] border border-white/10 rounded-lg py-1.5 shadow-2xl min-w-[170px]">
                  {VIEWPORT_PRESETS.map((preset) => {
                    const Icon = DEVICE_ICONS[preset.device] || Monitor
                    const isActive = viewportWidth === preset.width
                    return (
                      <button
                        key={preset.label}
                        onClick={() => {
                          update({ viewportWidth: preset.width })
                          setShowViewportMenu(false)
                        }}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 text-[11px] hover:bg-white/5 transition-colors ${
                          isActive ? 'text-[var(--accent-cyan)]' : 'text-white/60'
                        }`}
                      >
                        <Icon size={13} className={isActive ? 'text-[var(--accent-cyan)]' : 'text-white/30'} />
                        <span className="flex-1 text-left">{preset.label}</span>
                        {preset.width > 0 && (
                          <span className={isActive ? 'text-[var(--accent-cyan)]/50' : 'text-white/20'}>{preset.width}</span>
                        )}
                      </button>
                    )
                  })}
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
            onClick={captureFullPreview}
            className="p-1 hover:bg-white/10 rounded transition-colors"
            title="Full page screenshot"
          >
            <ScanLine size={12} className="text-white/40" />
          </button>
          <button
            onClick={() => {
              update({ activeCanvasTab: 'preview', screenshotMode: true })
            }}
            className={`p-1 hover:bg-white/10 rounded transition-colors ${screenshotMode ? 'bg-cyan-500/20' : ''}`}
            title="Select area screenshot"
          >
            <Camera size={12} className={screenshotMode ? 'text-cyan-400' : 'text-white/40'} />
          </button>
          <DesignFeedback />
          <button
            onClick={toggleCanvasFullscreen}
            className={`p-1 hover:bg-white/10 rounded transition-colors ${canvasFullscreen ? 'bg-cyan-500/20' : ''}`}
            title={canvasFullscreen ? 'Exit fullscreen (\u2318\u21e7\\)' : 'Fullscreen canvas (\u2318\u21e7\\)'}
          >
            {canvasFullscreen
              ? <Minimize size={12} className="text-cyan-400" />
              : <Maximize size={12} className="text-white/40" />
            }
          </button>
          <button onClick={closeCanvas} className="p-1 hover:bg-white/10 rounded transition-colors" title="Close canvas">
            <X size={12} className="text-white/40" />
          </button>
        </div>
      </div>

      {/* Browser bar — only in preview tab with active URL */}
      {activeTab === 'preview' && previewUrl && (
        <BrowserBar iframeRef={iframeRef} previewUrl={previewUrl} onReload={reloadIframe} />
      )}

      {/* Content */}
      <div className="flex-1 relative overflow-hidden">
        {activeTab === 'preview' &&
          (previewUrl ? (
            <>
              <div
                className="w-full h-full flex items-center justify-center overflow-auto"
                style={{
                  background: currentPreset.device !== 'none'
                    ? 'radial-gradient(circle at 50% 30%, rgba(255,255,255,0.03) 0%, transparent 70%)'
                    : undefined,
                }}
              >
                <DeviceFrame device={currentPreset.device as DeviceType}>
                  <iframe
                    ref={iframeRef}
                    name="claude-canvas-preview"
                    src={previewUrl}
                    className="border-0 bg-white"
                    style={{
                      // Inside a device frame, oversize by 16px so the iframe's
                      // scrollbar hides behind the screen area's overflow:hidden clip
                      width: currentPreset.device !== 'none' ? 'calc(100% + 16px)'
                        : viewportWidth > 0 ? `${viewportWidth}px` : '100%',
                      height: '100%',
                      maxWidth: currentPreset.device !== 'none' ? undefined : '100%',
                    }}
                    title="Canvas Preview"
                    sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
                    onLoad={injectInspector}
                  />
                </DeviceFrame>
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
        {activeTab === 'critic' && <CriticPanel />}
      </div>
    </div>
  )
}
