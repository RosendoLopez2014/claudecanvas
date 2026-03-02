import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { spawn } from 'node:child_process'
import { BrowserWindow } from 'electron'
import { startPlanReview, startResultReview, getActiveRun } from '../critic/engine'
import { engageGate, releaseGate, getGateState, isGated } from '../critic/gate'
import { getCriticConfig } from '../critic/config-store'
import { collectDiagnostics } from '../critic/diagnostics'
import { formatFeedbackForClaude } from '../../shared/critic/format'
import { getRequestContext } from './request-context'
import { errorResponse } from './helpers'
import { CRITIC_MAX_DIFF_SIZE } from '../../shared/constants'

/** Async git diff with byte cap (never blocks main thread) */
function asyncGitDiff(cwd: string, maxBytes: number): Promise<string> {
  return new Promise((resolve) => {
    let output = ''
    const proc = spawn('git', ['diff', 'HEAD', '--no-color', '--patch', '--minimal'], {
      cwd, timeout: 15_000,
    })
    proc.stdout?.on('data', (chunk: Buffer) => {
      if (output.length < maxBytes) output += chunk.toString()
    })
    proc.stderr?.on('data', (chunk: Buffer) => {
      if (output.length < maxBytes) output += chunk.toString()
    })
    proc.on('close', () => resolve(output.trim()))
    proc.on('error', () => resolve(''))
  })
}

