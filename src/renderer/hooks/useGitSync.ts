import { useEffect, useRef } from 'react'
import { useTabsStore } from '@/stores/tabs'

const FETCH_INTERVAL_MS = 3 * 60 * 1000 // 3 minutes

/**
 * Auto-fetches from remote on tab focus and every 3 minutes.
 * Stores ahead/behind counts in the active tab's state.
 */
export function useGitSync() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const activeTabId = useTabsStore((s) => s.activeTabId)

  useEffect(() => {
    const fetchForActiveTab = async () => {
      const tab = useTabsStore.getState().getActiveTab()
      if (!tab) return

      const projectPath = tab.project.path
      try {
        // Check if remote exists first
        const remoteUrl = await window.api.git.remoteUrl(projectPath)
        const hasRemote = !!remoteUrl

        if (!hasRemote) {
          useTabsStore.getState().updateTab(tab.id, {
            gitRemoteConfigured: false,
            gitAhead: 0,
            gitBehind: 0,
          })
          return
        }

        useTabsStore.getState().updateTab(tab.id, { gitRemoteConfigured: true })

        const result = await window.api.git.fetch(projectPath)
        if (!result.error) {
          useTabsStore.getState().updateTab(tab.id, {
            gitAhead: result.ahead,
            gitBehind: result.behind,
          })
        }
      } catch {
        // Network error — silently ignore, don't update counts
      }
    }

    // Fetch on mount (tab activated)
    fetchForActiveTab()

    // Fetch every 3 minutes
    intervalRef.current = setInterval(fetchForActiveTab, FETCH_INTERVAL_MS)

    // Fetch when window regains focus
    const onFocus = () => fetchForActiveTab()
    window.addEventListener('focus', onFocus)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      window.removeEventListener('focus', onFocus)
    }
  }, [activeTabId])
}
