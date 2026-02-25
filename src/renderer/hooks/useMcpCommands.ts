import { useEffect } from 'react'
import { useWorkspaceStore } from '@/stores/workspace'
import { useGalleryStore, type GalleryVariant } from '@/stores/gallery'
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

    /** Open the canvas panel if it's not already open. */
    const ensureCanvasOpen = (): void => {
      if (useWorkspaceStore.getState().mode !== 'terminal-canvas') {
        useWorkspaceStore.getState().openCanvas()
      }
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
          ensureCanvasOpen()
          useGalleryStore.getState().addVariant({
            id: `render-${Date.now()}`,
            label: 'Live Render',
            html: css ? `<style>${css}</style>${html}` : html
          })
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

        // If no command provided, pre-resolve to check confidence.
        // Low-confidence plans should not auto-start — show toast instead.
        // When confidence is OK, let dev:start auto-resolve internally
        // (it handles subdirectory projects correctly via spawnCwd).
        if (!command) {
          try {
            const resolved = await window.api.dev.resolve(projectCwd)
            if (!resolved?.plan || resolved.plan.confidence === 'low') {
              useToastStore.getState().addToast(
                'Could not auto-detect dev command. Use the Start button to configure.',
                'info'
              )
              return
            }
          } catch {
            useToastStore.getState().addToast('Failed to resolve dev command', 'error')
            return
          }
        }

        useTabsStore.getState().updateDevForProject(projectCwd, { status: 'starting' })

        // Listen for dev server output to detect URL
        const removeOutput = window.api.dev.onOutput(({ data }) => {
          const urlMatch = data.match(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+/)
          if (urlMatch) {
            const url = urlMatch[0]
            useTabsStore.getState().updateDevForProject(projectCwd, { status: 'running', url })
            useTabsStore.getState().updateTabsByProject(projectCwd, { previewUrl: url, activeCanvasTab: 'preview' })
            ensureCanvasOpen()
            useToastStore.getState().addToast(`Preview loaded: ${url}`, 'success')
          }
        })
        cleanups.push(removeOutput)

        // Pass command only when MCP explicitly provided one;
        // otherwise let dev:start auto-resolve (handles subdirectories)
        const result = await window.api.dev.start(projectCwd, command || undefined)

        if (result?.url) {
          const url = result.url
          useTabsStore.getState().updateDevForProject(projectCwd, { status: 'running', url, pid: result.pid ?? null })
          useTabsStore.getState().updateTabsByProject(projectCwd, { previewUrl: url, activeCanvasTab: 'preview' })
          ensureCanvasOpen()
        } else if (result?.error) {
          useTabsStore.getState().updateDevForProject(projectCwd, { status: 'error', lastError: result.error })
        }
      })
    )

    // canvas_stop_preview
    cleanups.push(
      window.api.mcp.onStopPreview(async ({ projectPath: eventPath }) => {
        if (shouldSkipEvent(eventPath)) return
        const projectCwd = findTargetTab(eventPath)?.project.path
          || useProjectStore.getState().currentProject?.path
        if (projectCwd) {
          await window.api.dev.stop(projectCwd)
          useTabsStore.getState().updateDevForProject(projectCwd, { status: 'stopped', url: null, pid: null })
          useTabsStore.getState().updateTabsByProject(projectCwd, { previewUrl: null })
        }
        useWorkspaceStore.getState().closeCanvas()
      })
    )

    // canvas_set_preview_url
    cleanups.push(
      window.api.mcp.onSetPreviewUrl(({ projectPath: eventPath, url }) => {
        if (shouldSkipEvent(eventPath)) return
        ensureCanvasOpen()
        updateTargetTab(eventPath, { previewUrl: url, activeCanvasTab: 'preview' })
      })
    )

    // canvas_open_tab
    cleanups.push(
      window.api.mcp.onOpenTab(({ projectPath: eventPath, tab }) => {
        if (shouldSkipEvent(eventPath)) return
        ensureCanvasOpen()
        updateTargetTab(eventPath, { activeCanvasTab: tab })
      })
    )

    // canvas_add_to_gallery
    cleanups.push(
      window.api.mcp.onAddToGallery(async ({ projectPath: eventPath, label, html, css, componentPath, description, category, pros, cons, annotations, sessionId, order }) => {
        if (shouldSkipEvent(eventPath)) return
        const variant: GalleryVariant = {
          id: `gallery-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          label,
          html: css ? `<style>${css}</style>${html}` : html,
          css,
          componentPath,
          description,
          category,
          pros,
          cons,
          annotations,
          sessionId,
          order,
          status: 'proposal',
          createdAt: Date.now(),
        }
        if (sessionId) {
          useGalleryStore.getState().addVariantToSession(sessionId, variant)
        } else {
          useGalleryStore.getState().addVariant(variant)
        }

        // When componentPath is set and dev server is running, generate a live preview URL
        if (componentPath) {
          const tab = findTargetTab(eventPath) || useTabsStore.getState().getActiveTab()
          if (tab?.dev?.status === 'running' && tab.dev.url) {
            try {
              const previewFilename = await window.api.component.previewSetup(tab.project.path)
              if (previewFilename) {
                const previewUrl = `${tab.dev.url}/${previewFilename}?c=${encodeURIComponent(componentPath)}`
                useGalleryStore.getState().updateVariant(variant.id, { previewUrl })
              }
            } catch (err) {
              console.warn('[mcp-commands] Failed to setup live preview for componentPath:', err)
            }
          }
        }

        ensureCanvasOpen()
        updateTargetTab(eventPath, { activeCanvasTab: 'gallery' })
      })
    )

    // canvas_design_session
    cleanups.push(
      window.api.mcp.onDesignSession(({ projectPath: eventPath, action, sessionId, title, prompt, variantId }) => {
        if (shouldSkipEvent(eventPath)) return
        const gallery = useGalleryStore.getState()

        if (action === 'start' && sessionId) {
          gallery.startSession({
            id: sessionId,
            title: title || 'Design Session',
            projectPath: eventPath || '',
            createdAt: Date.now(),
            variants: [],
            prompt,
          })
          gallery.setViewMode('session')
          ensureCanvasOpen()
          updateTargetTab(eventPath, { activeCanvasTab: 'gallery' })
        }

        if (action === 'end') {
          gallery.endSession(gallery.activeSessionId || '')
        }

        if (action === 'select' && variantId) {
          gallery.selectVariant(variantId)
        }
      })
    )

    // Expose gallery state on window for MCP get_status tool
    const unsub = useGalleryStore.subscribe((state) => {
      const activeSession = state.sessions.find((s) => s.id === state.activeSessionId)
      ;(window as any).__galleryState = {
        activeSessionId: state.activeSessionId,
        viewMode: state.viewMode,
        sessionTitle: activeSession?.title || null,
        variantCount: activeSession ? activeSession.variants.length : state.variants.length,
        selectedId: state.selectedId,
        variants: (activeSession
          ? state.variants.filter((v) => activeSession.variants.includes(v.id))
          : state.variants
        ).map((v) => ({ id: v.id, label: v.label, status: v.status || 'proposal' })),
      }
    })
    cleanups.push(unsub)

    // canvas_update_variant
    cleanups.push(
      window.api.mcp.onUpdateVariant(({ projectPath: eventPath, variantId, ...updates }) => {
        if (shouldSkipEvent(eventPath)) return
        useGalleryStore.getState().updateVariant(variantId, updates)
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

          // Resolve the actual parent commit hash (not `hash~1` string which
          // breaks screenshot lookup and timeline badge matching)
          const log = await window.api.git.log(project.path, 2) as { hash: string }[]
          const parentHash = log[1]?.hash || null

          if (parentHash) {
            updateTargetTab(eventPath, {
              diffBeforeHash: parentHash,
              diffAfterHash: result.hash,
            })
            // Don't switch away from gallery — user sees HMR updates live
            const targetTab = findTargetTab(eventPath)
            if (targetTab?.activeCanvasTab !== 'gallery') {
              updateTargetTab(eventPath, { activeCanvasTab: 'diff' })
              ensureCanvasOpen()
            }
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

    // Listen for dev:status 'ready' events (backup URL detection path)
    cleanups.push(
      window.api.dev.onStatus(({ stage, url, cwd }) => {
        if (stage !== 'ready' || !url) return
        const projectPath = cwd || useProjectStore.getState().currentProject?.path
        if (!projectPath) return
        // Only set if not already set (avoid duplicate updates)
        const matchingTab = useTabsStore.getState().tabs.find(
          (t) => t.project.path === projectPath && !t.previewUrl
        )
        if (!matchingTab) return
        useTabsStore.getState().updateDevForProject(projectPath, { status: 'running', url })
        useTabsStore.getState().updateTabsByProject(projectPath, { previewUrl: url, activeCanvasTab: 'preview' })
        ensureCanvasOpen()
        useToastStore.getState().addToast(`Preview loaded: ${url}`, 'success')
      })
    )

    // Auto-close canvas when dev server exits — filtered by cwd
    cleanups.push(
      window.api.dev.onExit(({ cwd }) => {
        useTabsStore.getState().updateDevForProject(cwd, { status: 'stopped', url: null, pid: null })
        useTabsStore.getState().updateTabsByProject(cwd, { previewUrl: null })
        // Only close canvas if the exited server belongs to the active tab
        const active = useTabsStore.getState().getActiveTab()
        if (active?.project.path === cwd) {
          useWorkspaceStore.getState().closeCanvas()
        }
      })
    )

    return () => cleanups.forEach((fn) => fn())
  }, [])
}
