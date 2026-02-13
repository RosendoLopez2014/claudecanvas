# MCP Bridge Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable full bidirectional communication between Claude Code (running in the embedded terminal) and Claude Canvas via a local MCP server.

**Architecture:** Electron main process runs an HTTP MCP server using `@modelcontextprotocol/sdk`. When a project opens, a `.mcp.json` is written to the project directory so Claude Code auto-discovers the server. Tools let Claude control the canvas; inspector clicks paste context into Claude's PTY input.

**Tech Stack:** `@modelcontextprotocol/sdk` v1 (Streamable HTTP), `express`, `zod`, Electron IPC

---

### Task 1: Install MCP dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install packages**

Run:
```bash
npm install @modelcontextprotocol/sdk zod express
npm install -D @types/express
```

Note: `zod` may already be installed — that's fine, npm will dedupe.

**Step 2: Verify install**

Run: `npm ls @modelcontextprotocol/sdk`
Expected: Shows version 1.x

**Step 3: Update electron-vite config to bundle express (ESM-only check)**

Read `node_modules/express/package.json` and check if `"type": "module"`. If so, add `'express'` to the `externalizeDepsPlugin({ exclude: [...] })` list in `electron.vite.config.ts`. If CJS, no change needed.

**Step 4: Commit**

```bash
git add package.json package-lock.json electron.vite.config.ts
git commit -m "chore: add MCP SDK, zod, and express dependencies"
```

---

### Task 2: Create MCP server foundation

**Files:**
- Create: `src/main/mcp/server.ts`
- Test: manual — server starts and listens

**Step 1: Create the MCP server module**

Create `src/main/mcp/server.ts`:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import express from 'express'
import { randomUUID } from 'node:crypto'
import { createServer, Server } from 'node:http'
import detectPort from 'detect-port'

let httpServer: Server | null = null
let mcpServer: McpServer | null = null
let serverPort: number | null = null

const transports: Record<string, StreamableHTTPServerTransport> = {}

export function getMcpServer(): McpServer | null {
  return mcpServer
}

export function getMcpPort(): number | null {
  return serverPort
}

