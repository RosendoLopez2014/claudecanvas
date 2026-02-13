import { useCallback } from 'react'
import { useCanvasStore } from '@/stores/canvas'
import { useWorkspaceStore } from '@/stores/workspace'
import { useFileWatcher } from './useFileWatcher'

interface RenderResult {
  target: 'inline' | 'canvas'
  width: number
  height: number
}

export function useRenderRouter() {
  const { setPreviewUrl } = useCanvasStore()
  const { openCanvas, mode } = useWorkspaceStore()

  const evaluateAndRoute = useCallback(
    async (html: string, css?: string) => {
      const result = (await window.api.render.evaluate(html, css)) as RenderResult

      if (result.target === 'canvas') {
        // For canvas rendering, we'd set a preview URL or render in the canvas iframe
        // In practice, the dev server URL is used for live preview
        if (mode !== 'terminal-canvas') {
          openCanvas()
        }
      }

      return result
    },
    [setPreviewUrl, openCanvas, mode]
  )

  // Watch for file changes and potentially trigger re-renders
  useFileWatcher(
    useCallback(
      (path: string) => {
        // Only care about renderable file types
        if (!path.match(/\.(tsx?|jsx?|css|html|svelte|vue)$/)) return

        // The actual re-render is handled by the dev server's HMR.
        // This hook's role is to detect when NEW components are created
        // and need initial routing (inline vs canvas).
      },
      []
    )
  )

  return { evaluateAndRoute }
}
