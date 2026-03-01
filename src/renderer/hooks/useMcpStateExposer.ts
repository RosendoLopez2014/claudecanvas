import { useEffect, useRef, useState } from 'react'
import { useWorkspaceStore } from '@/stores/workspace'
import { useProjectStore } from '@/stores/project'
import { useTabsStore, useActiveTab } from '@/stores/tabs'
import { useDevRepairStore } from '@/stores/devRepair'
import { useCriticStore } from '@/stores/critic'

// Stable empty array references — avoids creating new [] each render
// which would cause React's getSnapshot infinite loop detection to fire.
const EMPTY_ELEMENTS: never[] = []
const EMPTY_ERRORS: never[] = []

/**
 * Exposes current canvas / workspace / project state on window globals
 * so that the MCP server (via `webContents.executeJavaScript`) can
 * query renderer state synchronously without round-tripping through IPC.
 *
 * window.__canvasState   — general canvas & workspace info
 * window.__inspectorContext — selected inspector elements (array)
 */
export function useMcpStateExposer() {
  const currentTab = useActiveTab()
  const activeTab = currentTab?.activeCanvasTab ?? 'preview'
  const inspectorActive = currentTab?.inspectorActive ?? false
  const selectedElements = currentTab?.selectedElements ?? EMPTY_ELEMENTS
  const previewErrors = currentTab?.previewErrors ?? EMPTY_ERRORS
  const previewUrl = currentTab?.previewUrl ?? null
  const { mode } = useWorkspaceStore()
  const { currentProject } = useProjectStore()
  const isDevServerRunning = currentTab?.dev.status === 'running'
  const activeRepairs = useDevRepairStore((s) => s.activeRepairs)
  const recentRepairs = useDevRepairStore((s) => s.recentRepairs)
  const criticSessions = useCriticStore((s) => s.activeSessions)
  const criticRecent = useCriticStore((s) => s.recentSessions)
  const [supabaseConnected, setSupabaseConnected] = useState(false)

  // Fetch Supabase connection status
  useEffect(() => {
    window.api.oauth.supabase.status().then((s) => {
      setSupabaseConnected((s as { connected: boolean }).connected)
    }).catch(() => {})
  }, [currentProject])

  useEffect(() => {
    // Build repair status summary for MCP tools
    const projectPath = currentProject?.path || null
    const repairForProject = projectPath ? activeRepairs[projectPath] : null
    const lastEvent = repairForProject?.events.length
      ? repairForProject.events[repairForProject.events.length - 1]
      : null
    const repairStatus = repairForProject
      ? {
          active: true,
          sessionId: repairForProject.sessionId,
          repairId: repairForProject.repairId,
          status: repairForProject.status,
          agentEngaged: repairForProject.agentEngaged,
          attempt: lastEvent?.attempt ?? 0,
          maxAttempts: lastEvent?.maxAttempts ?? 3,
          lastPhase: lastEvent?.phase ?? null,
          lastMessage: lastEvent?.message ?? null,
        }
      : recentRepairs.length > 0
        ? {
            active: false,
            sessionId: recentRepairs[0].sessionId,
            repairId: recentRepairs[0].repairId,
            status: recentRepairs[0].status,
            agentEngaged: recentRepairs[0].agentEngaged,
            lastMessage: recentRepairs[0].events.length > 0
              ? recentRepairs[0].events[recentRepairs[0].events.length - 1].message
              : null,
          }
        : null

    ;(window as any).__canvasState = {
      activeTab,
      previewUrl,
      inspectorActive,
      workspaceMode: mode,
      devServerRunning: isDevServerRunning,
      projectName: currentProject?.name || null,
      projectPath,
      supabaseConnected,
      errors: previewErrors,
      repairStatus,
      criticStatus: (() => {
        const tabId = currentTab?.id
        const session = tabId ? criticSessions[tabId] : null
        const recent = criticRecent.find((s) => s.tabId === tabId)
        const latest = session ?? recent
        if (!latest) return null
        return {
          active: !!session,
          phase: latest.phase,
          planVerdict: latest.planFeedback?.verdict ?? null,
          resultVerdict: latest.resultFeedback?.verdict ?? null,
          iteration: latest.iteration,
          maxIterations: latest.maxIterations,
        }
      })(),
    }
  }, [activeTab, previewUrl, inspectorActive, mode, isDevServerRunning, currentProject, supabaseConnected, previewErrors, activeRepairs, recentRepairs, criticSessions, criticRecent, currentTab])

  // Listen for runtime errors and console logs from the preview iframe
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'inspector:runtimeError' && e.data.error) {
        const tab = useTabsStore.getState().getActiveTab()
        if (tab) useTabsStore.getState().addPreviewError(tab.id, e.data.error)
      }
      if (e.data?.type === 'inspector:consoleLog' && e.data.log) {
        const tab = useTabsStore.getState().getActiveTab()
        if (tab) useTabsStore.getState().addConsoleLog(tab.id, e.data.log)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  // Auto-clear stale errors after HMR updates (file changes)
  // Debounced: waits 2s after last file change so HMR settles,
  // then clears old errors. New errors from the reloaded code
  // will re-appear if the fix didn't work.
  const hmrTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const cleanup = window.api.fs.onChange(() => {
      if (hmrTimerRef.current) clearTimeout(hmrTimerRef.current)
      hmrTimerRef.current = setTimeout(() => {
        hmrTimerRef.current = null
        const tab = useTabsStore.getState().getActiveTab()
        if (tab) {
          useTabsStore.getState().clearPreviewErrors(tab.id)
          useTabsStore.getState().clearConsoleLogs(tab.id)
        }
      }, 2000)
    })
    return () => {
      cleanup()
      if (hmrTimerRef.current) clearTimeout(hmrTimerRef.current)
    }
  }, [])

  useEffect(() => {
    ;(window as any).__inspectorContext = selectedElements.length > 0
      ? {
          selected: true,
          count: selectedElements.length,
          elements: selectedElements,
          // Backward compat: first element at root
          ...selectedElements[0]
        }
      : { selected: false, count: 0, elements: [] }
  }, [selectedElements])
}
