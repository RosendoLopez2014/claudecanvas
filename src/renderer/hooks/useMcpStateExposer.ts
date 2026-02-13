import { useEffect } from 'react'
import { useCanvasStore } from '@/stores/canvas'
import { useWorkspaceStore } from '@/stores/workspace'
import { useProjectStore } from '@/stores/project'

/**
 * Exposes current canvas / workspace / project state on window globals
 * so that the MCP server (via `webContents.executeJavaScript`) can
 * query renderer state synchronously without round-tripping through IPC.
 *
 * window.__canvasState   — general canvas & workspace info
 * window.__inspectorContext — currently-selected inspector element (if any)
 */
export function useMcpStateExposer() {
  const { activeTab, previewUrl, inspectorActive, selectedElement } = useCanvasStore()
  const { mode } = useWorkspaceStore()
  const { isDevServerRunning, currentProject } = useProjectStore()

  useEffect(() => {
    ;(window as any).__canvasState = {
      activeTab,
      previewUrl,
      inspectorActive,
      workspaceMode: mode,
      devServerRunning: isDevServerRunning,
      projectName: currentProject?.name || null,
      projectPath: currentProject?.path || null
    }
  }, [activeTab, previewUrl, inspectorActive, mode, isDevServerRunning, currentProject])

  useEffect(() => {
    ;(window as any).__inspectorContext = selectedElement
      ? { selected: true, ...selectedElement }
      : { selected: false }
  }, [selectedElement])
}