export function registerCriticTools(
  server: McpServer,
  getWindow: () => BrowserWindow | null,
  getProjectPath: () => string,
): void {

  // ── critic_review_plan ──────────────────────────────────
  server.tool(
    'critic_review_plan',
    'Submit your implementation plan for critic review BEFORE writing any code. The critic will analyze it and return structured feedback with verdict (approve/revise/reject). Write/execute tools are BLOCKED until the critic approves.',
    {
      plan: z.string().describe('The full implementation plan text'),
      context: z.string().optional().describe('Additional project context'),
    },
    async ({ plan, context }) => {
      const projectPath = getProjectPath()
      if (!projectPath) return errorResponse('[MCP_CONTEXT_MISSING] Session not initialized')

      const ctx = getRequestContext()
      const tabId = ctx?.tabId ?? 'unknown'
      const config = getCriticConfig(projectPath)

      if (!config.enabled) {
        return { content: [{ type: 'text' as const, text: '[CRITIC_DISABLED] Critic is disabled for this project. Enable it in the Critic panel settings.' }] }
      }

      // Engage gate BEFORE sending to critic
      await engageGate(getWindow, projectPath, tabId, 'Plan submitted for critic review')

      try {
        const feedback = await startPlanReview(
          getWindow, tabId, projectPath, plan,
          context ?? `Project: ${projectPath}`,
        )
        const formatted = formatFeedbackForClaude(feedback, 'plan')

        // Both modes: release gate on plan approval
        if (feedback.verdict === 'approve') {
          await releaseGate(getWindow, projectPath, 'Critic approved the plan', 'critic_approve')
        }

        return {
          content: [{
            type: 'text' as const,
            text: formatted + '\n---\n' + (feedback.verdict === 'approve'
              ? 'Gate released. You may proceed with implementation.'
              : 'The gate remains active. Address the issues and re-submit, or call `critic_override` to proceed anyway.'),
          }],
        }
      } catch (err) {
        // Release gate on error so Claude isn't stuck
        await releaseGate(getWindow, projectPath, 'Critic API error — gate released', 'error')
        return errorResponse(`Critic review failed: ${(err as Error).message}`)
      }
    },
  )

  // ── critic_review_result ────────────────────────────────
  server.tool(
    'critic_review_result',
    'Submit implementation results for critic review. Automatically collects git diff and runs diagnostics (tsc, tests). Call this AFTER completing a batch of changes. In strict mode, write/execute tools are blocked until the critic approves.',
    {
      context: z.string().optional().describe('Additional context about what was implemented'),
    },
    async ({ context }) => {
      const projectPath = getProjectPath()
      if (!projectPath) return errorResponse('[MCP_CONTEXT_MISSING] Session not initialized')

      const ctx = getRequestContext()
      const tabId = ctx?.tabId ?? 'unknown'
      const config = getCriticConfig(projectPath)

      if (!config.enabled) {
        return { content: [{ type: 'text' as const, text: '[CRITIC_DISABLED] Critic is disabled.' }] }
      }

      // Strict B: re-engage gate for result review
      if (config.gateMode === 'strict') {
        await engageGate(getWindow, projectPath, tabId, 'Result submitted for critic review')
      }

      try {
        const diagnostics = await collectDiagnostics(projectPath)
        const gitDiff = await asyncGitDiff(projectPath, CRITIC_MAX_DIFF_SIZE)

        const feedback = await startResultReview(
          getWindow, tabId, projectPath, gitDiff, diagnostics,
          context ?? `Project: ${projectPath}`,
        )
        const formatted = formatFeedbackForClaude(feedback, 'result')

        // Both modes: release gate on result approval
        if (feedback.verdict === 'approve') {
          await releaseGate(getWindow, projectPath, 'Critic approved the implementation', 'critic_approve')
        }

        return {
          content: [{
            type: 'text' as const,
            text: formatted + '\n---\n' + (feedback.verdict === 'approve'
              ? 'Implementation approved. Gate released.'
              : config.gateMode === 'strict'
                ? 'Gate remains active. Address the issues and call `critic_review_result` again.'
                : 'Please address the issues above and continue.'),
          }],
        }
      } catch (err) {
        if (config.gateMode === 'strict') {
          await releaseGate(getWindow, projectPath, 'Critic API error — gate released', 'error')
        }
        return errorResponse(`Result review failed: ${(err as Error).message}`)
      }
    },
  )

  // ── critic_status ───────────────────────────────────────
  server.tool(
    'critic_status',
    'Check the current critic gate status, active run information, and instructions. Call this to understand whether write/execute tools are currently blocked and what to do next.',
    {},
    async () => {
      const projectPath = getProjectPath()
      if (!projectPath) return errorResponse('[MCP_CONTEXT_MISSING] Session not initialized')

      const ctx = getRequestContext()
      const tabId = ctx?.tabId ?? 'unknown'
      const config = getCriticConfig(projectPath)
      const gateState = getGateState(projectPath)
      const activeRun = getActiveRun(tabId)

      const lines: string[] = [
        `Critic enabled: ${config.enabled}`,
        `Gate mode: ${config.gateMode}`,
        `Gate status: ${gateState?.status ?? 'open'}`,
      ]

      if (gateState?.status === 'gated') {
        lines.push(`Gate reason: ${gateState.reason}`)
        lines.push('', 'Write/execute tools are BLOCKED. Submit a plan via `critic_review_plan` or override via `critic_override`.')
      } else if (gateState?.status === 'overridden') {
        lines.push(`Overridden by: ${gateState.overriddenBy}`)
        lines.push('', 'Gate was overridden. Write/execute tools are available.')
      }

      if (activeRun) {
        lines.push('', `Active run: ${activeRun.runId} (iteration ${activeRun.iteration}/${activeRun.maxIterations})`)
        lines.push(`Phase: ${activeRun.phase}`)
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] }
    },
  )

  // ── critic_override ─────────────────────────────────────
  server.tool(
    'critic_override',
    'Override the critic gate to proceed without approval. Use only when the gate is blocking necessary work and you have a valid reason. The override will be logged.',
    {
      reason: z.string().describe('Why you need to override the gate'),
    },
    async ({ reason }) => {
      const projectPath = getProjectPath()
      if (!projectPath) return errorResponse('[MCP_CONTEXT_MISSING] Session not initialized')

      if (!isGated(projectPath)) {
        return { content: [{ type: 'text' as const, text: 'Gate is not active — no override needed.' }] }
      }

      await releaseGate(getWindow, projectPath, `Override: ${reason}`, 'user')

      return {
        content: [{ type: 'text' as const, text: `Gate overridden. Reason logged: ${reason}\nWrite/execute tools are now available.` }],
      }
    },
  )
}
