import { app, BrowserWindow, shell, ipcMain, dialog, screen } from 'electron'
import { join } from 'path'
import { readFileSync } from 'fs'
import { randomBytes } from 'node:crypto'
import { is } from '@electron-toolkit/utils'

// Load .env file into process.env (no external dependency needed)
// __dirname in compiled output is <project>/out/main — go up two levels to reach project root
try {
  const envPath = join(__dirname, '../../.env')
  const envContent = readFileSync(envPath, 'utf-8')
  let loaded = 0
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed.slice(eqIdx + 1).trim()
    if (!process.env[key]) {
      process.env[key] = value
      loaded++
    }
  }
  console.log(`[env] Loaded ${loaded} variables from ${envPath}`)
} catch { /* .env file is optional */ }
import { setupPtyHandlers, killAllPtys, getActivePtyInfo } from './pty'
import { setupSettingsHandlers, settingsStore } from './store'
import { setupFileWatcher, closeWatcher } from './watcher'
import { setupDevServerSystem, killAllDevServers } from './devserver'
import { setupRenderRouter } from './render-router'
import { setupGitHandlers } from './services/git'
import { cleanupAllGitInstances } from './services/git-queue'
import { setupGithubOAuth } from './oauth/github'
import { setupVercelOAuth } from './oauth/vercel'
import { setupSupabaseOAuth } from './oauth/supabase'
import { startMcpServer, stopMcpServer, registerSessionToken, unregisterSessionToken, clearTokenRegistry } from './mcp/server'
import { setLinkedSupabaseRef } from './mcp/supabase-tools'
import { setupGalleryIpc } from './mcp/gallery-state'
import { writeMcpConfig, removeMcpConfig } from './mcp/config-writer'
import { setupScreenshotHandlers } from './screenshot'
import { setupInspectorHandlers } from './inspector'
import { setupWorktreeHandlers } from './services/worktree'
import { setupTemplateHandlers } from './services/templates'
import { setupVisualDiffHandlers } from './services/visual-diff'
import { setupFileTreeHandlers } from './services/file-tree'
import { setupSearchHandlers } from './services/search'
import { setupComponentScannerHandlers } from './services/component-scanner'
import { initSecureStorage } from './services/secure-storage'
import { setupAutoUpdater, installUpdate } from './updater'
import { registerPtyProvider, registerDevProvider, listProcesses } from './services/process-tracker'
import { getActiveDevServers } from './devserver/runner'
import { setupPowerMonitor, stopPowerSaveBlocker } from './power-monitor'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const savedBounds = settingsStore.get('windowBounds') as Electron.Rectangle | undefined

  // Validate that saved position is visible on a connected display.
  // If the user disconnected an external monitor, the saved x/y could be
  // off-screen — in that case we let Electron pick a default position.
  let x: number | undefined
  let y: number | undefined
  if (savedBounds?.x !== undefined && savedBounds?.y !== undefined) {
    const displays = screen.getAllDisplays()
    const isVisible = displays.some((display) => {
      const { x: dx, y: dy, width: dw, height: dh } = display.bounds
      // Consider visible if the saved origin lands within any display bounds
      return (
        savedBounds.x >= dx &&
        savedBounds.x < dx + dw &&
        savedBounds.y >= dy &&
        savedBounds.y < dy + dh
      )
    })
    if (isVisible) {
      x = savedBounds.x
      y = savedBounds.y
    }
  }

  mainWindow = new BrowserWindow({
    width: savedBounds?.width || 960,
    height: savedBounds?.height || 700,
    x,
    y,
    minWidth: 700,
    minHeight: 500,
    frame: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 15, y: 15 },
    backgroundColor: '#0A0F1A',
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      webviewTag: false,
      spellcheck: false
    }
  })

  // Persist window bounds on move/resize (debounced to avoid excessive writes)
  let boundsTimer: ReturnType<typeof setTimeout> | null = null
  const saveBounds = (): void => {
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      if (!mainWindow!.isMaximized() && !mainWindow!.isMinimized() && !mainWindow!.isDestroyed()) {
        settingsStore.set('windowBounds', mainWindow!.getBounds())
      }
    }, 500)
  }
  mainWindow.on('resize', saveBounds)
  mainWindow.on('move', saveBounds)

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Forward renderer console messages with [TAB-DEBUG] to main process stdout
  // so we can see them in the terminal without DevTools
  mainWindow.webContents.on('console-message', (_event, level, message) => {
    if (message.includes('[TAB-DEBUG]')) {
      console.log(message)
    }
    // Forward errors/warnings to terminal for debugging
    if (level >= 2) {
      console.log(`[RENDERER ${level === 2 ? 'WARN' : 'ERROR'}] ${message}`)
    }
  })


  // Ctrl+Shift+I / Cmd+Option+I to open DevTools
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (
      (input.control && input.shift && input.key === 'I') ||
      (input.meta && input.alt && input.key === 'i')
    ) {
      mainWindow?.webContents.toggleDevTools()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Log startup FD count (before any watchers, PTYs, or git ops)
  try {
    const startupFds = require('fs').readdirSync('/dev/fd').length
    console.log(`[startup] FD baseline: ${startupFds} open FDs (pid=${process.pid})`)
  } catch {}

  // Instrument IPC handlers to log any that take > 50ms
  const origHandle = ipcMain.handle.bind(ipcMain)
  ;(ipcMain as any).handle = (channel: string, listener: (...args: any[]) => any) => {
    return origHandle(channel, async (...args: any[]) => {
      const t0 = performance.now()
      const result = await listener(...args)
      const elapsed = performance.now() - t0
      if (elapsed > 50) {
        console.log(`[TAB-DEBUG] SLOW IPC: ${channel} took ${elapsed.toFixed(0)}ms`)
      }
      return result
    })
  }

  // Migrate plaintext tokens to encrypted storage (must run before OAuth setup)
  initSecureStorage()

  createWindow()
  setupAutoUpdater(mainWindow!)
  setupPowerMonitor(() => mainWindow)

  // Core services
  setupPtyHandlers(() => mainWindow)
  setupSettingsHandlers()
  setupFileWatcher(() => mainWindow)
  setupDevServerSystem(() => mainWindow)
  setupRenderRouter(() => mainWindow)
  setupGitHandlers()
  setupGithubOAuth(() => mainWindow)
  setupVercelOAuth(() => mainWindow)
  setupSupabaseOAuth(() => mainWindow)
  setupScreenshotHandlers(() => mainWindow)
  setupInspectorHandlers(() => mainWindow)
  setupWorktreeHandlers()
  setupTemplateHandlers(() => mainWindow)
  setupVisualDiffHandlers(() => mainWindow)
  setupFileTreeHandlers()
  setupSearchHandlers()
  setupComponentScannerHandlers()
  setupGalleryIpc()

  // Process tracker providers
  registerPtyProvider(getActivePtyInfo)
  registerDevProvider(getActiveDevServers)

  // Process manager IPC
  ipcMain.handle('process:list', async (_event, opts?: { tabId?: string }) => {
    return listProcesses(opts?.tabId)
  })

  ipcMain.handle('process:kill', async (_event, opts: { pid: number }) => {
    const treeKill = (await import('tree-kill')).default
    const known = await listProcesses()
    if (!known.some((p) => p.pid === opts.pid)) {
      return { success: false, error: 'PID not in known process list' }
    }
    return new Promise((resolve) => {
      treeKill(opts.pid, 'SIGTERM', (err) => {
        resolve(err ? { success: false, error: (err as Error).message } : { success: true })
      })
    })
  })

  // Per-tab session tracking
  const tabSessions = new Map<string, { projectPath: string; port: number; token: string; createdAt: number }>()

  // MCP Bridge — start server when a tab opens a project
  ipcMain.handle('mcp:project-opened', async (_event, opts: { tabId: string; projectPath: string }) => {
    const { tabId, projectPath } = opts
    const t0 = Date.now()
    try {
      const token = randomBytes(12).toString('hex') // 24-char hex token
      const port = await startMcpServer(() => mainWindow, projectPath)
      registerSessionToken(token, tabId, projectPath)
      // ALWAYS overwrite .mcp.json with new token (stale tokens from prior sessions are expected)
      await writeMcpConfig(projectPath, port, token)
      tabSessions.set(tabId, { projectPath, port, token, createdAt: Date.now() })
      console.log(`[MCP][tabId=${tabId}] Opened in ${Date.now() - t0}ms — port ${port}, token=${token.slice(0, 4)}…, path: ${projectPath}`)
      return { port }
    } catch (err) {
      console.error(`[MCP][tabId=${tabId}] project-opened failed (${Date.now() - t0}ms):`, err)
      throw err // Re-throw so renderer's .catch() fires and sets boot.mcpReady = 'error'
    }
  })

  // MCP Bridge — stop session when a tab closes
  ipcMain.handle('mcp:project-closed', async (_event, opts: { tabId: string }) => {
    const session = tabSessions.get(opts.tabId)
    if (session?.token) unregisterSessionToken(session.token)
    tabSessions.delete(opts.tabId)
    console.log(`[MCP][tabId=${opts.tabId}] Closed (${tabSessions.size} remaining)`)
    if (tabSessions.size === 0) {
      await removeMcpConfig()
      await stopMcpServer()
    }
  })

  // MCP Bridge — shutdown all sessions (called when all tabs close)
  ipcMain.handle('mcp:shutdown-all', async () => {
    tabSessions.clear()
    clearTokenRegistry()
    await removeMcpConfig()
    await stopMcpServer()
  })

  // MCP Bridge — renderer tells us the linked Supabase project ref
  ipcMain.handle('mcp:supabase-linked', (_event, ref: string | null) => {
    setLinkedSupabaseRef(ref)
  })

  // Auto-updater
  ipcMain.handle('updater:install', () => installUpdate())

  // Dialog
  ipcMain.handle('dialog:selectDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // App version (sync for preload static property)
  ipcMain.on('app:getVersion', (event) => {
    event.returnValue = app.getVersion()
  })

  // Window controls
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.on('window:close', () => mainWindow?.close())
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false)
  ipcMain.handle('window:getBounds', () => mainWindow?.getBounds())
  ipcMain.handle(
    'window:setSize',
    (_event, width: number, height: number, animate: boolean) => {
      if (!mainWindow || mainWindow.isFullScreen()) return
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize()
      }
      // Wait a tick for unmaximize to settle, then set bounds
      setTimeout(() => {
        if (!mainWindow) return
        const bounds = mainWindow.getBounds()
        const cx = bounds.x + bounds.width / 2
        const cy = bounds.y + bounds.height / 2
        mainWindow.setBounds(
          {
            x: Math.round(cx - width / 2),
            y: Math.round(cy - height / 2),
            width,
            height
          },
          animate
        )
      }, mainWindow.isMaximized() ? 100 : 0)
    }
  )

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  removeMcpConfig()
  stopMcpServer()
  killAllPtys()
  closeWatcher()
  killAllDevServers()
  cleanupAllGitInstances()
  stopPowerSaveBlocker()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  // Project-local cleanup (CLAUDE.md, .mcp.json) — no ~/.claude.json writes.
  // Note: removeMcpConfig() is already called in window-all-closed, but
  // on macOS Cmd+Q fires before-quit first, and the window may not close
  // if the user cancels. Calling it here ensures cleanup runs on quit too.
  removeMcpConfig()
})
