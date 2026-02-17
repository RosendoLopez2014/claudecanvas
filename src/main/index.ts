import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { setupPtyHandlers, killAllPtys } from './pty'
import { setupSettingsHandlers } from './store'
import { setupFileWatcher, closeWatcher } from './watcher'
import { setupDevServerHandlers, killDevServer } from './services/dev-server'
import { setupRenderRouter } from './render-router'
import { setupGitHandlers, cleanupAllGitInstances } from './services/git'
import { setupGithubOAuth } from './oauth/github'
import { setupVercelOAuth } from './oauth/vercel'
import { setupSupabaseOAuth } from './oauth/supabase'
import { startMcpServer, stopMcpServer } from './mcp/server'
import { setupGalleryIpc } from './mcp/gallery-state'
import { writeMcpConfig, removeMcpConfig } from './mcp/config-writer'
import { setupScreenshotHandlers } from './screenshot'
import { setupInspectorHandlers } from './inspector'
import { setupWorktreeHandlers } from './services/worktree'
import { setupTemplateHandlers } from './services/templates'
import { setupFrameworkDetectHandlers } from './services/framework-detect'
import { setupVisualDiffHandlers } from './services/visual-diff'
import { setupFileTreeHandlers } from './services/file-tree'
import { setupSearchHandlers } from './services/search'
import { initSecureStorage } from './services/secure-storage'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 700,
    minWidth: 700,
    minHeight: 500,
    frame: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 15, y: 15 },
    backgroundColor: '#0A0F1A',
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

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Forward renderer console messages with [TAB-DEBUG] to main process stdout
  // so we can see them in the terminal without DevTools
  mainWindow.webContents.on('console-message', (_event, _level, message) => {
    if (message.includes('[TAB-DEBUG]')) {
      console.log(message)
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

  // Core services
  setupPtyHandlers(() => mainWindow)
  setupSettingsHandlers()
  setupFileWatcher(() => mainWindow)
  setupDevServerHandlers(() => mainWindow)
  setupRenderRouter(() => mainWindow)
  setupGitHandlers()
  setupGithubOAuth(() => mainWindow)
  setupVercelOAuth(() => mainWindow)
  setupSupabaseOAuth(() => mainWindow)
  setupScreenshotHandlers(() => mainWindow)
  setupInspectorHandlers(() => mainWindow)
  setupWorktreeHandlers()
  setupTemplateHandlers(() => mainWindow)
  setupFrameworkDetectHandlers()
  setupVisualDiffHandlers(() => mainWindow)
  setupFileTreeHandlers()
  setupSearchHandlers()
  setupGalleryIpc()
  // MCP Bridge — start server when a project opens
  ipcMain.handle('mcp:project-opened', async (_event, projectPath: string) => {
    const port = await startMcpServer(() => mainWindow, projectPath)
    await writeMcpConfig(projectPath, port)
    return { port }
  })

  // MCP Bridge — stop server when project closes
  ipcMain.handle('mcp:project-closed', async () => {
    await removeMcpConfig()
    await stopMcpServer()
  })

  // Dialog
  ipcMain.handle('dialog:selectDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
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
  killDevServer()
  cleanupAllGitInstances()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  // Project-local cleanup (CLAUDE.md, .mcp.json) — no ~/.claude.json writes.
  // Note: removeMcpConfig() is already called in window-all-closed, but
  // on macOS Cmd+Q fires before-quit first, and the window may not close
  // if the user cancels. Calling it here ensures cleanup runs on quit too.
  removeMcpConfig()
})
