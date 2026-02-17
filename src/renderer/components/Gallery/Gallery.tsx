import { useGalleryStore, type GalleryVariant, type DesignSession } from '@/stores/gallery'
import { useTerminalStore } from '@/stores/terminal'
import { X, Copy, Download, Check, Maximize2, Wand2, FileCode2, ArrowLeftRight, ChevronDown } from 'lucide-react'
import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'

/** Tiny hover tooltip — shows label immediately below the trigger element */
function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="relative group/tip">
      {children}
      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 bg-black/90 border border-white/10 text-[10px] text-white/90 rounded whitespace-nowrap opacity-0 group-hover/tip:opacity-100 transition-opacity pointer-events-none z-20 shadow-lg">
        {label}
      </div>
    </div>
  )
}

/** Write text into the active terminal (no Enter — user decides when to submit) */
function typeIntoTerminal(text: string): void {
  const { ptyId } = useTerminalStore.getState()
  if (!ptyId) return
  window.api.pty.write(ptyId, text)
}

/** Virtual render width — iframe renders at desktop width for proper layout */
const RENDER_WIDTH = 800
/** Default max visible card height (after scaling) before clipping */
const DEFAULT_MAX_HEIGHT = 500

// ─── Main Gallery Component ─────────────────────────────────────────────────

export function Gallery() {
  const { variants, viewMode } = useGalleryStore()

  if (variants.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-white/30 text-sm">
        <div className="text-center space-y-3 max-w-[280px]">
          <div className="w-10 h-10 mx-auto rounded-lg bg-white/5 flex items-center justify-center">
            <span className="text-lg">🎨</span>
          </div>
          <p className="font-medium text-white/40">Component Gallery</p>
          <p className="text-xs text-white/20 leading-relaxed">
            Ask Claude to render a component and it will appear here as a visual preview. Try:
          </p>
          <p className="text-[11px] text-[var(--accent-cyan)]/60 font-mono bg-white/5 rounded px-3 py-2">
            &quot;Render a signup form and add it to the gallery&quot;
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <GalleryToolbar />
      <div className="flex-1 overflow-auto">
        {viewMode === 'grid' && <GridView />}
        {viewMode === 'compare' && <CompareView />}
        {viewMode === 'session' && <SessionView />}
      </div>
    </div>
  )
}

// ─── Toolbar ─────────────────────────────────────────────────────────────────

