/**
 * Persistent per-project dev server config store.
 *
 * Stores LastKnownGood plans, failure history, and user overrides
 * keyed by absolute project path. Uses electron-store for persistence.
 */
import { settingsStore } from '../store'
import type { PersistedDevConfig, SafeCommand } from '../../shared/devserver/types'

// ── Key helpers ───────────────────────────────────────────────────

/** Stable key for a project path in electron-store. */
function configKey(projectPath: string): string {
  return `devServerConfig.${projectPath.replace(/[^a-zA-Z0-9_\-/]/g, '_')}`
}

// ── Read/Write ────────────────────────────────────────────────────

export function getDevConfig(projectPath: string): PersistedDevConfig | null {
  try {
    const raw = settingsStore.get(configKey(projectPath)) as PersistedDevConfig | undefined
    return raw ?? null
  } catch {
    return null
  }
}

export function setDevConfig(projectPath: string, config: PersistedDevConfig): void {
  settingsStore.set(configKey(projectPath), config)
}

export function mergeDevConfig(projectPath: string, partial: Partial<PersistedDevConfig>): void {
  const existing = getDevConfig(projectPath) || {}
  setDevConfig(projectPath, { ...existing, ...partial })
}

// ── High-level operations ─────────────────────────────────────────

/** Record a successful startup — updates LastKnownGood. */
export function recordSuccess(
  projectPath: string,
  command: SafeCommand,
  port?: number,
  framework?: string,
  scriptName?: string,
  spawnCwd?: string,
): void {
  mergeDevConfig(projectPath, {
    lastKnownGood: {
      command,
      port,
      framework,
      scriptName,
      spawnCwd,
      updatedAt: Date.now(),
    },
    // Clear any previous failure
    lastFailure: undefined,
  })
  console.log(`[devserver] CONFIG [${projectPath.split('/').pop()}] Saved LastKnownGood: ${command.bin} ${command.args.join(' ')}`)
}

/** Record a failure. */
export function recordFailure(projectPath: string, error: string): void {
  mergeDevConfig(projectPath, {
    lastFailure: {
      error,
      timestamp: Date.now(),
    },
  })
}

/** Set a user override. */
export function setUserOverride(
  projectPath: string,
  command: SafeCommand,
  port?: number,
): void {
  mergeDevConfig(projectPath, {
    userOverride: {
      command,
      port,
      setAt: Date.now(),
    },
  })
  console.log(`[devserver] CONFIG [${projectPath.split('/').pop()}] User override set: ${command.bin} ${command.args.join(' ')}`)
}

/** Clear user override (fall back to auto-detection). */
export function clearUserOverride(projectPath: string): void {
  const config = getDevConfig(projectPath)
  if (config) {
    const { userOverride: _, ...rest } = config
    setDevConfig(projectPath, rest)
  }
}

/** Clear all persisted config for a project. */
export function clearDevConfig(projectPath: string): void {
  try {
    settingsStore.delete(configKey(projectPath) as never)
  } catch { /* ignore */ }
}
