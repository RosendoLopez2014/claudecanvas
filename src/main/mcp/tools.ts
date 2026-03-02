import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { BrowserWindow } from 'electron'
import { registerCanvasTools } from './canvas-tools'
import { registerSupabaseTools } from './supabase-tools'
import { registerDevServerTools } from './devserver-tools'
import { registerCriticTools } from './critic-tools'

export function registerMcpTools(
  server: McpServer,
  getWindow: () => BrowserWindow | null,
  getProjectPath: () => string
): void {
  registerCanvasTools(server, getWindow, getProjectPath)
  registerSupabaseTools(server, getWindow, getProjectPath)
  registerDevServerTools(server, getWindow, getProjectPath)
  registerCriticTools(server, getWindow, getProjectPath)
}
