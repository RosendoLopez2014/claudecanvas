import type { PreviewMode } from '@/stores/gallery'
import { useTerminalStore } from '@/stores/terminal'
import { useTabsStore } from '@/stores/tabs'
import type { ReactNode } from 'react'

/** Viewport presets for the mode selector */
export const VIEWPORT_PRESETS = [
  { label: 'Auto', mode: 'viewport' as PreviewMode, width: 900 },
  { label: 'Intrinsic', mode: 'intrinsic' as PreviewMode, width: 0 },
  { label: '1200', mode: 'viewport' as PreviewMode, width: 1200 },
  { label: '900', mode: 'viewport' as PreviewMode, width: 900 },
  { label: '768', mode: 'viewport' as PreviewMode, width: 768 },
  { label: '375', mode: 'viewport' as PreviewMode, width: 375 },
  { label: 'Fill', mode: 'fill' as PreviewMode, width: 0 },
] as const

/** Bleed padding in px — must match harness BLEED constant */
export const BLEED = 32

/** Default card height before dimensions arrive from iframe */
export const DEFAULT_CARD_HEIGHT = 300

/** Minimum screen-px movement before a pointer-down counts as a drag */
export const DRAG_THRESHOLD = 5

/** Tiny hover tooltip — shows label immediately below the trigger element */
export function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="relative group/tip">
      {children}
      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 bg-black/90 border border-white/10 text-[10px] text-white/90 rounded whitespace-nowrap opacity-0 group-hover/tip:opacity-100 transition-opacity pointer-events-none z-20 shadow-lg">
        {label}
      </div>
    </div>
  )
}

/** Write text into the active terminal and focus it so the user can keep typing */
export function typeIntoTerminal(text: string): void {
  const tab = useTabsStore.getState().getActiveTab()
  if (!tab?.ptyId) return
  window.api.pty.write(tab.ptyId, text)
  requestAnimationFrame(() => useTerminalStore.getState().focus())
}
