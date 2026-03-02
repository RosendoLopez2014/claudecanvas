import type { BrowserWindow } from 'electron'
import type { CriticEvent } from '../../shared/critic/types'

export function emitCriticEvent(
  getWindow: () => BrowserWindow | null,
  event: CriticEvent,
): void {
  console.log(`[critic][${event.tabId}][${event.runId.slice(0, 8)}] ${event.phase}: ${event.message}`)
  const win = getWindow()
  if (win && !win.isDestroyed()) win.webContents.send('critic:event', event)
}
