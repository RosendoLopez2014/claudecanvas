import { useEffect, useCallback } from 'react'
import { useTabsStore } from '@/stores/tabs'

/**
 * Per-tab MCP session lifecycle hook.
 *
 * - Calls `projectOpened({ tabId, projectPath })` on mount
 * - Sets `boot.mcpReady = true` on success, `'error'` on failure
 * - Re-inits when projectPath changes or when retryMcp(tabId) bumps mcpRetryCount
 * - Calls `projectClosed({ tabId })` on cleanup
 */
export function useTabMcpInit(tabId: string, projectPath: string) {
  // Subscribe to retry counter — when BootOverlay calls retryMcp(tabId),
  // the counter bumps and this effect re-runs.
  const retryCount = useTabsStore(
    useCallback((s) => s.tabs.find((t) => t.id === tabId)?.mcpRetryCount ?? 0, [tabId])
  )

  useEffect(() => {
    // Skip ONLY if already initialized for THIS exact projectPath
    const tab = useTabsStore.getState().tabs.find((t) => t.id === tabId)
    if (tab?.boot.mcpReady === true && tab?.mcpProjectPath === projectPath) return

    // Reset to loading
    if (tab) {
      useTabsStore.getState().updateTab(tabId, {
        boot: { ...tab.boot, mcpReady: false },
        mcpProjectPath: null,
      })
    }

    let cancelled = false

    window.api.mcp.projectOpened({ tabId, projectPath })
      .then(({ port }: { port: number }) => {
        if (cancelled) return
        const t = useTabsStore.getState().tabs.find((t) => t.id === tabId)
        if (t) {
          useTabsStore.getState().updateTab(tabId, {
            mcpReady: true,
            mcpPort: port,
            mcpProjectPath: projectPath,
            boot: { ...t.boot, mcpReady: true },
          })
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.error(`[MCP][tabId=${tabId}] Init failed:`, err)
        const t = useTabsStore.getState().tabs.find((t) => t.id === tabId)
        if (t) {
          useTabsStore.getState().updateTab(tabId, {
            boot: { ...t.boot, mcpReady: 'error' },
          })
        }
      })

    return () => {
      cancelled = true
      window.api.mcp.projectClosed({ tabId })
    }
  }, [tabId, projectPath, retryCount])
}
