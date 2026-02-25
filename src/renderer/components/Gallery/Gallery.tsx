import { useGalleryStore } from '@/stores/gallery'
import { RefreshCw, Trash2, ChevronDown } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { Tip } from './constants'
import { GridView } from './GridView'
import { CompareView } from './CompareView'
import { SessionPanel } from './SessionPanel'

// ─── Main Gallery Component ─────────────────────────────────────────────────

export function Gallery() {
  const { variants, viewMode } = useGalleryStore()

  if (variants.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-white/30 text-sm">
        <div className="text-center space-y-3 max-w-[300px]">
          <div className="w-10 h-10 mx-auto rounded-lg bg-white/5 flex items-center justify-center">
            <span className="text-lg">🎨</span>
          </div>
          <p className="font-medium text-white/40">Design Gallery</p>
          <p className="text-xs text-white/20 leading-relaxed">
            Ask Claude to design something and it will add proposals here for you to compare. Try:
          </p>
          <p className="text-[11px] text-[var(--accent-cyan)]/60 font-mono bg-white/5 rounded px-3 py-2">
            &quot;Design 3 variations of a pricing card and add them to the gallery&quot;
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
        {viewMode === 'session' && <SessionPanel />}
      </div>
    </div>
  )
}

// ─── Toolbar ─────────────────────────────────────────────────────────────────

function GalleryToolbar() {
  const { viewMode, setViewMode, sessions, activeSessionId, setActiveSession, clearAll } = useGalleryStore()
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

      {/* Actions */}
      <div className="flex items-center gap-1">
        <Tip label="Reload gallery">
          <button
            onClick={() => {
              const pp = useGalleryStore.getState().projectPath
              if (pp) useGalleryStore.getState().loadForProject(pp)
            }}
            className="p-1.5 text-white/30 hover:text-white/60 hover:bg-white/5 rounded transition-colors"
          >
            <RefreshCw size={12} />
          </button>
        </Tip>
        <Tip label="Clear all">
          <button
            onClick={clearAll}
            className="p-1.5 text-white/30 hover:text-red-400 hover:bg-white/5 rounded transition-colors"
          >
            <Trash2 size={12} />
          </button>
        </Tip>
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