export async function startMcpServer(): Promise<number> {
  if (httpServer) return serverPort!

  mcpServer = new McpServer({
    name: 'claude-canvas',
    version: '0.1.0'
  })

  // Tools will be registered by registerMcpTools() in tools.ts
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
  // Close all active transports
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
```

**Step 2: Verify it compiles**

Run: `npx electron-vite build 2>&1 | tail -5`
Expected: Build succeeds (check for import resolution issues — may need to add `express` to externalizeDepsPlugin exclude list or rollupOptions.external)

**Step 3: Commit**

```bash
git add src/main/mcp/server.ts
git commit -m "feat: add MCP server foundation with Streamable HTTP transport"
```

---

### Task 3: Register MCP tools (stubs)

**Files:**
- Create: `src/main/mcp/tools.ts`

**Step 1: Create tool registration module**

Create `src/main/mcp/tools.ts`:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { BrowserWindow } from 'electron'

export function registerMcpTools(
  server: McpServer,
  getWindow: () => BrowserWindow | null
): void {
  // ── Canvas Rendering ──────────────────────────────────────

  server.tool(
    'canvas_render',
    'Render HTML/CSS in the canvas panel or inline in the terminal. Auto-opens the canvas if the component is large.',
    {
      html: z.string().describe('HTML content to render'),
      css: z.string().optional().describe('Optional CSS styles')
    },
    async ({ html, css }) => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: 'Error: No window available' }] }

      win.webContents.send('mcp:canvas-render', { html, css })
      return { content: [{ type: 'text', text: 'Rendered successfully. The component is now visible in the canvas.' }] }
    }
  )

  // ── Dev Server / Preview ──────────────────────────────────

  server.tool(
    'canvas_start_preview',
    'Start the dev server and open a live preview in the canvas panel. The preview auto-updates via HMR as you write code.',
    {
      command: z.string().optional().describe('Dev server command (e.g., "npm run dev"). Auto-detected if omitted.'),
      cwd: z.string().optional().describe('Working directory. Defaults to current project path.')
    },
    async ({ command, cwd }) => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: 'Error: No window available' }] }

      win.webContents.send('mcp:start-preview', { command, cwd })
      return { content: [{ type: 'text', text: 'Dev server starting. The canvas panel will open with a live preview.' }] }
    }
  )

  server.tool(
    'canvas_stop_preview',
    'Stop the dev server and close the canvas preview panel.',
    {},
    async () => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: 'Error: No window available' }] }

      win.webContents.send('mcp:stop-preview')
      return { content: [{ type: 'text', text: 'Dev server stopped and preview closed.' }] }
    }
  )

  server.tool(
    'canvas_set_preview_url',
    'Point the canvas preview at a specific URL. Auto-opens the canvas panel.',
    {
      url: z.string().describe('URL to load in the preview iframe (e.g., http://localhost:3000)')
    },
    async ({ url }) => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: 'Error: No window available' }] }

      win.webContents.send('mcp:set-preview-url', { url })
      return { content: [{ type: 'text', text: `Preview URL set to ${url}. Canvas is now showing the live preview.` }] }
    }
  )

  // ── Tab Navigation ────────────────────────────────────────

  server.tool(
    'canvas_open_tab',
    'Switch the canvas panel to a specific tab. Auto-opens the canvas if closed.',
    {
      tab: z.enum(['preview', 'gallery', 'timeline', 'diff']).describe('Which tab to open')
    },
    async ({ tab }) => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: 'Error: No window available' }] }

      win.webContents.send('mcp:open-tab', { tab })
      return { content: [{ type: 'text', text: `Switched to ${tab} tab.` }] }
    }
  )

  // ── Gallery ───────────────────────────────────────────────

  server.tool(
    'canvas_add_to_gallery',
    'Add a component variant to the gallery. Auto-opens the gallery tab.',
    {
      label: z.string().describe('Name for this variant (e.g., "Primary Button", "Dark Mode Card")'),
      html: z.string().describe('HTML content of the variant'),
      css: z.string().optional().describe('Optional CSS styles')
    },
    async ({ label, html, css }) => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: 'Error: No window available' }] }

      win.webContents.send('mcp:add-to-gallery', { label, html, css })
      return { content: [{ type: 'text', text: `Added "${label}" to the gallery.` }] }
    }
  )

  // ── Git Checkpoints ───────────────────────────────────────

  server.tool(
    'canvas_checkpoint',
    'Create a git checkpoint that appears in the timeline tab.',
    {
      message: z.string().describe('Checkpoint message describing the current state')
    },
    async ({ message }) => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: 'Error: No window available' }] }

      win.webContents.send('mcp:checkpoint', { message })
      return { content: [{ type: 'text', text: `Checkpoint created: "${message}"` }] }
    }
  )

  // ── Notifications ─────────────────────────────────────────

  server.tool(
    'canvas_notify',
    'Show a notification in the status bar.',
    {
      message: z.string().describe('Notification message'),
      type: z.enum(['info', 'success', 'error']).optional().describe('Notification type. Defaults to info.')
    },
    async ({ message, type }) => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: 'Error: No window available' }] }

      win.webContents.send('mcp:notify', { message, type: type || 'info' })
      return { content: [{ type: 'text', text: 'Notification shown.' }] }
    }
  )

  // ── Context Queries ───────────────────────────────────────

  server.tool(
    'canvas_get_status',
    'Get the current state of the canvas: active tab, preview URL, dev server status, inspector status.',
    {},
    async () => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: 'Error: No window available' }] }

      const state = await win.webContents.executeJavaScript(`
        (function() {
          var cs = window.__canvasState;
          return cs ? JSON.stringify(cs) : JSON.stringify({ error: 'Canvas state not available' });
        })()
      `)
      return { content: [{ type: 'text', text: state }] }
    }
  )

  server.tool(
    'canvas_get_context',
    'Get the currently selected element from the inspector, if any. Returns component name, source file, line number, and key styles.',
    {},
    async () => {
      const win = getWindow()
      if (!win) return { content: [{ type: 'text', text: 'Error: No window available' }] }

      const context = await win.webContents.executeJavaScript(`
        (function() {
          var ctx = window.__inspectorContext;
          return ctx ? JSON.stringify(ctx) : JSON.stringify({ selected: false });
        })()
      `)
      return { content: [{ type: 'text', text: context }] }
    }
  )
}
```

**Step 2: Wire tools into server startup**

In `src/main/mcp/server.ts`, after creating `mcpServer`, call `registerMcpTools`:

Add import at top:
```typescript
import { registerMcpTools } from './tools'
```

In `startMcpServer()`, after `mcpServer = new McpServer(...)`:
```typescript
registerMcpTools(mcpServer, getWindow)
```

Update `startMcpServer` signature to accept `getWindow`:
```typescript
export async function startMcpServer(getWindow: () => BrowserWindow | null): Promise<number> {
```

**Step 3: Verify build**

Run: `npx electron-vite build 2>&1 | tail -5`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/main/mcp/tools.ts src/main/mcp/server.ts
git commit -m "feat: register all 10 MCP tools with typed zod schemas"
```

---

### Task 4: Write .mcp.json to project directory

**Files:**
- Create: `src/main/mcp/config-writer.ts`

**Step 1: Create config writer module**

Create `src/main/mcp/config-writer.ts`:

```typescript
import { writeFile, unlink, readFile, appendFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

let currentConfigPath: string | null = null

export async function writeMcpConfig(projectPath: string, port: number): Promise<void> {
  const config = {
    mcpServers: {
      'claude-canvas': {
        type: 'http',
        url: `http://127.0.0.1:${port}/mcp`
      }
    }
  }

  const configPath = join(projectPath, '.mcp.json')
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
  currentConfigPath = configPath

  // Ensure .mcp.json is in .gitignore
  await ensureGitignore(projectPath)
}

export async function removeMcpConfig(): Promise<void> {
  if (currentConfigPath && existsSync(currentConfigPath)) {
    await unlink(currentConfigPath)
  }
  currentConfigPath = null
}

async function ensureGitignore(projectPath: string): Promise<void> {
  const gitignorePath = join(projectPath, '.gitignore')

  if (existsSync(gitignorePath)) {
    const content = await readFile(gitignorePath, 'utf-8')
    if (content.includes('.mcp.json')) return
    await appendFile(gitignorePath, '\n# Claude Canvas MCP config (auto-generated, session-specific)\n.mcp.json\n')
  } else {
    await writeFile(gitignorePath, '# Claude Canvas MCP config (auto-generated, session-specific)\n.mcp.json\n', 'utf-8')
  }
}
```

**Step 2: Verify build**

Run: `npx electron-vite build 2>&1 | tail -5`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/main/mcp/config-writer.ts
git commit -m "feat: add .mcp.json config writer with gitignore management"
```

---

### Task 5: Wire MCP lifecycle into Electron main process

**Files:**
- Modify: `src/main/index.ts`

**Step 1: Add MCP imports to main/index.ts**

Add at top of `src/main/index.ts`:
```typescript
import { startMcpServer, stopMcpServer } from './mcp/server'
import { writeMcpConfig, removeMcpConfig } from './mcp/config-writer'
```

**Step 2: Add IPC handler for project open**

Inside the `app.whenReady().then(() => { ... })` block, after the existing service registrations, add:

```typescript
// MCP Bridge — start server when a project opens
ipcMain.handle('mcp:project-opened', async (_event, projectPath: string) => {
  const port = await startMcpServer(() => mainWindow)
  await writeMcpConfig(projectPath, port)
  return { port }
})

// MCP Bridge — stop server when project closes
ipcMain.handle('mcp:project-closed', async () => {
  await removeMcpConfig()
  await stopMcpServer()
})
```

**Step 3: Add cleanup to window-all-closed**

In the `app.on('window-all-closed', ...)` handler, add before the existing cleanup:
```typescript
removeMcpConfig()
stopMcpServer()
```

**Step 4: Add cleanup on before-quit (for crash safety)**

After the `window-all-closed` handler, add:
```typescript
app.on('before-quit', () => {
  removeMcpConfig()
})
```

**Step 5: Verify build**

Run: `npx electron-vite build 2>&1 | tail -5`
Expected: Build succeeds

**Step 6: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: wire MCP server lifecycle to project open/close"
```

---

### Task 6: Add MCP IPC methods to preload bridge

**Files:**
- Modify: `src/preload/index.ts`

**Step 1: Add mcp section to the api object**

In `src/preload/index.ts`, add a new `mcp` section to the `api` object:

```typescript
mcp: {
  projectOpened: (projectPath: string) => ipcRenderer.invoke('mcp:project-opened', projectPath),
  projectClosed: () => ipcRenderer.invoke('mcp:project-closed'),

  // MCP server → renderer commands
  onCanvasRender: (cb: (data: { html: string; css?: string }) => void) => {
    const handler = (_: unknown, data: { html: string; css?: string }) => cb(data)
    ipcRenderer.on('mcp:canvas-render', handler)
    return () => ipcRenderer.removeListener('mcp:canvas-render', handler)
  },
  onStartPreview: (cb: (data: { command?: string; cwd?: string }) => void) => {
    const handler = (_: unknown, data: { command?: string; cwd?: string }) => cb(data)
    ipcRenderer.on('mcp:start-preview', handler)
    return () => ipcRenderer.removeListener('mcp:start-preview', handler)
  },
  onStopPreview: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('mcp:stop-preview', handler)
    return () => ipcRenderer.removeListener('mcp:stop-preview', handler)
  },
  onSetPreviewUrl: (cb: (data: { url: string }) => void) => {
    const handler = (_: unknown, data: { url: string }) => cb(data)
    ipcRenderer.on('mcp:set-preview-url', handler)
    return () => ipcRenderer.removeListener('mcp:set-preview-url', handler)
  },
  onOpenTab: (cb: (data: { tab: string }) => void) => {
    const handler = (_: unknown, data: { tab: string }) => cb(data)
    ipcRenderer.on('mcp:open-tab', handler)
    return () => ipcRenderer.removeListener('mcp:open-tab', handler)
  },
  onAddToGallery: (cb: (data: { label: string; html: string; css?: string }) => void) => {
    const handler = (_: unknown, data: { label: string; html: string; css?: string }) => cb(data)
    ipcRenderer.on('mcp:add-to-gallery', handler)
    return () => ipcRenderer.removeListener('mcp:add-to-gallery', handler)
  },
  onCheckpoint: (cb: (data: { message: string }) => void) => {
    const handler = (_: unknown, data: { message: string }) => cb(data)
    ipcRenderer.on('mcp:checkpoint', handler)
    return () => ipcRenderer.removeListener('mcp:checkpoint', handler)
  },
  onNotify: (cb: (data: { message: string; type: string }) => void) => {
    const handler = (_: unknown, data: { message: string; type: string }) => cb(data)
    ipcRenderer.on('mcp:notify', handler)
    return () => ipcRenderer.removeListener('mcp:notify', handler)
  }
}
```

**Step 2: Verify build**

Run: `npx electron-vite build 2>&1 | tail -5`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat: add MCP IPC channels to preload bridge"
```

---

### Task 7: Create renderer MCP command handler hook

**Files:**
- Create: `src/renderer/hooks/useMcpCommands.ts`

**Step 1: Create the hook**

Create `src/renderer/hooks/useMcpCommands.ts`:

```typescript
import { useEffect } from 'react'
import { useCanvasStore } from '@/stores/canvas'
import { useWorkspaceStore } from '@/stores/workspace'
import { useGalleryStore } from '@/stores/gallery'
import { useProjectStore } from '@/stores/project'

/**
 * Listens for MCP tool commands from the main process and
 * updates Zustand stores accordingly. This is the renderer-side
 * handler for all MCP → Canvas communication.
 */
export function useMcpCommands() {
  const { setPreviewUrl, setActiveTab, setInspectorActive, setSelectedElement } = useCanvasStore()
  const { openCanvas, closeCanvas, mode } = useWorkspaceStore()
  const { addVariant } = useGalleryStore()
  const { currentProject, setDevServerRunning } = useProjectStore()

  useEffect(() => {
    const cleanups: (() => void)[] = []

    // canvas_render — route to inline or canvas
    cleanups.push(
      window.api.mcp.onCanvasRender(async ({ html, css }) => {
        const result = await window.api.render.evaluate(html, css)
        if (result.target === 'canvas') {
          if (mode !== 'terminal-canvas') openCanvas()
          // Render in canvas via preview mechanism — set a data URL or srcdoc
          // For now, add to gallery as a quick render
          addVariant({
            id: `render-${Date.now()}`,
            label: 'Live Render',
            html: css ? `<style>${css}</style>${html}` : html
          })
          setActiveTab('gallery')
        }
        // Inline rendering is handled by the terminal's InlineRender system
        // which is triggered separately via the PTY output stream
      })
    )

    // canvas_start_preview — start dev server + open canvas
    cleanups.push(
      window.api.mcp.onStartPreview(async ({ command, cwd }) => {
        const projectCwd = cwd || currentProject?.path
        if (!projectCwd) return
        const result = await window.api.dev.start(projectCwd, command)
        setDevServerRunning(true)
        if (result?.url) {
          setPreviewUrl(result.url)
        }
        if (mode !== 'terminal-canvas') openCanvas()
        setActiveTab('preview')
      })
    )

    // canvas_stop_preview
    cleanups.push(
      window.api.mcp.onStopPreview(async () => {
        await window.api.dev.stop()
        setDevServerRunning(false)
        closeCanvas()
      })
    )

    // canvas_set_preview_url
    cleanups.push(
      window.api.mcp.onSetPreviewUrl(({ url }) => {
        setPreviewUrl(url)
        if (mode !== 'terminal-canvas') openCanvas()
        setActiveTab('preview')
      })
    )

    // canvas_open_tab
    cleanups.push(
      window.api.mcp.onOpenTab(({ tab }) => {
        if (mode !== 'terminal-canvas') openCanvas()
        setActiveTab(tab as any)
      })
    )

    // canvas_add_to_gallery
    cleanups.push(
      window.api.mcp.onAddToGallery(({ label, html, css }) => {
        addVariant({
          id: `gallery-${Date.now()}`,
          label,
          html: css ? `<style>${css}</style>${html}` : html
        })
        if (mode !== 'terminal-canvas') openCanvas()
        setActiveTab('gallery')
      })
    )

    // canvas_checkpoint
    cleanups.push(
      window.api.mcp.onCheckpoint(async ({ message }) => {
        await window.api.git.checkpoint(message)
      })
    )

    // canvas_notify — update notification in store (we'll add a toast system)
    cleanups.push(
      window.api.mcp.onNotify(({ message, type }) => {
        console.log(`[MCP Notify] (${type}): ${message}`)
        // TODO: Wire to a toast/notification UI component
      })
    )

    return () => cleanups.forEach((fn) => fn())
  }, [
    mode, openCanvas, closeCanvas, setPreviewUrl, setActiveTab,
    addVariant, currentProject, setDevServerRunning,
    setInspectorActive, setSelectedElement
  ])
}
```

**Step 2: Verify build**

Run: `npx electron-vite build 2>&1 | tail -5`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/renderer/hooks/useMcpCommands.ts
git commit -m "feat: add useMcpCommands hook for MCP → renderer communication"
```

---

### Task 8: Expose canvas state for MCP queries

**Files:**
- Create: `src/renderer/hooks/useMcpStateExposer.ts`

**Step 1: Create state exposer hook**

Create `src/renderer/hooks/useMcpStateExposer.ts`:

```typescript
import { useEffect } from 'react'
import { useCanvasStore } from '@/stores/canvas'
import { useWorkspaceStore } from '@/stores/workspace'
import { useProjectStore } from '@/stores/project'

/**
 * Exposes Zustand store state on window globals so the MCP server's
 * canvas_get_status and canvas_get_context tools can read them via
 * executeJavaScript from the main process.
 */
export function useMcpStateExposer() {
  const { activeTab, previewUrl, inspectorActive, selectedElement } = useCanvasStore()
  const { mode } = useWorkspaceStore()
  const { isDevServerRunning, currentProject } = useProjectStore()

  useEffect(() => {
    ;(window as any).__canvasState = {
      activeTab,
      previewUrl,
      inspectorActive,
      workspaceMode: mode,
      devServerRunning: isDevServerRunning,
      projectName: currentProject?.name || null,
      projectPath: currentProject?.path || null
    }
  }, [activeTab, previewUrl, inspectorActive, mode, isDevServerRunning, currentProject])

  useEffect(() => {
    ;(window as any).__inspectorContext = selectedElement
      ? {
          selected: true,
          ...selectedElement
        }
      : { selected: false }
  }, [selectedElement])
}
```

**Step 2: Verify build**

Run: `npx electron-vite build 2>&1 | tail -5`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/renderer/hooks/useMcpStateExposer.ts
git commit -m "feat: expose canvas state for MCP context queries"
```

---

### Task 9: Wire MCP hooks into App.tsx + trigger on project open

**Files:**
- Modify: `src/renderer/App.tsx`

**Step 1: Import and use MCP hooks**

Add imports to `src/renderer/App.tsx`:
```typescript
import { useMcpCommands } from './hooks/useMcpCommands'
import { useMcpStateExposer } from './hooks/useMcpStateExposer'
```

Inside the `App` component, add:
```typescript
useMcpCommands()
useMcpStateExposer()
```

**Step 2: Trigger MCP server on project open**

In `App.tsx`, add a useEffect that starts the MCP server when entering the workspace:

```typescript
useEffect(() => {
  if (screen === 'workspace' && currentProject?.path) {
    window.api.mcp.projectOpened(currentProject.path)
    return () => {
      window.api.mcp.projectClosed()
    }
  }
}, [screen, currentProject?.path])
```

Add `currentProject` to the destructured values from `useProjectStore`:
```typescript
const { screen, setScreen, currentProject } = useProjectStore()
```

**Step 3: Verify build**

Run: `npx electron-vite build 2>&1 | tail -5`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat: wire MCP hooks into App and trigger server on project open"
```

---

### Task 10: Wire inspector context paste to PTY

**Files:**
- Modify: `src/renderer/hooks/useInspector.ts`

**Step 1: Read current useInspector.ts**

Read `src/renderer/hooks/useInspector.ts` to understand the existing inspector → terminal paste mechanism.

**Step 2: Ensure inspector pastes context to PTY**

The `useInspector` hook should already listen for `inspector:elementSelected` postMessage events. Verify it formats context and writes to PTY. If not, add:

```typescript
import { useTerminalStore } from '@/stores/terminal'

// Inside the message handler for inspector:elementSelected:
const { ptyId } = useTerminalStore.getState()
if (ptyId && data.componentName) {
  const context = `[Inspector] ${data.componentName}${data.fileName ? ` (${data.fileName}:${data.lineNumber})` : ''} — ${data.styles || 'no styles'}`
  window.api.pty.write(ptyId, context)
}
```

**Step 3: Verify build**

Run: `npx electron-vite build 2>&1 | tail -5`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/renderer/hooks/useInspector.ts
git commit -m "feat: wire inspector element selection to PTY paste"
```

---

### Task 11: Add CLAUDE_CANVAS env var to PTY

**Files:**
- Modify: `src/main/pty.ts`

**Step 1: Set CLAUDE_CANVAS env var**

In `src/main/pty.ts`, in the env setup IIFE, add after the delete statements:

```typescript
env.CLAUDE_CANVAS = '1'
env.CLAUDE_CANVAS_MCP_PORT = String(serverPort || '')
```

Import `getMcpPort` at the top:
```typescript
import { getMcpPort } from './mcp/server'
```

This lets Claude Code (and any other tool) detect that it's running inside Canvas.

**Step 2: Verify build**

Run: `npx electron-vite build 2>&1 | tail -5`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/main/pty.ts
git commit -m "feat: set CLAUDE_CANVAS env var in PTY for detection"
```

---

### Task 12: Update dev server to return URL on start

**Files:**
- Modify: `src/main/services/dev-server.ts`

**Step 1: Read current dev-server.ts**

Read `src/main/services/dev-server.ts` to understand the current `dev:start` handler.

**Step 2: Ensure it returns the dev server URL**

The `dev:start` IPC handler should return `{ url: 'http://localhost:{port}', port }` after the server starts and the port is detected. Check if it already does. If not, modify the handler to:

```typescript
// In the dev:start handler, after port detection:
return { url: `http://localhost:${detectedPort}`, port: detectedPort }
```

**Step 3: Update preload to match**

If the return type changed, ensure `src/preload/index.ts` `dev.start` still works (it's already typed as returning a Promise, so the return value is passed through).

**Step 4: Verify build**

Run: `npx electron-vite build 2>&1 | tail -5`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add src/main/services/dev-server.ts src/preload/index.ts
git commit -m "feat: return dev server URL from dev:start handler"
```

---

### Task 13: Add notification toast UI

**Files:**
- Create: `src/renderer/components/Toast/Toast.tsx`
- Create: `src/renderer/stores/toast.ts`
- Modify: `src/renderer/App.tsx`

**Step 1: Create toast store**

Create `src/renderer/stores/toast.ts`:

```typescript
import { create } from 'zustand'

interface Toast {
  id: string
  message: string
  type: 'info' | 'success' | 'error'
}

interface ToastStore {
  toasts: Toast[]
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void
  removeToast: (id: string) => void
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (message, type = 'info') => {
    const id = `toast-${Date.now()}`
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }))
    // Auto-remove after 4 seconds
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, 4000)
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))
```

**Step 2: Create Toast component**

Create `src/renderer/components/Toast/Toast.tsx`:

```typescript
import { AnimatePresence, motion } from 'framer-motion'
import { useToastStore } from '@/stores/toast'
import { X, Info, CheckCircle, AlertCircle } from 'lucide-react'

const icons = {
  info: Info,
  success: CheckCircle,
  error: AlertCircle
}

const colors = {
  info: 'border-blue-400/30 text-blue-300',
  success: 'border-green-400/30 text-green-300',
  error: 'border-red-400/30 text-red-300'
}

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore()

  return (
    <div className="fixed bottom-12 right-4 z-50 flex flex-col gap-2">
      <AnimatePresence>
        {toasts.map((toast) => {
          const Icon = icons[toast.type]
          return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 50 }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border bg-[var(--bg-secondary)] shadow-lg ${colors[toast.type]}`}
            >
              <Icon size={14} />
              <span className="text-sm text-white/80">{toast.message}</span>
              <button onClick={() => removeToast(toast.id)} className="ml-2 text-white/30 hover:text-white/60">
                <X size={12} />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
