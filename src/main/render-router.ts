import { ipcMain, BrowserWindow } from 'electron'
import { INLINE_MAX_WIDTH, INLINE_MAX_HEIGHT } from '../shared/constants'

export function setupRenderRouter(_getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('render:evaluate', async (_event, html: string, css?: string) => {
    // Create a hidden BrowserWindow to render and measure the component
    const measureWindow = new BrowserWindow({
      show: false,
      width: 800,
      height: 600,
      webPreferences: { offscreen: true }
    })

    const content = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>${css || ''} * { margin: 0; padding: 0; box-sizing: border-box; }</style>
        </head>
        <body>
          <div id="measure">${html}</div>
          <script>
            const el = document.getElementById('measure');
            const rect = el.getBoundingClientRect();
            document.title = JSON.stringify({
              width: Math.ceil(rect.width),
              height: Math.ceil(rect.height)
            });
          </script>
        </body>
      </html>
    `

    await measureWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(content)}`)

    const title = measureWindow.getTitle()
    measureWindow.close()

    try {
      const { width, height } = JSON.parse(title)
      const target =
        width <= INLINE_MAX_WIDTH && height <= INLINE_MAX_HEIGHT ? 'inline' : 'canvas'
      return { target, width, height }
    } catch {
      return { target: 'canvas', width: 0, height: 0 }
    }
  })
}
