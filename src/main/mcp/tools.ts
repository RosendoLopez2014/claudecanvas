import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { BrowserWindow } from 'electron'
import { registerCanvasTools } from './canvas-tools'
import { registerSupabaseTools } from './supabase-tools'
import { registerDevServerTools } from './devserver-tools'

export function registerMcpTools(
  server: McpServer,
  getWindow: () => BrowserWindow | null,
  projectPath: string
): void {
  registerCanvasTools(server, getWindow, projectPath)
  registerSupabaseTools(server, getWindow, projectPath)
  registerDevServerTools(server, getWindow, projectPath)
}
