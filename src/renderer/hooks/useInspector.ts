import { useEffect, useCallback, useRef, RefObject } from 'react'
import { useCanvasStore, ElementContext } from '@/stores/canvas'
import { useTerminalStore } from '@/stores/terminal'
import { useProjectStore } from '@/stores/project'

export function useInspector(iframeRef: RefObject<HTMLIFrameElement | null>) {
  const { inspectorActive, addSelectedElement, clearSelectedElements } = useCanvasStore()
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Listen for messages from inspector overlay in iframe
  useEffect(() => {
    const handler = async (event: MessageEvent) => {
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
        addSelectedElement(el)
        pasteContextToTerminal(el)

        // Inspector stays active — user toggles off manually
        // Auto-focus terminal so user can type immediately
        setTimeout(() => useTerminalStore.getState().focus(), 50)
      }
    }

    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [addSelectedElement])

  // Fade all highlights when files change (HMR edit landed)
  useEffect(() => {
    const cleanup = window.api.fs.onChange((_data: { projectPath: string; path: string }) => {
      const { selectedElements } = useCanvasStore.getState()
      if (selectedElements.length === 0) return

      // Debounce: reset timer on each file change, fade 2s after last change
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
      fadeTimerRef.current = setTimeout(() => {
        fadeTimerRef.current = null
        const iframe = iframeRef.current
        iframe?.contentWindow?.postMessage({ type: 'inspector:fadeHighlight' }, '*')
        clearSelectedElements()
      }, 2000)
    })

    return () => {
      cleanup()
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
    }
  }, [iframeRef, clearSelectedElements])

  // Toggle inspector in iframe via postMessage (works cross-origin)
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe?.contentWindow) return

    iframe.contentWindow.postMessage(
      { type: inspectorActive ? 'inspector:activate' : 'inspector:deactivate' },
      '*'
    )
  }, [inspectorActive, iframeRef])

  // Inject inspector overlay into iframe via main process IPC
  const injectInspector = useCallback(async () => {
    const result = await window.api.inspector.inject()
    if (!result?.success) {
      console.warn('Inspector injection failed:', result?.error)
      return
    }

    const { inspectorActive: isActive } = useCanvasStore.getState()
    if (isActive) {
      const iframe = iframeRef.current
      iframe?.contentWindow?.postMessage({ type: 'inspector:activate' }, '*')
    }
  }, [iframeRef])

  // Clear all persistent highlights in the iframe
  const clearHighlight = useCallback(() => {
    const iframe = iframeRef.current
    iframe?.contentWindow?.postMessage({ type: 'inspector:clearHighlight' }, '*')
    clearSelectedElements()
  }, [iframeRef, clearSelectedElements])

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
  const { ptyId } = useTerminalStore.getState()
  if (!ptyId) return

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
