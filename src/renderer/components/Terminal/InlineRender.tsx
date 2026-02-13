import { Terminal, IDecoration } from '@xterm/xterm'
import { useCallback, useRef } from 'react'

export interface InlineRenderOptions {
  html: string
  css?: string
  width: number
  height: number
}

export function useInlineRender(terminal: Terminal | null) {
  const decorationsRef = useRef<IDecoration[]>([])

  const renderInline = useCallback(
    (options: InlineRenderOptions) => {
      if (!terminal) return

      const { html, css, width, height } = options

      // Calculate how many terminal rows this needs
      const charHeight = Math.ceil(terminal.options.fontSize! * (terminal.options.lineHeight || 1.4))
      const rows = Math.ceil(height / charHeight) + 1

      // Write blank lines to make room for the decoration
      for (let i = 0; i < rows; i++) {
        terminal.write('\r\n')
      }

      // Place decoration at current cursor position minus the rows we just added
      const marker = terminal.registerMarker(-(rows - 1))
      if (!marker) return

      const decoration = terminal.registerDecoration({
        marker,
        width: Math.ceil(width / 8) + 2, // approximate char width
        height: rows
      })

      if (!decoration) return

      decoration.onRender((element) => {
        // Only set up once
        if (element.querySelector('iframe')) return

        element.style.overflow = 'hidden'
        element.style.zIndex = '1'

        const iframe = document.createElement('iframe')
        iframe.style.width = `${width}px`
        iframe.style.height = `${height}px`
        iframe.style.border = '1px solid rgba(74, 234, 255, 0.2)'
        iframe.style.borderRadius = '4px'
        iframe.style.background = 'white'
        iframe.sandbox.add('allow-same-origin')

        iframe.srcdoc = `
          <!DOCTYPE html>
          <html>
            <head>
              <style>
                body { margin: 0; padding: 8px; font-family: system-ui, sans-serif; }
                ${css || ''}
              </style>
            </head>
            <body>${html}</body>
          </html>
        `

        element.appendChild(iframe)
      })

      decorationsRef.current.push(decoration)
    },
    [terminal]
  )

  const clearInlineRenders = useCallback(() => {
    decorationsRef.current.forEach((d) => d.dispose())
    decorationsRef.current = []
  }, [])

  return { renderInline, clearInlineRenders }
}