function GalleryToolbar() {
  const { viewMode, setViewMode, sessions, activeSessionId, setActiveSession } = useGalleryStore()
  const [sessionDropdownOpen, setSessionDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!sessionDropdownOpen) return
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setSessionDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [sessionDropdownOpen])

  const activeSession = sessions.find((s) => s.id === activeSessionId)

  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
      {/* View mode toggle */}
      <div className="flex items-center gap-0.5 bg-white/5 rounded-md p-0.5">
        {(['grid', 'compare', 'session'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            className={`px-2.5 py-1 text-[10px] rounded transition-colors ${
              viewMode === mode
                ? 'bg-[var(--accent-cyan)]/15 text-[var(--accent-cyan)]'
                : 'text-white/30 hover:text-white/50'
            }`}
          >
            {mode.charAt(0).toUpperCase() + mode.slice(1)}
          </button>
        ))}
      </div>

      {/* Session selector (only in session mode) */}
      {viewMode === 'session' && sessions.length > 0 && (
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setSessionDropdownOpen(!sessionDropdownOpen)}
            className="flex items-center gap-1.5 bg-[var(--bg-primary)] border border-white/10 rounded text-[11px] text-white/60 px-2.5 py-1 hover:border-white/20 transition-colors"
          >
            <span className="truncate max-w-[150px]">
              {activeSession?.title || 'All sessions'}
            </span>
            <ChevronDown size={10} className={`transition-transform ${sessionDropdownOpen ? 'rotate-180' : ''}`} />
          </button>
          {sessionDropdownOpen && (
            <div className="absolute right-0 top-full mt-1 w-64 bg-[var(--bg-secondary)] border border-white/10 rounded-lg shadow-xl z-30 py-1 max-h-60 overflow-auto">
              <button
                onClick={() => { setActiveSession(null); setSessionDropdownOpen(false) }}
                className={`w-full text-left px-3 py-2 text-[11px] hover:bg-white/5 transition-colors ${
                  !activeSessionId ? 'text-[var(--accent-cyan)]' : 'text-white/50'
                }`}
              >
                All sessions
              </button>
              {sessions.map((s) => {
                const variantCount = useGalleryStore.getState().variants.filter(
                  (v) => v.sessionId === s.id
                ).length
                return (
                  <button
                    key={s.id}
                    onClick={() => { setActiveSession(s.id); setSessionDropdownOpen(false) }}
                    className={`w-full text-left px-3 py-2 hover:bg-white/5 transition-colors ${
                      activeSessionId === s.id ? 'bg-white/5' : ''
                    }`}
                  >
                    <div className="text-[11px] text-white/70">{s.title}</div>
                    <div className="flex items-center gap-2 text-[10px] text-white/30 mt-0.5">
                      <span>{variantCount} variant{variantCount !== 1 ? 's' : ''}</span>
                      <span>&middot;</span>
                      <span>{new Date(s.createdAt).toLocaleDateString()}</span>
                      {s.selectedId && (
                        <>
                          <span>&middot;</span>
                          <span className="text-[var(--accent-cyan)]/60">has selection</span>
                        </>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Grid View ───────────────────────────────────────────────────────────────

function GridView() {
  const { variants, selectedId, setSelectedId } = useGalleryStore()
  const [expandedId, setExpandedId] = useState<string | null>(null)

  return (
    <div className="p-4">
      <div className="grid grid-cols-2 gap-4">
        {variants.map((variant) => (
          <GalleryCard
            key={variant.id}
            variant={variant}
            isSelected={selectedId === variant.id}
            isExpanded={expandedId === variant.id}
            onSelect={() => setSelectedId(variant.id)}
            onToggleExpand={() => setExpandedId(expandedId === variant.id ? null : variant.id)}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Session View ────────────────────────────────────────────────────────────

function SessionHeader({ session }: { session: DesignSession }) {
  const variantCount = useGalleryStore((s) => s.variants.filter((v) => v.sessionId === session.id).length)
  return (
    <div className="mb-4 pb-3 border-b border-white/10">
      <h3 className="text-sm font-medium text-white/80">{session.title}</h3>
      <div className="flex items-center gap-2 mt-1 text-[11px] text-white/30">
        <span>{variantCount} proposal{variantCount !== 1 ? 's' : ''}</span>
        <span>&middot;</span>
        <span>{new Date(session.createdAt).toLocaleDateString()}</span>
        {session.prompt && (
          <>
            <span>&middot;</span>
            <span className="truncate max-w-[200px]">prompt: &quot;{session.prompt}&quot;</span>
          </>
        )}
      </div>
    </div>
  )
}

function SessionView() {
  const { variants, sessions, activeSessionId, selectedId, selectVariant } = useGalleryStore()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const activeSession = sessions.find((s) => s.id === activeSessionId)

  const displayVariants = activeSession
    ? variants.filter((v) => v.sessionId === activeSession.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    : variants.filter((v) => v.sessionId)

  const handleSelectInSession = (variantId: string) => {
    selectVariant(variantId)
    window.api.mcp.gallerySelect?.(variantId)
  }

  if (displayVariants.length === 0) {
    return (
      <div className="p-4 text-center text-white/30 text-sm py-8">
        {activeSession ? 'No variants in this session yet.' : 'No design sessions yet. Start one from Claude Code.'}
      </div>
    )
  }

  const colCount = displayVariants.length <= 2 ? 2 : 3

  return (
    <div className="p-4">
      {activeSession && <SessionHeader session={activeSession} />}
      <div className={`grid gap-4 ${colCount === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {displayVariants.map((variant) => (
          <GalleryCard
            key={variant.id}
            variant={variant}
            isSelected={selectedId === variant.id}
            isExpanded={expandedId === variant.id}
            onSelect={() => handleSelectInSession(variant.id)}
            onToggleExpand={() => setExpandedId(expandedId === variant.id ? null : variant.id)}
            sessionMode
          />
        ))}
      </div>
    </div>
  )
}

// ─── Compare View ────────────────────────────────────────────────────────────

function CompareView() {
  const { compareIds, variants, setCompareIds, selectVariant } = useGalleryStore()
  const [syncScroll, setSyncScroll] = useState(false)
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)

  if (!compareIds) {
    // If no compare pair selected, let user pick two from the list
    return <CompareSelector />
  }

  const [leftVariant, rightVariant] = compareIds.map((id) => variants.find((v) => v.id === id))
  if (!leftVariant || !rightVariant) return null

  const handleScroll = (source: 'left' | 'right') => {
    if (!syncScroll) return
    const from = source === 'left' ? leftRef.current : rightRef.current
    const to = source === 'left' ? rightRef.current : leftRef.current
    if (from && to) to.scrollTop = from.scrollTop
  }

  return (
    <div className="h-full flex flex-col">
      {/* Compare toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSyncScroll(!syncScroll)}
            className={`text-[10px] px-2 py-1 rounded ${
              syncScroll
                ? 'bg-[var(--accent-cyan)]/20 text-[var(--accent-cyan)]'
                : 'text-white/30 hover:text-white/50'
            }`}
          >
            Sync scroll
          </button>
          <button
            onClick={() => setCompareIds([compareIds[1], compareIds[0]])}
            className="text-[10px] text-white/30 hover:text-white/50 px-2 py-1"
          >
            Swap sides
          </button>
          <button
            onClick={() => setCompareIds(null)}
            className="text-[10px] text-white/30 hover:text-white/50 px-2 py-1"
          >
            Change pair
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => selectVariant(leftVariant.id)}
            className="text-[10px] px-3 py-1 rounded bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)] hover:bg-[var(--accent-cyan)]/20"
          >
            Pick left
          </button>
          <button
            onClick={() => selectVariant(rightVariant.id)}
            className="text-[10px] px-3 py-1 rounded bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)] hover:bg-[var(--accent-cyan)]/20"
          >
            Pick right
          </button>
        </div>
      </div>
      {/* Side-by-side iframes */}
      <div className="flex-1 flex gap-px bg-white/5">
        <div ref={leftRef} className="flex-1 overflow-auto p-3" onScroll={() => handleScroll('left')}>
          <GalleryCard
            variant={leftVariant}
            isSelected={leftVariant.status === 'selected'}
            isExpanded
            onSelect={() => {}}
            onToggleExpand={() => {}}
          />
        </div>
        <div ref={rightRef} className="flex-1 overflow-auto p-3" onScroll={() => handleScroll('right')}>
          <GalleryCard
            variant={rightVariant}
            isSelected={rightVariant.status === 'selected'}
            isExpanded
            onSelect={() => {}}
            onToggleExpand={() => {}}
          />
        </div>
      </div>
    </div>
  )
}

/** Let user pick two variants to compare */
function CompareSelector() {
  const { variants, setCompareIds } = useGalleryStore()
  const [pickedIds, setPickedIds] = useState<string[]>([])

  const toggle = (id: string) => {
    setPickedIds((prev) => {
      if (prev.includes(id)) return prev.filter((p) => p !== id)
      if (prev.length >= 2) return [prev[1], id]
      return [...prev, id]
    })
  }

  useEffect(() => {
    if (pickedIds.length === 2) {
      setCompareIds([pickedIds[0], pickedIds[1]])
    }
  }, [pickedIds, setCompareIds])

  return (
    <div className="p-4">
      <p className="text-[11px] text-white/40 mb-3 flex items-center gap-1.5">
        <ArrowLeftRight size={12} />
        Select two variants to compare side-by-side
      </p>
      <div className="grid grid-cols-3 gap-3">
        {variants.map((v) => (
          <button
            key={v.id}
            onClick={() => toggle(v.id)}
            className={`text-left p-2 rounded-lg border transition-colors ${
              pickedIds.includes(v.id)
                ? 'border-[var(--accent-cyan)] bg-[var(--accent-cyan)]/5'
                : 'border-white/10 hover:border-white/20'
            }`}
          >
            <div className="text-[11px] text-white/60 truncate">{v.label}</div>
            {v.status && (
              <div className="text-[9px] text-white/30 mt-0.5">{v.status}</div>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Gallery Card ────────────────────────────────────────────────────────────

function exportVariantHtml(variant: GalleryVariant) {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${variant.label}</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; }
    ${variant.css || ''}
  </style>
</head>
<body>
${variant.html}
</body>
</html>`

  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${variant.label.replace(/[^a-zA-Z0-9-_]/g, '-')}.html`
  a.click()
  URL.revokeObjectURL(url)
}

function GalleryCard({
  variant,
  isSelected,
  isExpanded,
  onSelect,
  onToggleExpand,
  sessionMode = false
}: {
  variant: GalleryVariant
  isSelected: boolean
  isExpanded: boolean
  onSelect: () => void
  onToggleExpand: () => void
  sessionMode?: boolean
}) {
  const { removeVariant, renameVariant, duplicateVariant } = useGalleryStore()
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(variant.label)
  const [contentHeight, setContentHeight] = useState(600)
  const [containerWidth, setContainerWidth] = useState(400)
  const [iframeError, setIframeError] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (renaming) inputRef.current?.focus()
  }, [renaming])

  const commitRename = () => {
    if (renameValue.trim()) {
      renameVariant(variant.id, renameValue.trim())
    }
    setRenaming(false)
  }

  // Track the card's actual pixel width for scale calculation
  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width)
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  // Measure iframe content height via same-origin contentDocument access
  const measureHeight = useCallback(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    try {
      const doc = iframe.contentDocument
      if (!doc?.body) return
      const height = Math.max(doc.body.scrollHeight, doc.documentElement?.scrollHeight || 0)
      if (height > 0) setContentHeight(height)
    } catch { /* cross-origin fallback */ }
  }, [])

  // Strip page-level backgrounds from the parent side via contentDocument
  const stripBackgrounds = useCallback(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    try {
      const doc = iframe.contentDocument
      if (!doc?.body) return
      const w = doc.body.scrollWidth || doc.body.offsetWidth
      doc.querySelectorAll('body *').forEach((el) => {
        const r = (el as HTMLElement).getBoundingClientRect()
        if (r.width >= w * 0.85) {
          ;(el as HTMLElement).style.setProperty('background', 'transparent', 'important')
          ;(el as HTMLElement).style.setProperty('background-color', 'transparent', 'important')
          ;(el as HTMLElement).style.setProperty('background-image', 'none', 'important')
        }
      })
    } catch { /* cross-origin fallback */ }
  }, [])

  // Re-measure and strip backgrounds after CSS animations settle
  useEffect(() => {
    const timer = setTimeout(() => {
      measureHeight()
      stripBackgrounds()
    }, 400)
    return () => clearTimeout(timer)
  }, [measureHeight, stripBackgrounds, variant.html])

  const srcdoc = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=${RENDER_WIDTH}, initial-scale=1" />
        <style>
          html { height: auto !important; min-height: 0 !important; background: transparent !important; }
          body { margin: 0; font-family: system-ui, sans-serif; height: auto !important; min-height: 0 !important; background: transparent !important; }
          ${variant.css || ''}
        </style>
      </head>
      <body>${variant.html}</body>
    </html>
  `

  // Scale-to-fit: render at RENDER_WIDTH, scale down to fit container
  const scale = containerWidth / RENDER_WIDTH
  const scaledHeight = contentHeight * scale
  const visibleHeight = isExpanded ? scaledHeight : Math.min(scaledHeight, DEFAULT_MAX_HEIGHT)
  const isClipped = !isExpanded && scaledHeight > DEFAULT_MAX_HEIGHT

  return (
    <div
      ref={containerRef}
      onClick={onSelect}
      className={`group relative rounded-lg overflow-hidden cursor-pointer ${
        isExpanded ? 'col-span-2' : ''
      } ${
        isSelected ? 'ring-2 ring-[var(--accent-cyan)]' : ''
      }`}
    >
      {/* Status badge */}
      {variant.status && variant.status !== 'proposal' && (
        <div className={`absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-medium z-10 ${
          variant.status === 'selected' ? 'bg-[var(--accent-cyan)]/20 text-[var(--accent-cyan)]' :
          variant.status === 'applied' ? 'bg-emerald-500/20 text-emerald-400' :
          variant.status === 'rejected' ? 'bg-red-500/20 text-red-400/60' : ''
        }`}>
          {variant.status === 'selected' ? 'Selected' :
           variant.status === 'applied' ? 'Applied' :
           variant.status === 'rejected' ? 'Rejected' : variant.status}
        </div>
      )}

      {/* Scaled preview */}
      <div className="overflow-hidden" style={{ height: visibleHeight }}>
        {iframeError ? (
          <div className="flex items-center justify-center text-white/30 text-xs p-4" style={{ height: visibleHeight }}>
            Failed to render preview
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            onLoad={() => { setIframeError(false); measureHeight(); setTimeout(stripBackgrounds, 100) }}
            onError={() => setIframeError(true)}
            srcDoc={srcdoc}
            style={{
              width: RENDER_WIDTH,
              height: contentHeight,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              border: 'none',
            }}
            title={variant.label}
            sandbox="allow-same-origin allow-scripts"
          />
        )}
      </div>

      {/* Annotations overlay — shown on hover */}
      {variant.annotations && variant.annotations.length > 0 && (
        <div className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
          {variant.annotations.map((ann, i) => (
            <div
              key={i}
              className="absolute pointer-events-auto"
              style={{ left: `${ann.x}%`, top: `${ann.y * scale}%` }}
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

      {/* Fade-out gradient when content is clipped */}
      {isClipped && (
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-[var(--bg-primary)] to-transparent pointer-events-none" />
      )}

      {/* Metadata panel — shown when variant has design metadata */}
      {(variant.description || (variant.pros && variant.pros.length > 0) || (variant.cons && variant.cons.length > 0)) && (
        <div className="px-3 py-2 bg-[var(--bg-secondary)] border-t border-white/5 space-y-2">
          {variant.description && (
            <p className="text-[11px] text-white/50 leading-relaxed">{variant.description}</p>
          )}
          {variant.pros && variant.pros.length > 0 && (
            <ul className="space-y-0.5">
              {variant.pros.map((pro, i) => (
                <li key={i} className="text-[11px] text-emerald-400/70 flex items-start gap-1.5">
                  <span className="mt-0.5 shrink-0">+</span>
                  <span>{pro}</span>
                </li>
              ))}
            </ul>
          )}
          {variant.cons && variant.cons.length > 0 && (
            <ul className="space-y-0.5">
              {variant.cons.map((con, i) => (
                <li key={i} className="text-[11px] text-red-400/70 flex items-start gap-1.5">
                  <span className="mt-0.5 shrink-0">-</span>
                  <span>{con}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Overlay label at bottom — visible on hover */}
      <div className="absolute bottom-0 left-0 right-0 px-3 py-2 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity z-10 flex items-end justify-between">
        {renaming ? (
          <div className="flex items-center gap-1 flex-1" onClick={(e) => e.stopPropagation()}>
            <input
              ref={inputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false) }}
              className="flex-1 bg-transparent text-xs text-white border-b border-[var(--accent-cyan)] outline-none px-0 py-0"
            />
            <button onClick={commitRename} className="text-cyan-400 hover:text-cyan-300">
              <Check size={10} />
            </button>
          </div>
        ) : (
          <span
            className="text-xs text-white/80 cursor-text"
            onDoubleClick={(e) => { e.stopPropagation(); setRenameValue(variant.label); setRenaming(true) }}
          >
            {variant.label}
          </span>
        )}
      </div>

      {/* Action buttons — top-right overlay on hover */}
      <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <Tip label="Edit with Claude">
          <button
            onClick={(e) => {
              e.stopPropagation()
              typeIntoTerminal(`Modify the gallery component "${variant.label}": `)
            }}
            className="p-1.5 bg-black/60 hover:bg-[var(--accent-cyan)]/80 rounded-md text-white/70 hover:text-white transition-colors"
          >
            <Wand2 size={12} />
          </button>
        </Tip>
        <Tip label="Apply to project">
          <button
            onClick={(e) => {
              e.stopPropagation()
              typeIntoTerminal(`Convert the gallery component "${variant.label}" into a React component and add it to my project`)
            }}
            className="p-1.5 bg-black/60 hover:bg-green-500/80 rounded-md text-white/70 hover:text-white transition-colors"
          >
            <FileCode2 size={12} />
          </button>
        </Tip>
        <Tip label={isExpanded ? 'Collapse' : 'Expand'}>
          <button
            onClick={(e) => { e.stopPropagation(); onToggleExpand() }}
            className="p-1.5 bg-black/60 hover:bg-black/80 rounded-md text-white/70 hover:text-white transition-colors"
          >
            <Maximize2 size={12} />
          </button>
        </Tip>
        <Tip label="Duplicate">
          <button
            onClick={(e) => { e.stopPropagation(); duplicateVariant(variant.id) }}
            className="p-1.5 bg-black/60 hover:bg-black/80 rounded-md text-white/70 hover:text-white transition-colors"
          >
            <Copy size={12} />
          </button>
        </Tip>
        <Tip label="Download HTML">
          <button
            onClick={(e) => { e.stopPropagation(); exportVariantHtml(variant) }}
            className="p-1.5 bg-black/60 hover:bg-black/80 rounded-md text-white/70 hover:text-white transition-colors"
          >
            <Download size={12} />
          </button>
        </Tip>
        <Tip label="Delete">
          <button
            onClick={(e) => { e.stopPropagation(); removeVariant(variant.id) }}
            className="p-1.5 bg-black/60 hover:bg-red-500/80 rounded-md text-white/70 hover:text-white transition-colors"
          >
            <X size={12} />
          </button>
        </Tip>
      </div>
    </div>
  )
}
