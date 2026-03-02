import { AsyncLocalStorage } from 'node:async_hooks'

export interface McpRequestContext {
  sessionId: string
  tabId: string | null
  projectPath: string
}

const requestContext = new AsyncLocalStorage<McpRequestContext>()

export function runWithContext<T>(ctx: McpRequestContext, fn: () => T): T {
  return requestContext.run(ctx, fn)
}

export function getRequestContext(): McpRequestContext | undefined {
  return requestContext.getStore()
}

export function requireRequestContext(): McpRequestContext {
  const ctx = requestContext.getStore()
  if (!ctx) throw new Error('[MCP_CONTEXT_MISSING] No request context — tool called outside request scope')
  return ctx
}