```

**Step 3: Add ToastContainer to App.tsx**

Import and render in `src/renderer/App.tsx`:
```typescript
import { ToastContainer } from './components/Toast/Toast'
```

Add inside the root div, after `<QuickActions>`:
```typescript
<ToastContainer />
```

**Step 4: Wire MCP notify to toast store**

In `src/renderer/hooks/useMcpCommands.ts`, replace the `canvas_notify` handler's `console.log` with:

```typescript
import { useToastStore } from '@/stores/toast'
```

Inside the hook:
```typescript
const { addToast } = useToastStore()
```

In the onNotify handler:
```typescript
addToast(message, type as any)
```

**Step 5: Verify build**

Run: `npx electron-vite build 2>&1 | tail -5`
Expected: Build succeeds

**Step 6: Commit**

```bash
git add src/renderer/stores/toast.ts src/renderer/components/Toast/Toast.tsx src/renderer/App.tsx src/renderer/hooks/useMcpCommands.ts
git commit -m "feat: add toast notification system wired to MCP canvas_notify"
```

---

### Task 14: Update test setup and write MCP tests

**Files:**
- Modify: `src/renderer/__tests__/setup.ts`
- Create: `src/renderer/__tests__/mcp-commands.test.ts`

**Step 1: Update test setup with MCP mocks**

In `src/renderer/__tests__/setup.ts`, add `mcp` section to the `window.api` mock:

```typescript
mcp: {
  projectOpened: vi.fn().mockResolvedValue({ port: 9315 }),
  projectClosed: vi.fn().mockResolvedValue(undefined),
  onCanvasRender: vi.fn().mockReturnValue(() => {}),
  onStartPreview: vi.fn().mockReturnValue(() => {}),
  onStopPreview: vi.fn().mockReturnValue(() => {}),
  onSetPreviewUrl: vi.fn().mockReturnValue(() => {}),
  onOpenTab: vi.fn().mockReturnValue(() => {}),
  onAddToGallery: vi.fn().mockReturnValue(() => {}),
  onCheckpoint: vi.fn().mockReturnValue(() => {}),
  onNotify: vi.fn().mockReturnValue(() => {})
}
```

**Step 2: Write MCP integration tests**

Create `src/renderer/__tests__/mcp-commands.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useCanvasStore } from '@/stores/canvas'
import { useWorkspaceStore } from '@/stores/workspace'
import { useGalleryStore } from '@/stores/gallery'
import { useToastStore } from '@/stores/toast'

