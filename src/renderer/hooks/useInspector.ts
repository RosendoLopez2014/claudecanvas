import { useEffect, useCallback, RefObject } from 'react'
import { useCanvasStore, ElementContext } from '@/stores/canvas'
import { useTerminalStore } from '@/stores/terminal'

export function useInspector(iframeRef: RefObject<HTMLIFrameElement | null>) {
  const { inspectorActive, setSelectedElement } = useCanvasStore()

  // Listen for messages from inspector overlay in iframe
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'inspector:elementSelected') {
        const el = event.data.element as ElementContext
        setSelectedElement(el)
        pasteContextToTerminal(el)
      }
    }

    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [setSelectedElement])

  // Toggle inspector in iframe
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe?.contentWindow) return

    iframe.contentWindow.postMessage(
      { type: inspectorActive ? 'inspector:activate' : 'inspector:deactivate' },
      '*'
    )
  }, [inspectorActive, iframeRef])

  // Inject inspector script into iframe
  const injectInspector = useCallback(() => {
    const iframe = iframeRef.current
    if (!iframe?.contentDocument) return

    // Check if already injected
    if (iframe.contentDocument.getElementById('__claude_inspector__')) return

    const script = iframe.contentDocument.createElement('script')
    script.type = 'module'
    script.src = new URL('../../inspector/overlay.ts', import.meta.url).href
    iframe.contentDocument.head.appendChild(script)
  }, [iframeRef])

  return { injectInspector }
}

function pasteContextToTerminal(element: ElementContext): void {
  const { ptyId } = useTerminalStore.getState()
  if (!ptyId) return

  let contextStr = `\n# Element: <${element.tagName}>`
  if (element.componentName) contextStr += ` (${element.componentName})`
  if (element.filePath) {
    contextStr += `\n# File: ${element.filePath}:${element.lineNumber || ''}`
  }
  if (element.className) {
    contextStr += `\n# Classes: ${element.className}`
  }
  contextStr += '\n'

  window.api.pty.write(ptyId, contextStr)
}
