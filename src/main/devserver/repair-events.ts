/**
 * Self-Healing Loop — Event emitter.
 *
 * Events stream from main → renderer via `dev:repair-event` IPC channel.
 * The renderer store appends each event to a timeline for live UI display.
 */
import type { BrowserWindow } from 'electron'
import type { RepairEvent } from '../../shared/devserver/repair-types'

// Re-export types for convenience
export type { RepairPhase, RepairEvent } from '../../shared/devserver/repair-types'

export function emitRepairEvent(
  getWindow: () => BrowserWindow | null,
  event: RepairEvent,
): void {
  const tag = `[self-heal] [${event.sessionId.slice(0, 8)}]`
  const levelTag = event.level ? ` [${event.level}]` : ''
  console.log(`${tag}${levelTag} ${event.phase}: ${event.message}`)

  const win = getWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send('dev:repair-event', event)
  }
}
