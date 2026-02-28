import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { BrowserWindow } from 'electron'
import { resolveDevServerPlan } from '../devserver/resolve'
import { setUserOverride } from '../devserver/config-store'
import { parseCommandString, validateCommand, commandToString } from '../../shared/devserver/types'
import { repairSessions } from '../devserver/repair-session'
import { emitRepairEvent } from '../devserver/repair-events'
import { REPAIR_MAX_FILES, REPAIR_MAX_LOC } from '../../shared/constants'
import type { RepairPhase, RepairTaskPayload } from '../../shared/devserver/repair-types'

/** Agent-reportable phases (only these are valid for canvas_mark_repair_step). */
const AGENT_PHASES: Set<string> = new Set([
  'agent_reading_log',
  'agent_applying_fix',
  'agent_wrote_files',
])

export function registerDevServerTools(
  server: McpServer,
  getWindow: () => BrowserWindow | null,
  getProjectPath: () => string
): void {
  // ── configure_dev_server ──────────────────────────────
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

      const projectPath = getProjectPath()
      if (!projectPath) return { content: [{ type: 'text', text: 'Session not initialized — reopen the tab or press Retry in the boot overlay' }] }
      setUserOverride(projectPath, parsed, port)

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

  // ── canvas_get_repair_task ────────────────────────────
  server.tool(
    'canvas_get_repair_task',
    'Get the current dev server repair task. When the dev server crashes, the self-healing system creates a repair task. Call this to get crash details, the log file path, and instructions for fixing the issue. Returns { pending: false } if no repair is needed. Calling this signals to the repair loop that you have engaged.',
    {},
    async () => {
      const projectPath = getProjectPath()
      const session = projectPath ? repairSessions.get(projectPath) : null

      if (!session) {
        const payload: RepairTaskPayload = { pending: false }
        return { content: [{ type: 'text', text: JSON.stringify(payload) }] }
      }

      // Signal agent engagement if still in a pre-engage phase
      const preEngagePhases = ['crash_detected', 'repair_started', 'awaiting_agent']
      if (preEngagePhases.includes(session.phase)) {
        repairSessions.updatePhase(session.repairId, 'agent_started', 'Agent engaged via canvas_get_repair_task')
        // Emit event so renderer gets notified
        emitRepairEvent(getWindow, {
          sessionId: session.repairId,
          cwd: session.cwd,
          phase: 'agent_started',
          attempt: session.attempt,
          maxAttempts: session.maxAttempts,
          message: 'Claude Code engaged — reading crash details',
          timestamp: Date.now(),
          repairId: session.repairId,
          level: 'info',
        })
      }

      // Build last events summary (last 5)
      const lastEvents = session.stepHistory.slice(-5).map((s) => ({
        phase: s.phase,
        message: s.message,
        ts: s.timestamp,
      }))

      const payload: RepairTaskPayload = {
        pending: true,
        repairId: session.repairId,
        crashLogPath: session.crashLogPath,
        exitCode: session.exitCode,
        attempt: session.attempt + 1,
        maxAttempts: session.maxAttempts,
        phase: session.phase,
        healthUrl: session.healthUrl,
        lastEvents,
        instructions: [
          `1. Read the crash log file: ${session.crashLogPath}`,
          '2. Identify the root cause from the error output',
          '3. Apply a minimal fix to the source code',
          `4. Call canvas_mark_repair_step with repairId="${session.repairId}" and phase="agent_reading_log" when you start reading the log`,
          `5. Call canvas_mark_repair_step with phase="agent_applying_fix" when you start editing files`,
          `6. Call canvas_mark_repair_step with phase="agent_wrote_files" when all fixes are written (include filesChanged and linesChanged counts)`,
          '7. The repair loop will automatically restart the dev server and verify health',
        ],
        safetyLimits: {
          maxFiles: REPAIR_MAX_FILES,
          maxLinesChanged: REPAIR_MAX_LOC,
          noTerminalInjection: true,
          safeMode: true,
        },
      }

      return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] }
    }
  )

  // ── canvas_mark_repair_step ───────────────────────────
  server.tool(
    'canvas_mark_repair_step',
    'Report progress on a dev server repair task. The self-healing loop uses these signals to coordinate restarts. Valid phases: "agent_reading_log" (started reading crash log), "agent_applying_fix" (editing source files), "agent_wrote_files" (all fixes written — triggers restart). For agent_wrote_files, include filesChanged and linesChanged.',
    {
      repairId: z.string().describe('The repairId from canvas_get_repair_task'),
      phase: z.enum(['agent_reading_log', 'agent_applying_fix', 'agent_wrote_files'])
        .describe('Current repair phase'),
      message: z.string().describe('Short description of what was done'),
      filesChanged: z.number().optional().describe('Number of files changed (required for agent_wrote_files)'),
      linesChanged: z.number().optional().describe('Approximate lines changed (required for agent_wrote_files)'),
    },
    async ({ repairId, phase, message, filesChanged, linesChanged }) => {
      // Validate repairId
      const session = repairSessions.getByRepairId(repairId)
      if (!session) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Unknown repairId — repair session may have expired or completed' }) }] }
      }

      // Validate phase is agent-reportable
      if (!AGENT_PHASES.has(phase)) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: `Invalid phase: ${phase}. Use one of: ${[...AGENT_PHASES].join(', ')}` }) }] }
      }

      // Update session (this fires the EventEmitter, unblocking the loop's Promise)
      const updated = repairSessions.updatePhase(
        repairId,
        phase as RepairPhase,
        message,
        { filesChanged, linesChanged },
      )

      if (!updated) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Failed to update repair session' }) }] }
      }

      // Emit IPC event to renderer for live UI updates
      emitRepairEvent(getWindow, {
        sessionId: repairId,
        cwd: session.cwd,
        phase: phase as RepairPhase,
        attempt: session.attempt,
        maxAttempts: session.maxAttempts,
        message,
        timestamp: Date.now(),
        repairId,
        level: 'info',
        detail: { filesChanged, linesChanged },
      })

      // Build response
      let nextStep: string
      if (phase === 'agent_wrote_files') {
        // Safety check
        const fc = filesChanged ?? 0
        const lc = linesChanged ?? 0
        if (fc > REPAIR_MAX_FILES || lc > REPAIR_MAX_LOC) {
          nextStep = `WARNING: Changes exceed safety limits (${fc} files, ~${lc} LOC). The repair loop may escalate to human intervention.`
        } else {
          nextStep = 'Server will restart automatically after a brief quiet period. Do not make further changes.'
        }
      } else if (phase === 'agent_applying_fix') {
        nextStep = 'Continue editing files. Call again with phase="agent_wrote_files" when done.'
      } else {
        nextStep = 'Continue with your repair. Call again with phase="agent_applying_fix" when you start editing.'
      }

      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, phase, nextStep }) }] }
    }
  )

  // ── canvas_get_repair_status ──────────────────────────
  server.tool(
    'canvas_get_repair_status',
    'Get the current status of the self-healing repair loop. Shows whether a repair is in progress, which attempt it is on, and the outcome of recent repairs. Use this to check if the dev server is being auto-repaired after a crash.',
    {},
    async () => {
      const win = getWindow()
      if (!win || win.isDestroyed()) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'No window available' }) }] }
      }

      try {
        const status = await win.webContents.executeJavaScript(
          `window.__canvasState?.repairStatus ?? null`
        )
        if (!status) {
          return { content: [{ type: 'text', text: JSON.stringify({ active: false, message: 'No repair activity' }) }] }
        }
        return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] }
      } catch (err) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: `Failed to read repair status: ${err}` }) }] }
      }
    }
  )

  // ── analyze_dev_server ────────────────────────────────
  server.tool(
    'analyze_dev_server',
    'Analyze the current project and return the auto-detected dev server plan. Shows what command the Start button would use, confidence level, detected framework, and whether verification is needed.',
    {},
    async () => {
      const projectPath = getProjectPath()
      if (!projectPath) return { content: [{ type: 'text', text: 'Session not initialized — reopen the tab or press Retry in the boot overlay' }] }
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
