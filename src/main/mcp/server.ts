import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import express from 'express'
import { randomUUID } from 'node:crypto'
import { createServer, Server } from 'node:http'
import { basename } from 'node:path'
import detectPortModule from 'detect-port'
// detect-port CJS exports .default as the function
const detectPort = (detectPortModule as any).default || detectPortModule
import { BrowserWindow } from 'electron'
import { registerMcpTools } from './tools'

let httpServer: Server | null = null
let serverPort: number | null = null
let startPromise: Promise<number> | null = null

/** MCP session TTL: 30 minutes of inactivity. */
const SESSION_TTL_MS = 30 * 60 * 1000

/** Interval for scanning stale sessions. */
let ttlInterval: ReturnType<typeof setInterval> | null = null

// Track per-session server + transport pairs for proper cleanup
const sessions: Record<string, { server: McpServer; transport: StreamableHTTPServerTransport; projectPath: string; tabId: string | null; token: string | null; lastActivity: number }> = {}

// Token registry: maps per-project token → { tabId, projectPath, createdAt }
// TTL cleanup removes tokens older than 2 hours to prevent edge-case leaks
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000
const tokenRegistry = new Map<string, { tabId: string; projectPath: string; createdAt: number }>()

export function registerSessionToken(token: string, tabId: string, projectPath: string): void {
  tokenRegistry.set(token, { tabId, projectPath, createdAt: Date.now() })
}

export function unregisterSessionToken(token: string): void {
  tokenRegistry.delete(token)
}

export function clearTokenRegistry(): void {
  tokenRegistry.clear()
}

export function getMcpPort(): number | null {
  return serverPort
}

// Cached reference for tool registration
let cachedGetWindow: (() => BrowserWindow | null) | null = null

export async function startMcpServer(getWindow: () => BrowserWindow | null, projectPath?: string): Promise<number> {
  if (serverPort) return serverPort
  if (startPromise) return startPromise
  startPromise = doStartMcpServer(getWindow, projectPath).finally(() => { startPromise = null })
  return startPromise
}

async function doStartMcpServer(getWindow: () => BrowserWindow | null, projectPath?: string): Promise<number> {
  if (httpServer) return serverPort!

  cachedGetWindow = getWindow

  const app = express()
  app.use(express.json())

  // POST /mcp — client-to-server messages
  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    let transport: StreamableHTTPServerTransport

    if (sessionId && sessions[sessionId]) {
      sessions[sessionId].lastActivity = Date.now()
      transport = sessions[sessionId].transport
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // Parse token from URL query parameter (safe URL parsing, not req.query)
      const parsedUrl = new URL(req.url!, `http://${req.headers.host}`)
      const token = parsedUrl.searchParams.get('token') || undefined
      const tokenData = token ? tokenRegistry.get(token) : null

      if (!tokenData) {
        const remoteAddr = req.socket.remoteAddress || 'unknown'
        console.warn(`[MCP] Invalid token prefix=${token ? token.slice(0, 4) + '…' : '(none)'} from ${remoteAddr}`)
        const msg = token
          ? 'Session token expired or invalid — reopen the tab to get a new token'
          : 'Missing session token — MCP connection requires a valid token'
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: msg },
          id: null
        })
        return
      }

      const sessionProjectPath = tokenData.projectPath
      const sessionTabId = tokenData.tabId

      // Create a fresh McpServer per session — the SDK requires
      // a separate Protocol instance per connection
      const sessionServer = new McpServer({
        name: 'claude-canvas',
        version: '0.1.0'
      })

      // Pre-generate session ID for O(1) getProjectPath closure
      const preSessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

      // CRITICAL: O(1) getter — captures preSessionId in closure, reads sessions[preSessionId] directly
      const getProjectPath = (): string => {
        const s = sessions[preSessionId]
        if (s) return s.projectPath
        console.warn(`[MCP] Tool call with dead session: id=${preSessionId.slice(0, 12)}… tabId=${sessionTabId}`)
        return '' // empty string → tool returns "Session not initialized" error
      }
      registerMcpTools(sessionServer, getWindow, getProjectPath)

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => preSessionId,
        onsessioninitialized: (id) => {
          console.log(`[MCP] Session created: id=${id.slice(0, 12)}… tabId=${sessionTabId} project=${basename(sessionProjectPath)} token=${token?.slice(0, 4) ?? 'none'}…`)
          sessions[id] = { server: sessionServer, transport, projectPath: sessionProjectPath, tabId: sessionTabId, token: token || null, lastActivity: Date.now() }
        }
      })
      transport.onclose = () => {
        const sid = transport.sessionId
        if (sid && sessions[sid]) {
          delete sessions[sid]
          // Don't call sessionServer.close() here — it triggers
          // transport.close() which re-fires onclose (infinite loop)
        }
      }
      await sessionServer.connect(transport)
    } else {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: no valid session' },
        id: null
      })
      return
    }
    await transport.handleRequest(req, res, req.body)
  })

  // GET /mcp — SSE stream for server-to-client notifications
  app.get('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    if (!sessionId || !sessions[sessionId]) {
      res.status(400).send('Invalid or missing session ID')
      return
    }
    sessions[sessionId].lastActivity = Date.now()
    await sessions[sessionId].transport.handleRequest(req, res)
  })

  // DELETE /mcp — session termination
  app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    if (!sessionId || !sessions[sessionId]) {
      res.status(400).send('Invalid or missing session ID')
      return
    }
    await sessions[sessionId].transport.handleRequest(req, res)
  })

  const port = await detectPort(9315)
  serverPort = port

  // Start TTL reaper — clean up stale sessions + expired tokens every 5 minutes
  ttlInterval = setInterval(() => {
    const now = Date.now()
    // Reap stale MCP sessions
    for (const [id, session] of Object.entries(sessions)) {
      if (now - session.lastActivity > SESSION_TTL_MS) {
        console.log(`[MCP] Reaping stale session ${id} (idle ${Math.round((now - session.lastActivity) / 1000)}s)`)
        delete sessions[id]
        session.server.close().catch((e: Error) => console.warn('[mcp] stale session close:', e.message))
      }
    }
    // Reap expired tokens (defense-in-depth: prevents leaks if close callbacks don't fire)
    for (const [token, data] of tokenRegistry) {
      if (now - data.createdAt > TOKEN_TTL_MS) {
        console.log(`[MCP] Reaping expired token ${token.slice(0, 4)}… (age ${Math.round((now - data.createdAt) / 60000)}min)`)
        tokenRegistry.delete(token)
      }
    }
  }, 5 * 60 * 1000)

  return new Promise((resolve) => {
    httpServer = createServer(app)
    httpServer.listen(port, '127.0.0.1', () => {
      console.log(`[MCP] Claude Canvas MCP server on http://127.0.0.1:${port}/mcp`)
      resolve(port)
    })
  })
}

export async function stopMcpServer(): Promise<void> {
  if (ttlInterval) {
    clearInterval(ttlInterval)
    ttlInterval = null
  }
  for (const [id, session] of Object.entries(sessions)) {
    delete sessions[id]
    // Close server first (which closes transport internally), then
    // the onclose handler is a no-op since we already deleted the session
    await session.server.close().catch((e: Error) => console.warn('[mcp] server close:', e.message))
  }
  tokenRegistry.clear()
  if (httpServer) {
    await new Promise<void>((resolve) => httpServer!.close(() => resolve()))
    httpServer = null
  }
  serverPort = null
  cachedGetWindow = null
}
