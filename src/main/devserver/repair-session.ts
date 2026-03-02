/**
 * Repair Session Registry — central coordination for agent-assisted repair.
 *
 * Provides an EventEmitter-based session registry that bridges the
 * self-healing loop (which awaits Promises) and MCP tool handlers
 * (which fire events when Claude reports progress).
 *
 * Flow:
 *   1. Self-healing loop creates session, calls waitForPhase()
 *   2. Claude calls MCP tool → handler calls updatePhase()
 *   3. updatePhase() emits event → Promise resolves → loop unblocks
 */
import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import { writeFileSync, readFileSync, unlinkSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import type { RepairPhase } from '../../shared/devserver/repair-types'

// ── Session Data ─────────────────────────────────────────

export interface RepairSessionData {
  repairId: string
  cwd: string
  exitCode: number
  crashLogPath: string       // relative to project root
  phase: RepairPhase
  attempt: number
  maxAttempts: number
  createdAt: number
  pid: number
  agentEngaged: boolean
  filesChanged: number
  linesChanged: number
  healthUrl: string | null
  stepHistory: Array<{
    phase: RepairPhase
    message: string
    timestamp: number
    details?: Record<string, unknown>
  }>
}

// ── Lock File ────────────────────────────────────────────

const LOCK_FILENAME = '.dev-repair.lock'

function writeLockFile(cwd: string, session: RepairSessionData): void {
  try {
    const data = {
      repairId: session.repairId,
      pid: session.pid,
      attempt: session.attempt,
      status: session.phase,
      createdAt: session.createdAt,
      crashLogPath: session.crashLogPath,
    }
    writeFileSync(join(cwd, LOCK_FILENAME), JSON.stringify(data, null, 2), 'utf-8')
  } catch { /* ignore — lock file is best-effort */ }
}

function removeLockFile(cwd: string): void {
  try { unlinkSync(join(cwd, LOCK_FILENAME)) } catch { /* ignore */ }
}

/** Check for stale lock from a previous process. Returns lock data if valid (same PID). */
export function rehydrateLock(cwd: string): RepairSessionData | null {
  try {
    const raw = readFileSync(join(cwd, LOCK_FILENAME), 'utf-8')
    const data = JSON.parse(raw)
    // Stale lock: different PID means previous process crashed
    if (data.pid !== process.pid) {
      console.log(`[repair-session] Stale lock for ${cwd} (pid ${data.pid} vs ${process.pid}) — removing`)
      removeLockFile(cwd)
      return null
    }
    return data as RepairSessionData
  } catch {
    return null
  }
}

// ── Cooldown Tracking ────────────────────────────────────

const cooldowns = new Map<string, number>() // cwd → cooldownExpiresAt

export function isInCooldown(cwd: string): boolean {
  const expiresAt = cooldowns.get(cwd)
  if (!expiresAt) return false
  if (Date.now() >= expiresAt) {
    cooldowns.delete(cwd)
    return false
  }
  return true
}

export function enterCooldown(cwd: string, durationMs: number): void {
  cooldowns.set(cwd, Date.now() + durationMs)
}

export function clearCooldown(cwd: string): void {
  cooldowns.delete(cwd)
}

// ── Stale Crash Log Cleanup ──────────────────────────────

const ONE_HOUR_MS = 3_600_000

export function cleanupStaleCrashLogs(cwd: string): void {
  try {
    const files = readdirSync(cwd)
    const now = Date.now()
    for (const f of files) {
      if (/^\.dev-crash\.[a-f0-9]{8}\.log$/.test(f)) {
        const full = join(cwd, f)
        try {
          const raw = readFileSync(full, 'utf-8')
          const timeMatch = raw.match(/Time:\s*(.+)/)
          if (timeMatch) {
            const ts = new Date(timeMatch[1]).getTime()
            if (now - ts > ONE_HOUR_MS) unlinkSync(full)
          }
        } catch { /* ignore individual file errors */ }
      }
    }
  } catch { /* ignore directory read errors */ }
}

// ── Session Registry (singleton) ─────────────────────────

class RepairSessionRegistry extends EventEmitter {
  private sessions = new Map<string, RepairSessionData>()

  constructor() {
    super()
    this.setMaxListeners(20)
  }

  /** Create a new repair session for a project. */
  create(opts: {
    cwd: string
    exitCode: number
    maxAttempts: number
    crashOutput: string
  }): RepairSessionData {
    const repairId = randomUUID()
    const crashLogPath = `.dev-crash.${repairId.slice(0, 8)}.log`

    // Write unique crash log
    try {
      const header = [
        '=== Dev Server Crash Report ===',
        `Repair ID: ${repairId}`,
        `Time: ${new Date().toISOString()}`,
        `Exit Code: ${opts.exitCode}`,
        `Project: ${opts.cwd}`,
        '',
        '--- Output (last 30 lines) ---',
        '',
      ].join('\n')
      writeFileSync(join(opts.cwd, crashLogPath), header + opts.crashOutput + '\n', 'utf-8')
    } catch (err) {
      console.error(`[repair-session] Failed to write crash log:`, err)
    }

    // Also write/update the generic .dev-crash.log (backward compat)
    try {
      const header = [
        '=== Dev Server Crash Report ===',
        `Repair ID: ${repairId}`,
        `Time: ${new Date().toISOString()}`,
        `Exit Code: ${opts.exitCode}`,
        `Project: ${opts.cwd}`,
        `Unique log: ${crashLogPath}`,
        '',
        '--- Output (last 30 lines) ---',
        '',
      ].join('\n')
      writeFileSync(join(opts.cwd, '.dev-crash.log'), header + opts.crashOutput + '\n', 'utf-8')
    } catch { /* ignore */ }

    // Cleanup stale crash logs
    cleanupStaleCrashLogs(opts.cwd)

    const session: RepairSessionData = {
      repairId,
      cwd: opts.cwd,
      exitCode: opts.exitCode,
      crashLogPath,
      phase: 'crash_detected',
      attempt: 0,
      maxAttempts: opts.maxAttempts,
      createdAt: Date.now(),
      pid: process.pid,
      agentEngaged: false,
      filesChanged: 0,
      linesChanged: 0,
      healthUrl: null,
      stepHistory: [],
    }

    this.sessions.set(opts.cwd, session)
    writeLockFile(opts.cwd, session)
    return session
  }

  /** Get session by project path. */
  get(cwd: string): RepairSessionData | null {
    return this.sessions.get(cwd) ?? null
  }

  /** Get session by repairId (for MCP tool lookups). */
  getByRepairId(repairId: string): RepairSessionData | null {
    for (const s of this.sessions.values()) {
      if (s.repairId === repairId) return s
    }
    return null
  }

  /** Check if a session exists for a project. */
  has(cwd: string): boolean {
    return this.sessions.has(cwd)
  }

  /** Update session phase and emit event (unblocks waitForPhase). */
  updatePhase(
    repairId: string,
    phase: RepairPhase,
    message: string,
    details?: Record<string, unknown>,
  ): boolean {
    const session = this.getByRepairId(repairId)
    if (!session) return false

    session.phase = phase
    session.stepHistory.push({
      phase,
      message,
      timestamp: Date.now(),
      details,
    })

    // Track agent engagement
    if (phase === 'agent_started') {
      session.agentEngaged = true
    }

    // Track file changes from agent
    if (phase === 'agent_wrote_files' && details) {
      session.filesChanged = (details.filesChanged as number) || 0
      session.linesChanged = (details.linesChanged as number) || 0
    }

    writeLockFile(session.cwd, session)

    // Emit event — this is what unblocks waitForPhase() Promises
    this.emit('phase-change', { repairId, phase, message, cwd: session.cwd })
    return true
  }

  /** Update attempt counter. */
  incrementAttempt(cwd: string): void {
    const session = this.sessions.get(cwd)
    if (session) {
      session.attempt++
      writeLockFile(cwd, session)
    }
  }

  /** Set health URL on session. */
  setHealthUrl(cwd: string, url: string): void {
    const session = this.sessions.get(cwd)
    if (session) session.healthUrl = url
  }

  /** Remove session and lock file. Emits 'session-removed' for cleanup. */
  remove(cwd: string): void {
    const session = this.sessions.get(cwd)
    this.sessions.delete(cwd)
    removeLockFile(cwd)
    if (session) {
      this.emit('session-removed', { repairId: session.repairId })
    }
  }
}

/** Singleton registry — shared between self-healing loop and MCP tools. */
export const repairSessions = new RepairSessionRegistry()

// ── Promise-Based Waiting ────────────────────────────────

/**
 * Wait for a specific phase (or any of several phases) to be reached,
 * or time out. Returns 'agent' if the agent signaled, 'timeout' if timed out.
 */
export function waitForPhase(
  repairId: string,
  targetPhases: RepairPhase | RepairPhase[],
  timeoutMs: number,
): Promise<'agent' | 'timeout'> {
  const targets = new Set(Array.isArray(targetPhases) ? targetPhases : [targetPhases])

  return new Promise((resolve) => {
    let resolved = false

    const cleanup = () => {
      repairSessions.off('phase-change', onPhaseChange)
      repairSessions.off('session-removed', onRemoved)
    }

    const onPhaseChange = (event: { repairId: string; phase: RepairPhase }) => {
      if (event.repairId !== repairId) return
      if (targets.has(event.phase)) {
        if (resolved) return
        resolved = true
        cleanup()
        clearTimeout(timer)
        resolve('agent')
      }
    }

    const onRemoved = (event: { repairId: string }) => {
      if (event.repairId !== repairId) return
      if (resolved) return
      resolved = true
      cleanup()
      clearTimeout(timer)
      resolve('timeout')
    }

    repairSessions.on('phase-change', onPhaseChange)
    repairSessions.on('session-removed', onRemoved)

    const timer = setTimeout(() => {
      if (resolved) return
      resolved = true
      cleanup()
      resolve('timeout')
    }, timeoutMs)
  })
}
