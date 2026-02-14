import { useEffect } from 'react'
import { useCanvasStore } from '@/stores/canvas'
import { useWorkspaceStore } from '@/stores/workspace'
import { useGalleryStore } from '@/stores/gallery'
import { useProjectStore } from '@/stores/project'
import { useToastStore } from '@/stores/toast'
import { useTabsStore } from '@/stores/tabs'
import { getTerminal } from '@/services/terminalPool'

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

    /**
     * Find the tab matching the event's projectPath. If no projectPath is
     * provided, fall back to the active tab. Returns null if no match (event
     * should be ignored).
     */
    const findTargetTab = (eventPath?: string) => {
      const { tabs, activeTabId, getActiveTab } = useTabsStore.getState()
      if (!eventPath) return getActiveTab()
      const match = tabs.find((t) => t.project.path === eventPath)
      return match || null
    }

    /** Update the tab that owns this event (not necessarily the active tab). */
    const updateTargetTab = (eventPath: string | undefined, partial: Record<string, unknown>) => {
      const tab = findTargetTab(eventPath)
      if (tab) useTabsStore.getState().updateTab(tab.id, partial)
    }

    /** Returns true if the event's project has no open tab. */
    const shouldSkipEvent = (eventPath?: string): boolean => {
      return !findTargetTab(eventPath)
    }

    // canvas_render — evaluate size, then route to inline or canvas
    cleanups.push(
      window.api.mcp.onCanvasRender(async ({ projectPath: eventPath, html, css }) => {
        if (shouldSkipEvent(eventPath)) return
        const result = await window.api.render.evaluate(html, css)

        if (result.target === 'inline') {
          // Render small components inline in the terminal using xterm decorations
          const { activeTabId } = useTabsStore.getState()
          const terminal = activeTabId ? getTerminal(activeTabId) : null
          if (terminal) {
            const charHeight = Math.ceil(
              (terminal.options.fontSize || 14) * (terminal.options.lineHeight || 1.4)
            )
            const rows = Math.ceil(result.height / charHeight) + 1

            // Write blank lines to make room
            for (let i = 0; i < rows; i++) terminal.write('\r\n')

            const marker = terminal.registerMarker(-(rows - 1))
            if (marker) {
              const decoration = terminal.registerDecoration({
                marker,
                width: Math.ceil(result.width / 8) + 2,
                height: rows
              })
              if (decoration) {
                decoration.onRender((element) => {
                  if (element.querySelector('iframe')) return
                  element.style.overflow = 'hidden'
                  element.style.zIndex = '1'
                  const iframe = document.createElement('iframe')
                  iframe.style.width = `${result.width}px`
                  iframe.style.height = `${result.height}px`
                  iframe.style.border = '1px solid rgba(74, 234, 255, 0.2)'
                  iframe.style.borderRadius = '4px'
                  iframe.style.background = 'white'
                  iframe.sandbox.add('allow-same-origin')
                  iframe.srcdoc = `<!DOCTYPE html><html><head><style>body{margin:0;padding:8px;font-family:system-ui,sans-serif}${css || ''}</style></head><body>${html}</body></html>`
                  element.appendChild(iframe)
                })
              }
            }
            useWorkspaceStore.getState().setMode('terminal-inline')
          }
        } else {
          // Large component — render in canvas panel
          if (useWorkspaceStore.getState().mode !== 'terminal-canvas') {
            useWorkspaceStore.getState().openCanvas()
          }
          useGalleryStore.getState().addVariant({
            id: `render-${Date.now()}`,
            label: 'Live Render',
            html: css ? `<style>${css}</style>${html}` : html
          })
          useCanvasStore.getState().setActiveTab('gallery')
          updateTargetTab(eventPath, { activeCanvasTab: 'gallery' })
        }
      })
    )

    // canvas_start_preview
    cleanups.push(
      window.api.mcp.onStartPreview(async ({ projectPath: eventPath, command, cwd }) => {
        if (shouldSkipEvent(eventPath)) return
        const projectCwd = cwd || useProjectStore.getState().currentProject?.path
        if (!projectCwd) return

        // Listen for dev server output to detect URL
        const removeOutput = window.api.dev.onOutput(({ data }) => {
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
            updateTargetTab(eventPath, { previewUrl: url, isDevServerRunning: true, activeCanvasTab: 'preview' })
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
          updateTargetTab(eventPath, { previewUrl: url, isDevServerRunning: true, activeCanvasTab: 'preview' })
        }
      })
    )

    // canvas_stop_preview
    cleanups.push(
      window.api.mcp.onStopPreview(async ({ projectPath: eventPath }) => {
        if (shouldSkipEvent(eventPath)) return
        const projectCwd = useProjectStore.getState().currentProject?.path
        await window.api.dev.stop(projectCwd)
        useProjectStore.getState().setDevServerRunning(false)
        updateTargetTab(eventPath, { isDevServerRunning: false, previewUrl: null })
        useWorkspaceStore.getState().closeCanvas()
      })
    )

    // canvas_set_preview_url
    cleanups.push(
      window.api.mcp.onSetPreviewUrl(({ projectPath: eventPath, url }) => {
        if (shouldSkipEvent(eventPath)) return
        useCanvasStore.getState().setPreviewUrl(url)
        if (useWorkspaceStore.getState().mode !== 'terminal-canvas') {
          useWorkspaceStore.getState().openCanvas()
        }
        useCanvasStore.getState().setActiveTab('preview')
        updateTargetTab(eventPath, { previewUrl: url, activeCanvasTab: 'preview' })
      })
    )

    // canvas_open_tab
    cleanups.push(
      window.api.mcp.onOpenTab(({ projectPath: eventPath, tab }) => {
        if (shouldSkipEvent(eventPath)) return
        if (useWorkspaceStore.getState().mode !== 'terminal-canvas') {
          useWorkspaceStore.getState().openCanvas()
        }
        useCanvasStore.getState().setActiveTab(tab as any)
        updateTargetTab(eventPath, { activeCanvasTab: tab })
      })
    )

    // canvas_add_to_gallery
    cleanups.push(
      window.api.mcp.onAddToGallery(({ projectPath: eventPath, label, html, css }) => {
        if (shouldSkipEvent(eventPath)) return
        useGalleryStore.getState().addVariant({
          id: `gallery-${Date.now()}`,
          label,
          html: css ? `<style>${css}</style>${html}` : html
        })
        if (useWorkspaceStore.getState().mode !== 'terminal-canvas') {
          useWorkspaceStore.getState().openCanvas()
        }
        useCanvasStore.getState().setActiveTab('gallery')
        updateTargetTab(eventPath, { activeCanvasTab: 'gallery' })
      })
    )

    // canvas_checkpoint — commit + capture screenshot + auto-open diff
    cleanups.push(
      window.api.mcp.onCheckpoint(async ({ projectPath: eventPath, message }) => {
        if (shouldSkipEvent(eventPath)) return
        const project = useProjectStore.getState().currentProject
        if (!project?.path) return
        const result = await window.api.git.checkpoint(project.path, message)
        if (result?.hash) {
          await window.api.screenshot.captureCheckpoint(result.hash, project.path)

          // Auto-open diff tab with this checkpoint's changes
          const parentHash = result.hash + '~1'
          useCanvasStore.getState().setDiffHashes(parentHash, result.hash)
          updateTargetTab(eventPath, {
            diffBeforeHash: parentHash,
            diffAfterHash: result.hash,
            activeCanvasTab: 'diff',
          })
          useCanvasStore.getState().setActiveTab('diff')
          if (useWorkspaceStore.getState().mode !== 'terminal-canvas') {
            useWorkspaceStore.getState().openCanvas()
          }
        }
      })
    )

    // canvas_notify — show toast notification
    cleanups.push(
      window.api.mcp.onNotify(({ projectPath: eventPath, message, type }) => {
        if (shouldSkipEvent(eventPath)) return
        useToastStore.getState().addToast(message, type as 'info' | 'success' | 'error')
      })
    )

    // Auto-close canvas when dev server exits
    cleanups.push(
      window.api.dev.onExit(({ cwd: _cwd }) => {
        useCanvasStore.getState().setPreviewUrl(null)
        const activeTab = useTabsStore.getState().getActiveTab()
        if (activeTab) {
          useTabsStore.getState().updateTab(activeTab.id, { isDevServerRunning: false, previewUrl: null })
        }
        useWorkspaceStore.getState().closeCanvas()
        useToastStore.getState().addToast('Dev server stopped', 'info')
      })
    )

    return () => cleanups.forEach((fn) => fn())
  }, [])
}
