import { useEffect } from 'react'
import { useCriticStore } from '@/stores/critic'
import type { CriticEvent, PlanDetectedEvent, CriticConfig, GateEvent } from '../../shared/critic/types'

/**
 * Bridges critic IPC events to the Zustand store.
 * Mount once in App.tsx — handles critic:event, critic:planDetected, and critic:gateEvent.
 *
 * Automation logic:
 * - autoReviewPlan: when a plan is detected, auto-send to critic for review
 * - Gate events: tracks gate status changes in the store
 *
 * Note: Terminal injection (autoSendFeedback / pty.write) has been removed.
 * Claude now pulls feedback via MCP tools (critic_review_plan, critic_review_result).
 */
export function useCriticListener(): void {
  useEffect(() => {
    const removeEvent = window.api.critic.onEvent((raw: unknown) => {
      const event = raw as CriticEvent
      useCriticStore.getState().pushEvent(event)
    })

    const removePlan = window.api.critic.onPlanDetected((raw: unknown) => {
      const event = raw as PlanDetectedEvent
      useCriticStore.getState().setPendingPlan(event.tabId, event.planText, event.confidence)

      // Auto-review plan if enabled
      window.api.critic.getConfig(event.projectPath).then((config: CriticConfig) => {
        if (!config || !config.autoReviewPlan) return

        // Dismiss the pending plan UI (it's being auto-reviewed)
        useCriticStore.getState().dismissPendingPlan(event.tabId)

        // Trigger plan review
        window.api.critic.reviewPlan(
          event.tabId,
          event.projectPath,
          event.planText,
          `Project: ${event.projectPath}`,
        ).then((result) => {
          if (result && typeof result === 'object' && 'error' in result) {
            console.error(`[critic] Auto-review failed:`, (result as { error: string }).error)
          } else {
            console.log(`[critic] Auto-reviewed plan (tab ${event.tabId})`)
          }
        }).catch((err) => {
          console.error(`[critic] Auto-review error:`, err)
        })
      }).catch(() => {
        // Config fetch failed — skip auto-review silently
      })
    })

    const removeGate = window.api.critic.onGateEvent((raw: unknown) => {
      const event = raw as GateEvent
      useCriticStore.getState().setGateState(event.projectPath, event.status, event.reason)
    })

    return () => { removeEvent(); removePlan(); removeGate() }
  }, [])
}
