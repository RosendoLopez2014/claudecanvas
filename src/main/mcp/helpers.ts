import { BrowserWindow } from 'electron'

export type McpTextResult = { content: [{ type: 'text'; text: string }] }

export function errorResponse(msg: string): McpTextResult {
  return { content: [{ type: 'text', text: msg }] }
}

/** Execute JavaScript in the renderer with a timeout to prevent indefinite hangs. */
export async function executeWithTimeout<T>(
  win: BrowserWindow,
  code: string,
  timeoutMs = 5000
): Promise<T> {
  return Promise.race([
    win.webContents.executeJavaScript(code) as Promise<T>,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Renderer did not respond within timeout')), timeoutMs)
    ),
  ])
}

/** Common helper: get window or return an error result. */
export function requireWindow(
  getWindow: () => BrowserWindow | null
): BrowserWindow | McpTextResult {
  const win = getWindow()
  if (!win) return errorResponse('Error: No window available')
  return win
}

export function isWindowError(
  result: BrowserWindow | McpTextResult
): result is McpTextResult {
  return !(result instanceof BrowserWindow)
}
