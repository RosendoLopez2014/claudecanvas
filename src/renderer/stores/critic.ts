/**
 * Critic Store — tracks critic loop sessions per tab.
 *
 * Fed by useCriticListener hook via `critic:event` and `critic:planDetected` IPC.
 * Consumed by CriticPanel, StatusBar chip, and useMcpStateExposer.
 */
import { create } from 'zustand'
import type { CriticPhase, CriticEvent, CriticFeedback, GateStatus } from '../../shared/critic/types'
import { TERMINAL_CRITIC_PHASES } from '../../shared/critic/types'

export interface CriticSession {
  runId: string
  tabId: string
  projectPath: string
  phase: CriticPhase
  events: CriticEvent[]
  planFeedback: CriticFeedback | null
  resultFeedback: CriticFeedback | null
  iteration: number
  maxIterations: number
  startedAt: number
  error: string | null
}

interface PendingPlan {
  tabId: string
  planText: string
  confidence: number
  detectedAt: number
}

interface CriticState {
  /** Active sessions keyed by tabId */
  activeSessions: Record<string, CriticSession>
  /** Recently completed sessions (last 5) */
  recentSessions: CriticSession[]
  /** Pending plans awaiting user action, keyed by tabId */
  pendingPlans: Record<string, PendingPlan>
  /** Gate states keyed by projectPath */
  gateStates: Record<string, { status: GateStatus; reason: string }>

  pushEvent: (event: CriticEvent) => void
  setPendingPlan: (tabId: string, planText: string, confidence: number) => void
  dismissPendingPlan: (tabId: string) => void
  clearSession: (tabId: string) => void
  setGateState: (projectPath: string, status: GateStatus, reason: string) => void
}

export const useCriticStore = create<CriticState>((set) => ({
  activeSessions: {},
  recentSessions: [],
  pendingPlans: {},
  gateStates: {},

  pushEvent: (event) =>
    set((state) => {
      const key = event.tabId
      const existing = state.activeSessions[key]

      const session: CriticSession = existing
        ? {
            ...existing,
            phase: event.phase,
            events: [...existing.events, event],
            planFeedback: event.feedback && event.phase === 'plan_feedback_ready'
              ? event.feedback
              : existing.planFeedback,
            resultFeedback: event.feedback && event.phase === 'result_feedback_ready'
              ? event.feedback
              : existing.resultFeedback,
            iteration: event.iteration ?? existing.iteration,
            maxIterations: event.maxIterations ?? existing.maxIterations,
            error: event.error ?? existing.error,
          }
        : {
            runId: event.runId,
            tabId: event.tabId,
            projectPath: event.projectPath,
            phase: event.phase,
            events: [event],
            planFeedback: event.feedback && event.phase === 'plan_feedback_ready'
              ? event.feedback : null,
            resultFeedback: event.feedback && event.phase === 'result_feedback_ready'
              ? event.feedback : null,
            iteration: event.iteration ?? 0,
            maxIterations: event.maxIterations ?? 3,
            startedAt: event.timestamp,
            error: event.error ?? null,
          }

      // Check if this is a terminal phase
      if (TERMINAL_CRITIC_PHASES.has(event.phase)) {
        const { [key]: _, ...remaining } = state.activeSessions
        return {
          activeSessions: remaining,
          recentSessions: [session, ...state.recentSessions].slice(0, 5),
        }
      }

      return {
        activeSessions: { ...state.activeSessions, [key]: session },
      }
    }),

  setPendingPlan: (tabId, planText, confidence) =>
    set((state) => ({
      pendingPlans: {
        ...state.pendingPlans,
        [tabId]: { tabId, planText, confidence, detectedAt: Date.now() },
      },
    })),

  dismissPendingPlan: (tabId) =>
    set((state) => {
      const { [tabId]: _, ...remaining } = state.pendingPlans
      return { pendingPlans: remaining }
    }),

  clearSession: (tabId) =>
    set((state) => {
      const { [tabId]: _, ...remaining } = state.activeSessions
      return { activeSessions: remaining }
    }),

  setGateState: (projectPath, status, reason) =>
    set((state) => ({
      gateStates: { ...state.gateStates, [projectPath]: { status, reason } },
    })),
}))
