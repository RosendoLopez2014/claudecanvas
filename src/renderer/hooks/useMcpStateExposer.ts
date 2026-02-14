import { useEffect, useState } from 'react'
import { useCanvasStore } from '@/stores/canvas'
import { useWorkspaceStore } from '@/stores/workspace'
import { useProjectStore } from '@/stores/project'

/**
 * Exposes current canvas / workspace / project state on window globals
 * so that the MCP server (via `webContents.executeJavaScript`) can
 * query renderer state synchronously without round-tripping through IPC.
 *
 * window.__canvasState   — general canvas & workspace info
 * window.__inspectorContext — selected inspector elements (array)
 */
export function useMcpStateExposer() {
  const { activeTab, previewUrl, inspectorActive, selectedElements } = useCanvasStore()
  const { mode } = useWorkspaceStore()
  const { isDevServerRunning, currentProject } = useProjectStore()
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
      supabaseConnected
    }
  }, [activeTab, previewUrl, inspectorActive, mode, isDevServerRunning, currentProject, supabaseConnected])

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
