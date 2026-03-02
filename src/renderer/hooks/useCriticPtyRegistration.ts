import { useEffect } from 'react'
import { useActiveTab } from '@/stores/tabs'
import { useProjectStore } from '@/stores/project'

/**
 * Register the active tab's PTY for critic plan detection.
 * Effect re-runs when ptyId, tabId, or projectPath changes,
 * unregistering the old and registering the new.
 */
export function useCriticPtyRegistration(): void {
  const tab = useActiveTab()
  const ptyId = tab?.ptyId ?? null
  const tabId = tab?.id ?? null
  const { currentProject } = useProjectStore()
  const projectPath = currentProject?.path ?? null

  useEffect(() => {
    if (!ptyId || !tabId || !projectPath) return
    window.api.critic.registerPty(ptyId, tabId, projectPath)
    return () => window.api.critic.unregisterPty(ptyId)
  }, [ptyId, tabId, projectPath])
}
