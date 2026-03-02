/**
 * Self-Healing Loop — Orchestrator (v2: Agent-Assisted Repair).
 *
 * Called by runner.ts when a post-start crash is detected.
 * Two modes, selected by feature flag:
 *
 *   Legacy mode (AGENT_REPAIR off):
 *     crash → lock → backoff → restart → health check → recovered/exhausted
 *
 *   Agent mode (AGENT_REPAIR on):
 *     crash → session → await Claude → quiet period → restart → health check
 *     Claude discovers repair task via MCP, fixes code, reports progress.
 *     The loop waits (Promise) for agent signals before restarting.
 *
 * Safety:
 *   - Repair lock prevents concurrent loops per project
 *   - Bounded attempts (default 3)
 *   - Safety gates: max 8 files / 300 LOC changed
 *   - Cooldown period (10 min) after exhaustion
 *   - File-based lock survives app restart
 */
import type { BrowserWindow } from 'electron'
import type { DevServerPlan } from '../../shared/devserver/types'
import type { RepairPhase } from '../../shared/devserver/repair-types'
import {
  REPAIR_MAX_ATTEMPTS,
  REPAIR_BASE_DELAY_MS,
  AGENT_ENGAGE_TIMEOUT_MS,
  AGENT_WRITE_TIMEOUT_MS,
  REPAIR_QUIET_PERIOD_MS,
  REPAIR_MAX_FILES,
  REPAIR_MAX_LOC,
  REPAIR_COOLDOWN_MS,
} from '../../shared/constants'
import { acquireLock, releaseLock, getActiveLock } from './repair-lock'
import { checkHealth } from './health-check'
import { emitRepairEvent } from './repair-events'
import { resolveDevServerPlan } from './resolve'
import { getDevConfig } from './config-store'
import { repairSessions, waitForPhase, isInCooldown, enterCooldown } from './repair-session'
import { cleanupStaleDevServer } from './stale-cleanup'
import * as runner from './runner'

// ── Feature Flag ─────────────────────────────────────────

function isAgentRepairEnabled(): boolean {
  const env = process.env.AGENT_REPAIR
  if (env === '1' || env === 'true') return true
  if (env === '0' || env === 'false') return false
  // Default: off (safe for normal users)
  return false
}

// ── Types ────────────────────────────────────────────────

export interface SelfHealOptions {
  cwd: string
  exitCode: number
  crashOutput: string
  maxAttempts?: number
  getWindow: () => BrowserWindow | null
}

// ── Entry Point ──────────────────────────────────────────

/** Run the self-healing loop. Returns true if recovery succeeded. */
export async function runSelfHealingLoop(opts: SelfHealOptions): Promise<boolean> {
  if (isAgentRepairEnabled()) {
    return runAgentRepairLoop(opts)
  }
  return runLegacySelfHealingLoop(opts)
}

// ── Shared Helpers ───────────────────────────────────────

function resolvePlan(cwd: string): DevServerPlan {
  const config = getDevConfig(cwd)
  if (config?.lastKnownGood) {
    return {
      cwd,
      manager: config.lastKnownGood.command.bin as DevServerPlan['manager'],
      command: config.lastKnownGood.command,
      confidence: 'high',
      reasons: ['Using last known good configuration'],
      detection: { usedLastKnownGood: true },
      spawnCwd: config.lastKnownGood.spawnCwd,
      port: config.lastKnownGood.port,
    }
  }
  const plan = resolveDevServerPlan(cwd)
  if (plan.cwd !== cwd) {
    return { ...plan, spawnCwd: plan.cwd, cwd }
  }
  return plan
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ══════════════════════════════════════════════════════════
// LEGACY MODE (process-level restart only)
// ══════════════════════════════════════════════════════════

async function runLegacySelfHealingLoop(opts: SelfHealOptions): Promise<boolean> {
  const { cwd, exitCode, crashOutput, getWindow } = opts
  const maxAttempts = opts.maxAttempts ?? REPAIR_MAX_ATTEMPTS

  const emit = (phase: RepairPhase, message: string, detail?: Record<string, unknown>) => {
    const lock = getActiveLock(cwd)
    emitRepairEvent(getWindow, {
      sessionId: lock?.sessionId ?? 'unknown',
      cwd,
      phase,
      attempt: lock?.attempt ?? 0,
      maxAttempts,
      message,
      timestamp: Date.now(),
      detail,
    })
  }

  const lock = acquireLock(cwd)
  if (!lock) {
    emit('aborted', 'Self-healing already in progress for this project')
    return false
  }

  try {
    emit('crash-detected', `Dev server crashed (exit code ${exitCode})`, {
      exitCode,
      outputLines: crashOutput.split('\n').length,
    })
    emit('lock-acquired', `Repair session ${lock.sessionId.slice(0, 8)} started`)

    const plan = resolvePlan(cwd)

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const delayMs = REPAIR_BASE_DELAY_MS * Math.pow(2, attempt)
      emit('waiting', `Waiting ${(delayMs / 1000).toFixed(0)}s before restart attempt ${attempt + 1}/${maxAttempts}...`, { delayMs })
      await sleep(delayMs)

      // Clean up stale locks/processes scoped to this project before restart
      const cleanup = cleanupStaleDevServer(cwd, plan.port)
      if (cleanup.locksRemoved.length || cleanup.processesKilled.length) {
        emit('restarting', `Cleaned up stale artifacts: ${cleanup.locksRemoved.length} lock(s), ${cleanup.processesKilled.length} process(es)`, {
          locksRemoved: cleanup.locksRemoved,
          processesKilled: cleanup.processesKilled,
        })
      }

      runner.clearCrashHistory(cwd)
      emit('restarting', `Restart attempt ${attempt + 1}/${maxAttempts}...`)

      const result = await runner.start(plan, getWindow)

      if (result.url) {
        emit('health-check', `Verifying server health at ${result.url}...`, { url: result.url })
        const health = await checkHealth(result.url)
        if (health.healthy) {
          emit('recovered', `Dev server recovered! (${health.latencyMs}ms, HTTP ${health.statusCode})`, {
            url: result.url,
            statusCode: health.statusCode,
            latencyMs: health.latencyMs,
          })
          return true
        }
        emit('failed', `Health check failed: ${health.error || `HTTP ${health.statusCode}`}`, {
          url: result.url,
          statusCode: health.statusCode,
          error: health.error,
        })
        continue
      }

      emit('failed', `Restart failed: ${result.error || 'unknown error'}`, {
        error: result.error,
        attempt: attempt + 1,
      })
    }

    emit('exhausted', `All ${maxAttempts} repair attempts failed. Manual intervention required.`, {
      crashLogPath: '.dev-crash.log',
    })
    return false
  } finally {
    releaseLock(cwd)
  }
}

