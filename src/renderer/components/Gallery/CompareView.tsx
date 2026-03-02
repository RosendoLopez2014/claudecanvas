import { useGalleryStore, type GalleryVariant } from '@/stores/gallery'
import { useTerminalStore } from '@/stores/terminal'
import { useTabsStore } from '@/stores/tabs'
import { ArrowLeftRight } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { GalleryCard } from './GalleryCard'

/** Select a gallery variant and paste the choice into Claude's terminal.
 *  Ctrl+U clears the current input line first, so clicking a different card
 *  replaces the previous selection text seamlessly. */
function selectAndNotify(variant: GalleryVariant): void {
  const { selectedId, selectVariant } = useGalleryStore.getState()
  if (selectedId === variant.id) return // Already selected

  selectVariant(variant.id)
  window.api.mcp.gallerySelect?.(variant.id)

  const tab = useTabsStore.getState().getActiveTab()
  if (!tab?.ptyId) return

  // Ctrl+U clears the current input line — removes previous selection text
  window.api.pty.write(tab.ptyId, '\x15')
  window.api.pty.write(tab.ptyId, `I choose "${variant.label}" `)
  requestAnimationFrame(() => useTerminalStore.getState().focus())
}

export function CompareView() {
  const { compareIds, variants, setCompareIds } = useGalleryStore()
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
            onClick={() => selectAndNotify(leftVariant)}
            className="text-[10px] px-3 py-1 rounded bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)] hover:bg-[var(--accent-cyan)]/20"
          >
            Pick left
          </button>
          <button
            onClick={() => selectAndNotify(rightVariant)}
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
            onSelect={() => {}}
          />
        </div>
        <div ref={rightRef} className="flex-1 overflow-auto p-3" onScroll={() => handleScroll('right')}>
          <GalleryCard
            variant={rightVariant}
            isSelected={rightVariant.status === 'selected'}
            onSelect={() => {}}
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
