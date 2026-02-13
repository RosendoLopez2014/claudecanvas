import { useEffect } from 'react'
import { useCanvasStore } from '@/stores/canvas'
import { useWorkspaceStore } from '@/stores/workspace'
import { useGalleryStore } from '@/stores/gallery'
import { useProjectStore } from '@/stores/project'

/**
 * Listens for MCP commands forwarded from the main process via IPC
 * and dispatches them to the appropriate Zustand stores.
 *
 * All store access inside callbacks uses `getState()` to avoid
 * stale closure issues — the effect registers listeners once (empty deps).
 */
export function useMcpCommands() {
  useEffect(() => {
    const cleanups: (() => void)[] = []

    // canvas_render — evaluate size, then route to inline or canvas
    cleanups.push(
      window.api.mcp.onCanvasRender(async ({ html, css }) => {
        const result = await window.api.render.evaluate(html, css)
        if (result.target === 'canvas') {
          if (useWorkspaceStore.getState().mode !== 'terminal-canvas') {
            useWorkspaceStore.getState().openCanvas()
          }
          useGalleryStore.getState().addVariant({
            id: `render-${Date.now()}`,
            label: 'Live Render',
            html: css ? `<style>${css}</style>${html}` : html
          })
          useCanvasStore.getState().setActiveTab('gallery')
        }
      })
    )

    // canvas_start_preview
    cleanups.push(
      window.api.mcp.onStartPreview(async ({ command, cwd }) => {
        const projectCwd = cwd || useProjectStore.getState().currentProject?.path
        if (!projectCwd) return
        await window.api.dev.start(projectCwd, command)
        useProjectStore.getState().setDevServerRunning(true)
        if (useWorkspaceStore.getState().mode !== 'terminal-canvas') {
          useWorkspaceStore.getState().openCanvas()
        }
        useCanvasStore.getState().setActiveTab('preview')
      })
    )

    // canvas_stop_preview
    cleanups.push(
      window.api.mcp.onStopPreview(async () => {
        await window.api.dev.stop()
        useProjectStore.getState().setDevServerRunning(false)
        useWorkspaceStore.getState().closeCanvas()
      })
    )

    // canvas_set_preview_url
    cleanups.push(
      window.api.mcp.onSetPreviewUrl(({ url }) => {
        useCanvasStore.getState().setPreviewUrl(url)
        if (useWorkspaceStore.getState().mode !== 'terminal-canvas') {
          useWorkspaceStore.getState().openCanvas()
        }
        useCanvasStore.getState().setActiveTab('preview')
      })
    )

    // canvas_open_tab
    cleanups.push(
      window.api.mcp.onOpenTab(({ tab }) => {
        if (useWorkspaceStore.getState().mode !== 'terminal-canvas') {
          useWorkspaceStore.getState().openCanvas()
        }
        useCanvasStore.getState().setActiveTab(tab as any)
      })
    )

    // canvas_add_to_gallery
    cleanups.push(
      window.api.mcp.onAddToGallery(({ label, html, css }) => {
        useGalleryStore.getState().addVariant({
          id: `gallery-${Date.now()}`,
          label,
          html: css ? `<style>${css}</style>${html}` : html
        })
        if (useWorkspaceStore.getState().mode !== 'terminal-canvas') {
          useWorkspaceStore.getState().openCanvas()
        }
        useCanvasStore.getState().setActiveTab('gallery')
      })
    )

    // canvas_checkpoint
    cleanups.push(
      window.api.mcp.onCheckpoint(async ({ message }) => {
        await window.api.git.checkpoint(message)
      })
    )

    // canvas_notify — log for now, toast system added in Task 13
    cleanups.push(
      window.api.mcp.onNotify(({ message, type }) => {
        console.log(`[MCP Notify] (${type}): ${message}`)
      })
    )

    return () => cleanups.forEach((fn) => fn())
  }, [])
}
