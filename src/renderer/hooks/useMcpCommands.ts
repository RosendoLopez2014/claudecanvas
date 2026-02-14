import { useEffect } from 'react'
import { useCanvasStore } from '@/stores/canvas'
import { useWorkspaceStore } from '@/stores/workspace'
import { useGalleryStore } from '@/stores/gallery'
import { useProjectStore } from '@/stores/project'
import { useToastStore } from '@/stores/toast'
import { useTabsStore } from '@/stores/tabs'

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

    const updateActiveTab = (partial: Record<string, unknown>) => {
      const { activeTabId, updateTab } = useTabsStore.getState()
      if (activeTabId) updateTab(activeTabId, partial)
    }

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
          updateActiveTab({ activeCanvasTab: 'gallery' })
        }
      })
    )

    // canvas_start_preview
    cleanups.push(
      window.api.mcp.onStartPreview(async ({ command, cwd }) => {
        const projectCwd = cwd || useProjectStore.getState().currentProject?.path
        if (!projectCwd) return

        // Listen for dev server output to detect URL
        const removeOutput = window.api.dev.onOutput((data) => {
          // Match common dev server URL patterns (Vite, Next, CRA, etc.)
          const urlMatch = data.match(/https?:\/\/localhost:\d+/)
          if (urlMatch) {
            const url = urlMatch[0]
            useCanvasStore.getState().setPreviewUrl(url)
            useProjectStore.getState().setDevServerRunning(true)
            if (useWorkspaceStore.getState().mode !== 'terminal-canvas') {
              useWorkspaceStore.getState().openCanvas()
            }
            useCanvasStore.getState().setActiveTab('preview')
            updateActiveTab({ previewUrl: url, isDevServerRunning: true, activeCanvasTab: 'preview' })
            useToastStore.getState().addToast(`Preview loaded: ${url}`, 'success')
          }
        })
        cleanups.push(removeOutput)

        const result = await window.api.dev.start(projectCwd, command)

        // If port was detected immediately, set the URL
        if (result?.port) {
          const url = result.url || `http://localhost:${result.port}`
          useCanvasStore.getState().setPreviewUrl(url)
          useProjectStore.getState().setDevServerRunning(true)
          if (useWorkspaceStore.getState().mode !== 'terminal-canvas') {
            useWorkspaceStore.getState().openCanvas()
          }
          useCanvasStore.getState().setActiveTab('preview')
          updateActiveTab({ previewUrl: url, isDevServerRunning: true, activeCanvasTab: 'preview' })
        }
      })
    )

    // canvas_stop_preview
    cleanups.push(
      window.api.mcp.onStopPreview(async () => {
        await window.api.dev.stop()
        useProjectStore.getState().setDevServerRunning(false)
        updateActiveTab({ isDevServerRunning: false, previewUrl: null })
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
        updateActiveTab({ previewUrl: url, activeCanvasTab: 'preview' })
      })
    )

    // canvas_open_tab
    cleanups.push(
      window.api.mcp.onOpenTab(({ tab }) => {
        if (useWorkspaceStore.getState().mode !== 'terminal-canvas') {
          useWorkspaceStore.getState().openCanvas()
        }
        useCanvasStore.getState().setActiveTab(tab as any)
        updateActiveTab({ activeCanvasTab: tab })
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
        updateActiveTab({ activeCanvasTab: 'gallery' })
      })
    )

    // canvas_checkpoint — commit + capture screenshot for visual diff
    cleanups.push(
      window.api.mcp.onCheckpoint(async ({ message }) => {
        const result = await window.api.git.checkpoint(message)
        const project = useProjectStore.getState().currentProject
        if (result?.hash && project?.path) {
          await window.api.screenshot.captureCheckpoint(result.hash, project.path)
        }
      })
    )

    // canvas_notify — show toast notification
    cleanups.push(
      window.api.mcp.onNotify(({ message, type }) => {
        useToastStore.getState().addToast(message, type as 'info' | 'success' | 'error')
      })
    )

    return () => cleanups.forEach((fn) => fn())
  }, [])
}