// ══════════════════════════════════════════════════════════
// AGENT MODE (code-level repair via MCP)
// ══════════════════════════════════════════════════════════

async function runAgentRepairLoop(opts: SelfHealOptions): Promise<boolean> {
  const { cwd, exitCode, crashOutput, getWindow } = opts
  const maxAttempts = opts.maxAttempts ?? REPAIR_MAX_ATTEMPTS

  // ── Cooldown check ──────────────────────────────────
  if (isInCooldown(cwd)) {
    const lock = getActiveLock(cwd)
    emitRepairEvent(getWindow, {
      sessionId: lock?.sessionId ?? 'unknown',
      cwd,
      phase: 'aborted',
      attempt: 0,
      maxAttempts,
      message: 'In cooldown period — skipping auto-repair',
      timestamp: Date.now(),
      level: 'warning',
    })
    return false
  }

  // ── Acquire lock ────────────────────────────────────
  const lock = acquireLock(cwd)
  if (!lock) {
    emitRepairEvent(getWindow, {
      sessionId: 'unknown',
      cwd,
      phase: 'aborted',
      attempt: 0,
      maxAttempts,
      message: 'Self-healing already in progress for this project',
      timestamp: Date.now(),
      level: 'warning',
    })
    return false
  }

  try {
    // ── Create repair session ─────────────────────────
    const session = repairSessions.create({
      cwd,
      exitCode,
      maxAttempts,
      crashOutput,
    })

    // IMPORTANT: Use session.repairId (not lock.sessionId) for all coordination.
    // The MCP tools return session.repairId to Claude, so waitForPhase must
    // match on the same ID.
    const repairId = session.repairId

    // Helper to emit events with agent-repair fields AND update session phase
    const emit = (
      phase: RepairPhase,
      message: string,
      level: 'info' | 'warning' | 'error' | 'success' = 'info',
      detail?: Record<string, unknown>,
    ) => {
      // Update session phase so MCP tools see the current state
      repairSessions.updatePhase(repairId, phase, message, detail)

      emitRepairEvent(getWindow, {
        sessionId: repairId,
        cwd,
        phase,
        attempt: session.attempt,
        maxAttempts,
        message,
        timestamp: Date.now(),
        detail,
        repairId,
        level,
      })
    }

    emit('crash_detected', `Dev server crashed (exit code ${exitCode})`, 'error', {
      exitCode,
      outputLines: crashOutput.split('\n').length,
      crashLogPath: session.crashLogPath,
    })

    emit('repair_started', `Repair session ${repairId.slice(0, 8)} started — waiting for Claude Code`, 'info', {
      repairId,
      crashLogPath: session.crashLogPath,
    })

    const plan = resolvePlan(cwd)

    // ── Attempt loop ──────────────────────────────────
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      repairSessions.incrementAttempt(cwd)

      emit('awaiting_agent', `Waiting for Claude Code to engage (attempt ${attempt + 1}/${maxAttempts})...`, 'info', {
        crashLogPath: session.crashLogPath,
      })

      // ── Wait for agent to write files (or timeout) ──
      // Two-stage wait:
      //   Stage 1: Wait for agent to engage at all (30s)
      //   Stage 2: If engaged, wait for agent to finish writing (120s)

      let agentEngaged = false

      const engageResult = await waitForPhase(
        repairId,
        ['agent_started', 'agent_reading_log', 'agent_applying_fix', 'agent_wrote_files'],
        AGENT_ENGAGE_TIMEOUT_MS,
      )

      if (engageResult === 'agent') {
        agentEngaged = true
        const currentPhase = repairSessions.get(cwd)?.phase

        // If agent already wrote files, skip to restart
        if (currentPhase !== 'agent_wrote_files') {
          // Wait for agent to finish writing
          const writeResult = await waitForPhase(
            repairId,
            'agent_wrote_files',
            AGENT_WRITE_TIMEOUT_MS,
          )

          if (writeResult === 'timeout') {
            emit('ready_to_restart', 'Agent timed out writing files — attempting restart anyway', 'warning')
          }
        }

        // ── Safety gate: check change magnitude ─────
        const current = repairSessions.get(cwd)
        if (current && (current.filesChanged > REPAIR_MAX_FILES || current.linesChanged > REPAIR_MAX_LOC)) {
          emit(
            'failed_requires_human',
            `Agent changes exceed safety threshold (${current.filesChanged} files, ~${current.linesChanged} LOC). Please review manually.`,
            'error',
            {
              filesChanged: current.filesChanged,
              linesChanged: current.linesChanged,
              maxFiles: REPAIR_MAX_FILES,
              maxLoc: REPAIR_MAX_LOC,
            },
          )
          repairSessions.remove(cwd)
          return false
        }

        // ── Quiet period (let watchers/HMR settle) ──
        emit('ready_to_restart', `File writes complete — waiting ${REPAIR_QUIET_PERIOD_MS / 1000}s for watchers to settle...`, 'info')
        await sleep(REPAIR_QUIET_PERIOD_MS)
      } else {
        // Agent never engaged — treat as transient crash, try restart directly
        emit('ready_to_restart', 'No agent activity — attempting restart (transient crash?)', 'info')
      }

      // ── Cleanup stale locks/processes (scoped to this project) ──
      const cleanup = cleanupStaleDevServer(cwd, plan.port)
      if (cleanup.locksRemoved.length || cleanup.processesKilled.length) {
        emit('ready_to_restart', `Cleaned up stale artifacts: ${cleanup.locksRemoved.length} lock(s), ${cleanup.processesKilled.length} process(es)`, 'info', {
          locksRemoved: cleanup.locksRemoved,
          processesKilled: cleanup.processesKilled,
        })
      }

      // ── Restart ─────────────────────────────────────
      runner.clearCrashHistory(cwd)
      emit('restarting', `Restart attempt ${attempt + 1}/${maxAttempts}...`, 'info')

      const result = await runner.start(plan, getWindow)

      if (result.url) {
        repairSessions.setHealthUrl(cwd, result.url)

        // ── Health check ──────────────────────────────
        emit('health-check', `Verifying server health at ${result.url}...`, 'info', { url: result.url })
        const health = await checkHealth(result.url)

        if (health.healthy) {
          const msg = agentEngaged
            ? `Dev server recovered after agent repair! (${health.latencyMs}ms, HTTP ${health.statusCode})`
            : `Dev server recovered! (${health.latencyMs}ms, HTTP ${health.statusCode})`

          emit('recovered', msg, 'success', {
            url: result.url,
            statusCode: health.statusCode,
            latencyMs: health.latencyMs,
            agentEngaged,
          })
          repairSessions.remove(cwd)
          return true
        }

        emit('failed', `Health check failed: ${health.error || `HTTP ${health.statusCode}`}`, 'error', {
          url: result.url,
          statusCode: health.statusCode,
          error: health.error,
        })
        continue
      }

      // Start returned an error
      emit('failed', `Restart failed: ${result.error || 'unknown error'}`, 'error', {
        error: result.error,
        attempt: attempt + 1,
      })
    }

    // ── All attempts exhausted ────────────────────────
    emit('exhausted', `All ${maxAttempts} repair attempts failed.`, 'error', {
      crashLogPath: session.crashLogPath,
    })

    // Enter cooldown
    enterCooldown(cwd, REPAIR_COOLDOWN_MS)
    emit('cooldown', `Entering ${REPAIR_COOLDOWN_MS / 60000}-minute cooldown period...`, 'warning', {
      cooldownMs: REPAIR_COOLDOWN_MS,
      cooldownExpiresAt: Date.now() + REPAIR_COOLDOWN_MS,
    })

    emit('failed_requires_human', 'All repair attempts exhausted. Manual intervention required.', 'error', {
      crashLogPath: session.crashLogPath,
    })

    repairSessions.remove(cwd)
    return false
  } finally {
    releaseLock(cwd)
  }
}
