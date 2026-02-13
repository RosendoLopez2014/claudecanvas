import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import express from 'express'
import { randomUUID } from 'node:crypto'
import { createServer, Server } from 'node:http'
import detectPort from 'detect-port'
import { BrowserWindow } from 'electron'
import { registerMcpTools } from './tools'

let httpServer: Server | null = null
let mcpServer: McpServer | null = null
let serverPort: number | null = null

const transports: Record<string, StreamableHTTPServerTransport> = {}

export function getMcpPort(): number | null {
  return serverPort
}

export async function startMcpServer(getWindow: () => BrowserWindow | null): Promise<number> {
  if (httpServer) return serverPort!

  mcpServer = new McpServer({
    name: 'claude-canvas',
    version: '0.1.0'
  })

  registerMcpTools(mcpServer, getWindow)

  const app = express()
  app.use(express.json())

  // POST /mcp — client-to-server messages
  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    let transport: StreamableHTTPServerTransport

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId]
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports[id] = transport
        }
      })
      transport.onclose = () => {
        const sid = transport.sessionId
        if (sid) delete transports[sid]
      }
      await mcpServer!.connect(transport)
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
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID')
      return
    }
    await transports[sessionId].handleRequest(req, res)
  })

  // DELETE /mcp — session termination
  app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID')
      return
    }
    await transports[sessionId].handleRequest(req, res)
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
  for (const [id, transport] of Object.entries(transports)) {
    await transport.close()
    delete transports[id]
  }
  if (httpServer) {
    await new Promise<void>((resolve) => httpServer!.close(() => resolve()))
    httpServer = null
  }
  if (mcpServer) {
    await mcpServer.close()
    mcpServer = null
  }
  serverPort = null
}
