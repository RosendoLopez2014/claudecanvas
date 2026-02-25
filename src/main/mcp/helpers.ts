import { BrowserWindow } from 'electron'

export type McpTextResult = { content: [{ type: 'text'; text: string }] }

export function errorResponse(msg: string): McpTextResult {
  return { content: [{ type: 'text', text: msg }] }
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
