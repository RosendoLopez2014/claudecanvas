import { useGalleryStore, type GalleryVariant, type DesignSession } from '@/stores/gallery'
import { useTerminalStore } from '@/stores/terminal'
import { useTabsStore } from '@/stores/tabs'
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

export function SessionPanel() {
  const { variants, sessions, activeSessionId, selectedId } = useGalleryStore()
  const activeSession = sessions.find((s) => s.id === activeSessionId)

  const displayVariants = activeSession
    ? variants.filter((v) => v.sessionId === activeSession.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    : variants.filter((v) => v.sessionId)

  const handleSelectInSession = (variantId: string) => {
    const variant = displayVariants.find((v) => v.id === variantId)
    if (variant) selectAndNotify(variant)
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
            onSelect={() => handleSelectInSession(variant.id)}
          />
        ))}
      </div>
    </div>
  )
}
