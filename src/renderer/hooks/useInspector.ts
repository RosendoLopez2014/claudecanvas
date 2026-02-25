import { useEffect, useCallback, useRef, RefObject } from 'react'
import { useTabsStore, selectActiveTab } from '@/stores/tabs'
import type { ElementContext } from '@/types/canvas'
import { useTerminalStore } from '@/stores/terminal'
import { useProjectStore } from '@/stores/project'

export function useInspector(iframeRef: RefObject<HTMLIFrameElement | null>) {
  const currentTab = useTabsStore(selectActiveTab)
  const inspectorActive = currentTab?.inspectorActive ?? false
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Listen for messages from inspector overlay in iframe
  useEffect(() => {
    const handler = async (event: MessageEvent) => {
      // Security: only accept messages from our own iframes (same origin)
      // or from the expected localhost preview frames
      if (event.origin !== window.location.origin &&
          !event.origin.startsWith('http://localhost') &&
          !event.origin.startsWith('http://127.0.0.1')) {
        return
      }
      // Only process known inspector message types
      if (typeof event.data?.type !== 'string' ||
          !event.data.type.startsWith('inspector:')) {
        return
      }
      if (event.data?.type === 'inspector:verifyComplete') {
        const tab = useTabsStore.getState().getActiveTab()
        if (tab) useTabsStore.getState().updateTab(tab.id, { selectedElements: [] })
        return
      }
      if (event.data?.type === 'inspector:elementSelected') {
        const raw = event.data.element
        const projPath = useProjectStore.getState().currentProject?.path

        // Resolve file path — from _debugSource or by searching
        let filePath = raw.sourceFile
        if (filePath && projPath && filePath.startsWith(projPath)) {
          filePath = filePath.slice(projPath.length + 1)
        }

        // If no _debugSource, search for the file by component name
        if (!filePath && raw.componentName && projPath) {
          const tag = raw.tagName
          const name = raw.componentName
          // Only search if component name differs from tag (it's a real component)
          if (name !== tag && name !== 'Component') {
            filePath = await window.api.inspector.findFile(name, projPath)
          }
        }

        const el: ElementContext = {
          tagName: raw.tagName,
          id: raw.id,
          className: raw.className,
          componentName: raw.componentName,
          componentChain: raw.componentChain,
          filePath,
          lineNumber: raw.sourceLine,
          props: raw.props,
          textContent: raw.textContent,
          rect: raw.rect,
          styles: raw.styles,
          a11y: raw.a11y,
          parentLayout: raw.parentLayout,
          siblingCount: raw.siblingCount,
          eventHandlers: raw.eventHandlers,
          html: raw.html
        }

        // Append to selection (multi-select: each click adds)
        const tab = useTabsStore.getState().getActiveTab()
        if (tab) useTabsStore.getState().updateTab(tab.id, { selectedElements: [...tab.selectedElements, el] })
        pasteContextToTerminal(el)

        // Inspector stays active — user toggles off manually
        // Auto-focus terminal so user can type immediately
        setTimeout(() => useTerminalStore.getState().focus(), 50)
      }
    }

    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  // Fade all highlights when files change (HMR edit landed)
  useEffect(() => {
    const cleanup = window.api.fs.onChange((_data: { projectPath: string; path: string }) => {
      const tab = useTabsStore.getState().getActiveTab()
      if (!tab || tab.selectedElements.length === 0) return

      // Debounce: reset timer on each file change, fade 2s after last change
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
      fadeTimerRef.current = setTimeout(() => {
        fadeTimerRef.current = null
        const iframe = iframeRef.current
        // Trigger scan animation + fade — clearSelectedElements happens on verifyComplete
        iframe?.contentWindow?.postMessage({ type: 'inspector:verifyEdit' }, '*')  // targetOrigin '*' OK: iframe origin varies (localhost:N); overlay validates e.source
      }, 2000)
    })

    return () => {
      cleanup()
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
    }
  }, [iframeRef])

  // Toggle inspector in iframe via postMessage (works cross-origin)
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe?.contentWindow) return

    iframe.contentWindow.postMessage(
      { type: inspectorActive ? 'inspector:activate' : 'inspector:deactivate' },
      '*'  // targetOrigin '*' OK: iframe origin varies (localhost:N); overlay validates e.source
    )
  }, [inspectorActive, iframeRef])

  // Inject inspector overlay into iframe via main process IPC
  const injectInspector = useCallback(async () => {
    const result = await window.api.inspector.inject()
    if (!result?.success) {
      console.warn('Inspector injection failed:', result?.error)
      return
    }

    const isActive = useTabsStore.getState().getActiveTab()?.inspectorActive ?? false
    if (isActive) {
      const iframe = iframeRef.current
      iframe?.contentWindow?.postMessage({ type: 'inspector:activate' }, '*')  // targetOrigin '*' OK: iframe origin varies (localhost:N); overlay validates e.source
    }
  }, [iframeRef])

  // Clear all persistent highlights in the iframe
  const clearHighlight = useCallback(() => {
    const iframe = iframeRef.current
    iframe?.contentWindow?.postMessage({ type: 'inspector:clearHighlight' }, '*')  // targetOrigin '*' OK: iframe origin varies (localhost:N); overlay validates e.source
    const tab = useTabsStore.getState().getActiveTab()
    if (tab) useTabsStore.getState().updateTab(tab.id, { selectedElements: [] })
  }, [iframeRef])

  return { injectInspector, clearHighlight }
}

/**
 * Paste a minimal element tag into the terminal — inspired by Cursor's chip.
 *
 * Uses a11y-style identification when available:
 *   [slider "Volume"]     — a11y role + name (most descriptive)
 *   [NeonSlider]          — React component name (fallback)
 *   [<div>]               — raw tag (last resort)
 *
 * Full context (file path, props, styles, text, component chain) is stored
 * in window.__inspectorContext and available via canvas_get_context MCP tool.
 */
function pasteContextToTerminal(el: ElementContext): void {
  const tab = useTabsStore.getState().getActiveTab()
  if (!tab?.ptyId) return
  const ptyId = tab.ptyId

  let tag: string
  if (el.a11y?.role && el.a11y?.name) {
    // Semantic: [slider "Volume"] or [button "Submit"]
    const name = el.a11y.name.length > 30 ? el.a11y.name.substring(0, 27) + '...' : el.a11y.name
    tag = `${el.a11y.role} "${name}"`
  } else if (el.componentName && el.componentName !== el.tagName) {
    tag = el.componentName
  } else if (el.a11y?.role) {
    tag = el.a11y.role
  } else {
    tag = `<${el.tagName}>`
  }

  const context = `[${tag}] `
  window.api.pty.write(ptyId, context)
}
