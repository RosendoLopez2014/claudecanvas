import { useTabsStore, TabState } from '@/stores/tabs'
import { useCallback } from 'react'

/**
 * Returns the active tab's state and a scoped updater.
 * Components use this instead of direct store access for per-tab state.
 */
export function useTabState() {
  const activeTab = useTabsStore((s) => {
    const id = s.activeTabId
    return id ? s.tabs.find((t) => t.id === id) || null : null
  })

  const update = useCallback((partial: Omit<Partial<TabState>, 'id' | 'project'>) => {
    const id = useTabsStore.getState().activeTabId
    if (id) useTabsStore.getState().updateTab(id, partial)
  }, [])

  return { tab: activeTab, update }
}

/**
 * Selector for specific tab fields (optimized re-renders).
 */
export function useActiveTabField<K extends keyof TabState>(field: K): TabState[K] | undefined {
  return useTabsStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId)
    return tab?.[field]
  })
}
