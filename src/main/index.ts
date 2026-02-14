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
import { writeMcpConfig, removeMcpConfig } from './mcp/config-writer'
import { setupScreenshotHandlers } from './screenshot'
import { setupInspectorHandlers } from './inspector'
import { setupWorktreeHandlers } from './services/worktree'

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
  removeMcpConfig()
})
