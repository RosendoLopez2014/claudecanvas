import { useGalleryStore, type GalleryVariant, type PreviewMode } from '@/stores/gallery'
import { X, Wand2, FileCode2, ChevronDown, Zap, AlertCircle, Loader2, Monitor } from 'lucide-react'
import { useState, useRef, useEffect, useCallback, memo } from 'react'
import { VIEWPORT_PRESETS, BLEED, DEFAULT_CARD_HEIGHT, Tip, typeIntoTerminal } from './constants'

export interface GalleryCardProps {
  variant: GalleryVariant
  isSelected: boolean
  isInteracting?: boolean
  onSelect: () => void
  onEnterInteract?: () => void
  onExitInteract?: () => void
  onHeightMeasured?: (id: string, height: number) => void
  onSizeMeasured?: (id: string, width: number, height: number) => void
}

export const GalleryCard = memo(function GalleryCard({
  variant,
  isSelected,
  onSelect,
  onHeightMeasured,
  onSizeMeasured,
  isInteracting = false,
  onEnterInteract,
  onExitInteract,
}: GalleryCardProps) {
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
}, (prev, next) => {
  return prev.variant.id === next.variant.id
    && prev.variant.previewStatus === next.variant.previewStatus
    && prev.variant.previewMode === next.variant.previewMode
    && prev.variant.viewportWidth === next.variant.viewportWidth
    && prev.variant.html === next.variant.html
    && prev.variant.css === next.variant.css
    && prev.variant.previewUrl === next.variant.previewUrl
    && prev.variant.status === next.variant.status
    && prev.isSelected === next.isSelected
    && prev.isInteracting === next.isInteracting
})
