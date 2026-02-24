import { useEffect } from 'react'
import { useTabsStore, selectActiveTab } from '@/stores/tabs'
import { useProjectStore } from '@/stores/project'
import { useCanvasStore } from '@/stores/canvas'

/**
 * Syncs the active tab's dev server state to deprecated global stores.
 *
 * Components like A11yAudit, PerfMetrics, DesignFeedback, DiffView still read
 * from useCanvasStore().previewUrl and useProjectStore().isDevServerRunning.
 * Rather than migrating all of them at once, this hook keeps those globals
 * in sync with the active tab's canonical state.
 *
 * Mount this once in App.tsx.
 */
export function useDevServerSync() {
  const tab = useTabsStore(selectActiveTab)

  useEffect(() => {
    const isRunning = tab?.dev.status === 'running'
    const url = tab?.previewUrl ?? null

    // Only write if changed to avoid unnecessary re-renders
    if (useProjectStore.getState().isDevServerRunning !== isRunning) {
      useProjectStore.getState().setDevServerRunning(isRunning)
    }
    if (useCanvasStore.getState().previewUrl !== url) {
      useCanvasStore.getState().setPreviewUrl(url)
    }
  }, [tab?.dev.status, tab?.previewUrl])
}
