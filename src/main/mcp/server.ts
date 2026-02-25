import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import express from 'express'
import { randomUUID } from 'node:crypto'
import { createServer, Server } from 'node:http'
import detectPortModule from 'detect-port'
// detect-port CJS exports .default as the function
const detectPort = (detectPortModule as any).default || detectPortModule
import { BrowserWindow } from 'electron'
import { registerMcpTools } from './tools'

let httpServer: Server | null = null
let serverPort: number | null = null

/** MCP session TTL: 30 minutes of inactivity. */
const SESSION_TTL_MS = 30 * 60 * 1000

/** Interval for scanning stale sessions. */
let ttlInterval: ReturnType<typeof setInterval> | null = null

// Track per-session server + transport pairs for proper cleanup
const sessions: Record<string, { server: McpServer; transport: StreamableHTTPServerTransport; projectPath: string; lastActivity: number }> = {}

// The projectPath of the most recently opened project
let currentProjectPath: string | null = null

export function getMcpPort(): number | null {
  return serverPort
}

// Cached reference for tool registration
let cachedGetWindow: (() => BrowserWindow | null) | null = null

export async function startMcpServer(getWindow: () => BrowserWindow | null, projectPath?: string): Promise<number> {
  if (projectPath) currentProjectPath = projectPath
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
      // Create a fresh McpServer per session — the SDK requires
      // a separate Protocol instance per connection
      const sessionServer = new McpServer({
        name: 'claude-canvas',
        version: '0.1.0'
      })
      registerMcpTools(sessionServer, getWindow, currentProjectPath || '')

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          console.log(`[MCP] New session ${id.slice(0, 8)} for project: ${currentProjectPath}`)
          sessions[id] = { server: sessionServer, transport, projectPath: currentProjectPath || '', lastActivity: Date.now() }
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

  // Start TTL reaper — clean up stale sessions every 5 minutes
  ttlInterval = setInterval(() => {
    const now = Date.now()
    for (const [id, session] of Object.entries(sessions)) {
      if (now - session.lastActivity > SESSION_TTL_MS) {
        console.log(`[MCP] Reaping stale session ${id} (idle ${Math.round((now - session.lastActivity) / 1000)}s)`)
        delete sessions[id]
        session.server.close().catch((e: Error) => console.warn('[mcp] stale session close:', e.message))
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
  if (httpServer) {
    await new Promise<void>((resolve) => httpServer!.close(() => resolve()))
    httpServer = null
  }
  serverPort = null
  cachedGetWindow = null
  currentProjectPath = null
}