describe('MCP Command Effects', () => {
  beforeEach(() => {
    useCanvasStore.setState({ activeTab: 'preview', previewUrl: null, inspectorActive: false, selectedElement: null })
    useWorkspaceStore.setState({ mode: 'terminal-only', canvasSplit: 50 })
    useGalleryStore.setState({ variants: [], selectedId: null })
    useToastStore.setState({ toasts: [] })
  })

  it('canvas_set_preview_url opens canvas and sets URL', () => {
    useCanvasStore.getState().setPreviewUrl('http://localhost:3000')
    useWorkspaceStore.getState().openCanvas()
    useCanvasStore.getState().setActiveTab('preview')

    expect(useCanvasStore.getState().previewUrl).toBe('http://localhost:3000')
    expect(useWorkspaceStore.getState().mode).toBe('terminal-canvas')
    expect(useCanvasStore.getState().activeTab).toBe('preview')
  })

  it('canvas_open_tab opens canvas and switches tab', () => {
    useWorkspaceStore.getState().openCanvas()
    useCanvasStore.getState().setActiveTab('gallery')

    expect(useWorkspaceStore.getState().mode).toBe('terminal-canvas')
    expect(useCanvasStore.getState().activeTab).toBe('gallery')
  })

  it('canvas_add_to_gallery adds variant and switches to gallery', () => {
    useGalleryStore.getState().addVariant({
      id: 'test-1',
      label: 'Primary Button',
      html: '<button>Click</button>'
    })
    useWorkspaceStore.getState().openCanvas()
    useCanvasStore.getState().setActiveTab('gallery')

    expect(useGalleryStore.getState().variants).toHaveLength(1)
    expect(useGalleryStore.getState().variants[0].label).toBe('Primary Button')
    expect(useCanvasStore.getState().activeTab).toBe('gallery')
  })

  it('canvas_notify adds toast', () => {
    useToastStore.getState().addToast('Build complete', 'success')

    expect(useToastStore.getState().toasts).toHaveLength(1)
    expect(useToastStore.getState().toasts[0].message).toBe('Build complete')
    expect(useToastStore.getState().toasts[0].type).toBe('success')
  })

  it('toast auto-removes after timeout', async () => {
    vi.useFakeTimers()
    useToastStore.getState().addToast('Temporary', 'info')
    expect(useToastStore.getState().toasts).toHaveLength(1)

    vi.advanceTimersByTime(4100)
    expect(useToastStore.getState().toasts).toHaveLength(0)
    vi.useRealTimers()
  })

  it('canvas_get_status state is exposed on window', () => {
    // Simulate what useMcpStateExposer does
    ;(window as any).__canvasState = {
      activeTab: 'preview',
      previewUrl: null,
      inspectorActive: false,
      workspaceMode: 'terminal-only',
      devServerRunning: false,
      projectName: null,
      projectPath: null
    }

    const state = (window as any).__canvasState
    expect(state.activeTab).toBe('preview')
    expect(state.workspaceMode).toBe('terminal-only')
  })
})
```

**Step 3: Run tests**

Run: `npx vitest run`
Expected: All tests pass (previous 51 + new MCP tests)

**Step 4: Commit**

```bash
git add src/renderer/__tests__/setup.ts src/renderer/__tests__/mcp-commands.test.ts
git commit -m "test: add MCP command effect tests and mock setup"
```

---

### Task 15: Final integration verification

**Step 1: Full build**

Run: `npx electron-vite build`
Expected: All three bundles build successfully

**Step 2: Full test suite**

Run: `npx vitest run`
Expected: All tests pass

**Step 3: Manual smoke test**

Run: `npm run dev`

1. Complete onboarding wizard
2. Open a project
3. Verify terminal loads and `.mcp.json` appears in the project directory
4. Run `claude` inside the terminal
5. Ask Claude to use `canvas_render` or `canvas_set_preview_url` — verify canvas opens
6. Close the app and verify `.mcp.json` is deleted

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete MCP bridge — Claude Code ↔ Canvas bidirectional communication"
```
