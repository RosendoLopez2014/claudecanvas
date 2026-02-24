import { useEffect, useState } from 'react'
import { useCanvasStore } from '@/stores/canvas'
import { useWorkspaceStore } from '@/stores/workspace'
import { useProjectStore } from '@/stores/project'
import { useTabsStore, selectActiveTab } from '@/stores/tabs'

/**
 * Exposes current canvas / workspace / project state on window globals
 * so that the MCP server (via `webContents.executeJavaScript`) can
 * query renderer state synchronously without round-tripping through IPC.
 *
 * window.__canvasState   — general canvas & workspace info
 * window.__inspectorContext — selected inspector elements (array)
 */
export function useMcpStateExposer() {
  const { activeTab, inspectorActive, selectedElements, previewErrors, addPreviewError, addConsoleLog } = useCanvasStore()
  const { mode } = useWorkspaceStore()
  const { currentProject } = useProjectStore()
  const currentTab = useTabsStore(selectActiveTab)
  const previewUrl = currentTab?.previewUrl ?? null
  const isDevServerRunning = currentTab?.dev.status === 'running'
  const [supabaseConnected, setSupabaseConnected] = useState(false)

  // Fetch Supabase connection status
  useEffect(() => {
    window.api.oauth.supabase.status().then((s) => {
      setSupabaseConnected((s as { connected: boolean }).connected)
    }).catch(() => {})
  }, [currentProject])

  useEffect(() => {
    ;(window as any).__canvasState = {
      activeTab,
      previewUrl,
      inspectorActive,
      workspaceMode: mode,
      devServerRunning: isDevServerRunning,
      projectName: currentProject?.name || null,
      projectPath: currentProject?.path || null,
      supabaseConnected,
      errors: previewErrors
    }
  }, [activeTab, previewUrl, inspectorActive, mode, isDevServerRunning, currentProject, supabaseConnected, previewErrors])

  // Listen for runtime errors and console logs from the preview iframe
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'inspector:runtimeError' && e.data.error) {
        addPreviewError(e.data.error)
      }
      if (e.data?.type === 'inspector:consoleLog' && e.data.log) {
        addConsoleLog(e.data.log)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [addPreviewError, addConsoleLog])

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
