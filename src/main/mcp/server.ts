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

// Track per-session server + transport pairs for proper cleanup
const sessions: Record<string, { server: McpServer; transport: StreamableHTTPServerTransport; projectPath: string }> = {}

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
          sessions[id] = { server: sessionServer, transport, projectPath: currentProjectPath || '' }
        }
      })
      transport.onclose = () => {
        const sid = transport.sessionId
        if (sid) {
          delete sessions[sid]
        }
        sessionServer.close().catch(() => {})
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

  return new Promise((resolve) => {
    httpServer = createServer(app)
    httpServer.listen(port, '127.0.0.1', () => {
      console.log(`[MCP] Claude Canvas MCP server on http://127.0.0.1:${port}/mcp`)
      resolve(port)
    })
  })
}

export async function stopMcpServer(): Promise<void> {
  for (const [id, session] of Object.entries(sessions)) {
    await session.transport.close()
    await session.server.close().catch(() => {})
    delete sessions[id]
  }
  if (httpServer) {
    await new Promise<void>((resolve) => httpServer!.close(() => resolve()))
    httpServer = null
  }
  serverPort = null
  cachedGetWindow = null
  currentProjectPath = null
}
