import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { BrowserWindow } from 'electron'
import { resolveDevServerPlan } from '../devserver/resolve'
import { setUserOverride } from '../devserver/config-store'
import { parseCommandString, validateCommand, commandToString } from '../../shared/devserver/types'

export function registerDevServerTools(
  server: McpServer,
  getWindow: () => BrowserWindow | null,
  projectPath: string
): void {
  server.tool(
    'configure_dev_server',
    'Configure the dev server start command for the current project. Validates the command against the allowlist (only npm/pnpm/yarn/bun/node are permitted). If valid, saves it as the preferred command and updates the Start button immediately.',
    {
      command: z.string().describe('Full command (e.g., "npm run dev", "bun dev", "pnpm start:dev")'),
      port: z.number().optional().describe('Expected dev server port (e.g., 3000, 5173)'),
      reason: z.string().optional().describe('Why this command was chosen'),
    },
    async ({ command, port, reason }) => {
      const parsed = parseCommandString(command)
      if (!parsed) {
        return { content: [{ type: 'text', text: `Invalid command: "${command}". Only npm, pnpm, yarn, bun, node, npx binaries are allowed. Shell operators (;|&><$) are forbidden.` }] }
      }

      const validation = validateCommand(parsed)
      if (!validation.ok) {
        return { content: [{ type: 'text', text: `Command rejected: ${validation.error}` }] }
      }

      setUserOverride(projectPath, parsed, port)

      // Notify renderer to update the start button
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('mcp:notify', {
          projectPath,
          message: `Dev command configured: ${command}${reason ? ` (${reason})` : ''}`,
          type: 'success',
        })
      }

      return { content: [{ type: 'text', text: `Configured: ${command}${port ? ` (port ${port})` : ''}. The Start button is now ready.` }] }
    }
  )

  server.tool(
    'analyze_dev_server',
    'Analyze the current project and return the auto-detected dev server plan. Shows what command the Start button would use, confidence level, detected framework, and whether verification is needed.',
    {},
    async () => {
      const plan = resolveDevServerPlan(projectPath)
      const summary = {
        command: commandToString(plan.command),
        cwd: plan.cwd,
        manager: plan.manager,
        port: plan.port,
        confidence: plan.confidence,
        framework: plan.detection.framework || 'unknown',
        reasons: plan.reasons,
        usedLastKnownGood: plan.detection.usedLastKnownGood || false,
      }
      return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] }
    }
  )
}
