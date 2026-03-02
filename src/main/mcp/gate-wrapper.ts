import { getRequestContext } from './request-context'
import { isGated, getGateState } from '../critic/gate'
import { GATED_MCP_TOOLS } from '../../shared/constants'

interface McpTextResult {
  content: Array<{ type: 'text'; text: string }>
}

/**
 * Check if a tool is currently blocked by the critic gate.
 * Returns null if allowed, or an error McpTextResult if blocked.
 *
 * FAIL-CLOSED: if the tool is in GATED_MCP_TOOLS and request context
 * is missing (wiring bug), we BLOCK rather than silently allow.
 */
export function assertCriticAllows(toolName: string): McpTextResult | null {
  if (!GATED_MCP_TOOLS.has(toolName)) return null

  const ctx = getRequestContext()

  // Fail-closed: no context for a gated tool → block
  if (!ctx?.projectPath) {
    console.error(`[GATE_CONTEXT_MISSING] Tool "${toolName}" called without MCP request context — blocking`)
    return {
      content: [{
        type: 'text',
        text: [
          `[GATE_CONTEXT_MISSING] Cannot verify critic gate status for "${toolName}".`,
          `This tool requires an MCP request context. If you see this error, the MCP session may need to be restarted.`,
          `Call \`critic_status\` to check gate state.`,
        ].join('\n'),
      }],
    }
  }

  if (!isGated(ctx.projectPath)) return null

  const state = getGateState(ctx.projectPath)
  return {
    content: [{
      type: 'text',
      text: `[GATE_ACTIVE] Gate active. Call \`critic_review_plan\` with your plan before using write/exec tools. Reason: ${state?.reason ?? 'Plan review required'}`,
    }],
  }
}
