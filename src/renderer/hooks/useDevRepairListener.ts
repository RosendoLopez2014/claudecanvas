/**
 * Dev Repair Listener — bridges IPC repair events to store + toasts.
 *
 * Mounted once in App.tsx. Listens for `dev:repair-event` from main process
 * and feeds each event into the devRepair store + shows phase-appropriate toasts.
 */
import { useEffect } from 'react'
import { useDevRepairStore } from '@/stores/devRepair'
import { useToastStore } from '@/stores/toast'
import type { RepairPhase } from '../../shared/devserver/repair-types'

/** Map repair phases to toast types */
const TOAST_MAP: Record<string, 'info' | 'success' | 'error'> = {
  // Legacy phases
  'crash-detected': 'error',
  'lock-acquired': 'info',
  'waiting': 'info',
  'restarting': 'info',
  'health-check': 'info',
  'recovered': 'success',
  'failed': 'error',
  'exhausted': 'error',
  'aborted': 'info',
  // Agent repair phases
  'crash_detected': 'error',
  'repair_started': 'info',
  'awaiting_agent': 'info',
  'agent_started': 'info',
  'agent_reading_log': 'info',
  'agent_applying_fix': 'info',
  'agent_wrote_files': 'info',
  'ready_to_restart': 'info',
  'verifying_fix': 'info',
  'cooldown': 'error',
  'failed_requires_human': 'error',
}

/** Phases that warrant a toast notification (skip noisy internal ones) */
const TOAST_PHASES: Set<string> = new Set([
  // Legacy
  'crash-detected', 'waiting', 'restarting', 'health-check', 'recovered', 'failed', 'exhausted',
  // Agent repair (user-facing)
  'crash_detected', 'repair_started', 'agent_started', 'agent_wrote_files',
  'ready_to_restart', 'restarting', 'recovered', 'failed', 'exhausted',
  'cooldown', 'failed_requires_human',
])

export function useDevRepairListener(): void {
  useEffect(() => {
    const remove = window.api.dev.onRepairEvent((event) => {
      // Feed into Zustand store
      useDevRepairStore.getState().pushEvent(event)

      // Show toast for user-facing phases
      if (TOAST_PHASES.has(event.phase)) {
        const { addToast } = useToastStore.getState()
        const toastType = TOAST_MAP[event.phase] ?? 'info'
        addToast(event.message, toastType)
      }
    })
    return remove
  }, [])
}
