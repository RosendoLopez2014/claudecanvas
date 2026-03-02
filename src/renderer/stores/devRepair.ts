/**
 * Dev Repair Store — tracks self-healing loop sessions.
 *
 * Fed by useDevRepairListener hook via `dev:repair-event` IPC.
 * Consumed by useMcpStateExposer (exposes to __canvasState.repairStatus)
 * and potentially a future repair timeline UI.
 */
import { create } from 'zustand'
import type { RepairEvent, RepairPhase } from '../../shared/devserver/repair-types'
import { TERMINAL_REPAIR_PHASES } from '../../shared/devserver/repair-types'

interface RepairSession {
  sessionId: string
  repairId: string | null
  cwd: string
  events: RepairEvent[]
  status: 'active' | 'recovered' | 'exhausted' | 'aborted' | 'failed_requires_human'
  agentEngaged: boolean
  startedAt: number
}

interface DevRepairState {
  /** Active repair sessions keyed by project path */
  activeRepairs: Record<string, RepairSession>
  /** Recently completed sessions (last 5) */
  recentRepairs: RepairSession[]
  /** Push a new repair event into the store */
  pushEvent: (event: RepairEvent) => void
}

/** Phases indicating the agent has engaged */
const AGENT_PHASES: Set<RepairPhase> = new Set([
  'agent_started', 'agent_reading_log', 'agent_applying_fix', 'agent_wrote_files',
])

export const useDevRepairStore = create<DevRepairState>((set) => ({
  activeRepairs: {},
  recentRepairs: [],

  pushEvent: (event) =>
    set((state) => {
      const key = event.cwd
      const existing = state.activeRepairs[key]

      // Start a new session or append to existing
      const session: RepairSession = existing
        ? {
            ...existing,
            events: [...existing.events, event],
            repairId: event.repairId ?? existing.repairId,
            agentEngaged: existing.agentEngaged || AGENT_PHASES.has(event.phase),
          }
        : {
            sessionId: event.sessionId,
            repairId: event.repairId ?? null,
            cwd: event.cwd,
            events: [event],
            status: 'active',
            agentEngaged: AGENT_PHASES.has(event.phase),
            startedAt: event.timestamp,
          }

      // Check if this is a terminal phase
      if (TERMINAL_REPAIR_PHASES.has(event.phase)) {
        const terminalStatus = event.phase === 'recovered'
          ? 'recovered' as const
          : event.phase === 'aborted'
            ? 'aborted' as const
            : event.phase === 'failed_requires_human'
              ? 'failed_requires_human' as const
              : 'exhausted' as const
        session.status = terminalStatus
        const { [key]: _, ...remaining } = state.activeRepairs
        return {
          activeRepairs: remaining,
          recentRepairs: [session, ...state.recentRepairs].slice(0, 5),
        }
      }

      return {
        activeRepairs: { ...state.activeRepairs, [key]: session },
      }
    }),
}))
