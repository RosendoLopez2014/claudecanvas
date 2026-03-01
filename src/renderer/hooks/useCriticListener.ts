import { useEffect } from 'react'
import { useCriticStore } from '@/stores/critic'
import type { CriticEvent, PlanDetectedEvent } from '../../shared/critic/types'

/**
 * Bridges critic IPC events to the Zustand store.
 * Mount once in App.tsx — handles both critic:event and critic:planDetected.
 */
export function useCriticListener(): void {
  useEffect(() => {
    const removeEvent = window.api.critic.onEvent((raw: unknown) => {
      useCriticStore.getState().pushEvent(raw as CriticEvent)
    })
    const removePlan = window.api.critic.onPlanDetected((raw: unknown) => {
      const event = raw as PlanDetectedEvent
      useCriticStore.getState().setPendingPlan(event.tabId, event.planText, event.confidence)
    })
    return () => { removeEvent(); removePlan() }
  }, [])
}
