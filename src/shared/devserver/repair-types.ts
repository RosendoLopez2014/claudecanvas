/**
 * Self-Healing Loop — Shared type definitions.
 *
 * Used by both main process (repair-events.ts, self-healing-loop.ts)
 * and renderer (devRepair store, useDevRepairListener hook).
 */

// ── Legacy phases (process-level restart only) ───────────
export type LegacyRepairPhase =
  | 'crash-detected'
  | 'lock-acquired'
  | 'waiting'          // exponential backoff delay
  | 'restarting'       // calling runner.start()
  | 'health-check'     // probing the URL
  | 'recovered'        // healthy and serving
  | 'failed'           // one attempt failed (will retry)
  | 'exhausted'        // all attempts used up — needs human
  | 'aborted'          // lock was held / skipped

// ── Agent repair phases (code-level repair) ──────────────
export type AgentRepairPhase =
  | 'crash_detected'
  | 'repair_started'
  | 'awaiting_agent'       // waiting for Claude to engage
  | 'agent_started'        // Claude picked up the task
  | 'agent_reading_log'    // Claude is reading crash log
  | 'agent_applying_fix'   // Claude is editing files
  | 'agent_wrote_files'    // Claude finished writing files
  | 'ready_to_restart'     // quiet period before restart
  | 'verifying_fix'        // additional verification
  | 'cooldown'             // cooldown after exhaustion
  | 'failed_requires_human'// terminal — needs human intervention

// ── Union type ───────────────────────────────────────────
export type RepairPhase = LegacyRepairPhase | AgentRepairPhase

// ── Terminal phases (end a repair session) ───────────────
export const TERMINAL_REPAIR_PHASES: ReadonlySet<RepairPhase> = new Set([
  'recovered', 'exhausted', 'aborted', 'failed_requires_human',
])

// ── Event payload ────────────────────────────────────────
export interface RepairEvent {
  sessionId: string
  cwd: string
  phase: RepairPhase
  attempt: number
  maxAttempts: number
  message: string
  timestamp: number
  detail?: Record<string, unknown>
  /** Present only in agent-repair events */
  repairId?: string
  level?: 'info' | 'warning' | 'error' | 'success'
}

// ── Repair task payload (returned by MCP tool) ───────────
export interface RepairTaskPayload {
  pending: boolean
  repairId?: string
  crashLogPath?: string
  exitCode?: number
  attempt?: number
  maxAttempts?: number
  phase?: RepairPhase
  healthUrl?: string | null
  lastEvents?: Array<{ phase: RepairPhase; message: string; ts: number }>
  instructions?: string[]
  safetyLimits?: {
    maxFiles: number
    maxLinesChanged: number
    noTerminalInjection: boolean
    safeMode: boolean
  }
}
