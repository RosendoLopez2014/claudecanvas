import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import type { GateState, GateStatus, GateEvent } from '../../shared/critic/types'
import { GATED_MODE_ALLOWED_NATIVE } from '../../shared/constants'

// Per-project gate state (in-memory — not persisted across restarts.
// Startup restore handles crash-while-gated via backup file detection.)
const gateStates = new Map<string, GateState>()

// Lease tracking: which tabs hold the gate for each project (Policy A)
const projectTabLeases = new Map<string, Set<string>>()

export function getGateState(projectPath: string): GateState | null {
  return gateStates.get(projectPath) ?? null
}

export function isGated(projectPath: string): boolean {
  return gateStates.get(projectPath)?.status === 'gated'
}

export async function engageGate(
  getWindow: () => BrowserWindow | null,
  projectPath: string,
  tabId: string,
  reason: string,
): Promise<void> {
  // If already gated, just add the lease
  if (isGated(projectPath)) {
    addLease(projectPath, tabId)
    return
  }

  gateStates.set(projectPath, {
    projectPath, status: 'gated', reason, gatedAt: Date.now(),
  })
  addLease(projectPath, tabId)

  // Backup original settings + restrict native tools
  await backupAndRestrict(projectPath)

  emitGateEvent(getWindow, { projectPath, status: 'gated', reason, timestamp: Date.now() })
}

export async function releaseGate(
  getWindow: () => BrowserWindow | null,
  projectPath: string,
  reason: string,
  overriddenBy?: string,
): Promise<void> {
  const status: GateStatus = overriddenBy === 'user' ? 'overridden' : 'open'

  gateStates.set(projectPath, {
    projectPath, status, reason,
    gatedAt: gateStates.get(projectPath)?.gatedAt ?? Date.now(),
    overriddenBy,
  })

  // Clear ALL leases for this project
  projectTabLeases.delete(projectPath)

  // Restore exact original settings
  await restoreFromBackup(projectPath)

  emitGateEvent(getWindow, { projectPath, status, reason, timestamp: Date.now() })

  // Clean up in-memory state after event propagates
  if (status === 'open') {
    setTimeout(() => gateStates.delete(projectPath), 1000)
  }
}

export async function cleanupTabGate(
  getWindow: () => BrowserWindow | null,
  projectPath: string,
  tabId: string,
): Promise<void> {
  const leases = projectTabLeases.get(projectPath)
  if (!leases) return

  leases.delete(tabId)

  // Only release gate when ALL leases are gone
  if (leases.size === 0) {
    projectTabLeases.delete(projectPath)
    if (gateStates.has(projectPath)) {
      await restoreFromBackup(projectPath)
      gateStates.delete(projectPath)
      emitGateEvent(getWindow, {
        projectPath, status: 'open',
        reason: 'All critic tabs closed', timestamp: Date.now(),
      })
    }
  }
}

/**
 * Call on startup/project-open to restore settings if app crashed while gated.
 * If a backup file exists but no in-memory gate state, restore immediately.
 */
export async function restoreStaleBackups(projectPath: string): Promise<void> {
  const backupPath = getBackupPath(projectPath)
  if (existsSync(backupPath) && !gateStates.has(projectPath)) {
    console.log(`[critic-gate] Restoring stale backup for ${projectPath}`)
    await restoreFromBackup(projectPath)
  }
}

// ── Internal helpers ──────────────────────────────────────

function addLease(projectPath: string, tabId: string): void {
  if (!projectTabLeases.has(projectPath)) projectTabLeases.set(projectPath, new Set())
  projectTabLeases.get(projectPath)!.add(tabId)
}

function getBackupPath(projectPath: string): string {
  return join(projectPath, '.claude-wrapper', 'critic', 'settings-backup.json')
}

/**
 * Save original settings.local.json, then restrict to read-only native + MCP tools.
 * Only creates backup if no backup already exists (preserves original during strict re-gate).
 */
async function backupAndRestrict(projectPath: string): Promise<void> {
  const settingsPath = join(projectPath, '.claude', 'settings.local.json')
  const backupPath = getBackupPath(projectPath)

  // Create backup directory
  const backupDir = dirname(backupPath)
  if (!existsSync(backupDir)) await mkdir(backupDir, { recursive: true })

  // Only backup if no backup exists (don't overwrite during re-gate in strict mode)
  if (!existsSync(backupPath)) {
    if (existsSync(settingsPath)) {
      const original = await readFile(settingsPath, 'utf-8')
      await atomicWrite(backupPath, original)
    } else {
      // No settings file existed — write empty marker so restore knows to delete
      await atomicWrite(backupPath, '__EMPTY__')
    }
  }

  // Restrict: keep only read-only native + all MCP tools (mcp__*)
  let settings: Record<string, unknown> = {}
  if (existsSync(settingsPath)) {
    try { settings = JSON.parse(await readFile(settingsPath, 'utf-8')) }
    catch { /* corrupted — start fresh */ }
  }

  const currentAllow = (
    (settings.permissions as Record<string, unknown>)?.allow as string[] || []
  )

  // Keep: read-only native tools + all MCP tools (they're gated at the handler level)
  const readOnlySet = new Set(GATED_MODE_ALLOWED_NATIVE)
  const newAllow = currentAllow.filter((t) =>
    readOnlySet.has(t) || t.startsWith('mcp__')
  )

  settings.permissions = {
    ...((settings.permissions as Record<string, unknown>) || {}),
    allow: newAllow,
  }

  await atomicWrite(settingsPath, JSON.stringify(settings, null, 2) + '\n')
}

/**
 * Restore settings.local.json from backup (exact content), then delete backup.
 */
async function restoreFromBackup(projectPath: string): Promise<void> {
  const settingsPath = join(projectPath, '.claude', 'settings.local.json')
  const backupPath = getBackupPath(projectPath)

  if (!existsSync(backupPath)) return

  const backup = await readFile(backupPath, 'utf-8')

  if (backup === '__EMPTY__') {
    // Original had no settings file — delete the one we created
    if (existsSync(settingsPath)) await unlink(settingsPath)
  } else {
    // Restore exact original content
    await atomicWrite(settingsPath, backup)
  }

  // Remove backup file
  await unlink(backupPath).catch(() => {})
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const dir = dirname(filePath)
  if (!existsSync(dir)) await mkdir(dir, { recursive: true })
  const tmp = filePath + '.tmp.' + randomUUID().slice(0, 6)
  await writeFile(tmp, content, 'utf-8')
  await rename(tmp, filePath)
}

function emitGateEvent(
  getWindow: () => BrowserWindow | null,
  event: GateEvent,
): void {
  console.log(`[critic-gate] ${event.projectPath}: ${event.status} — ${event.reason}`)
  const win = getWindow()
  if (win && !win.isDestroyed()) win.webContents.send('critic:gateEvent', event)
}
