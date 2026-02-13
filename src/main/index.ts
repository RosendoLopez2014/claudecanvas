import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { setupPtyHandlers, killAllPtys } from './pty'
import { setupSettingsHandlers } from './store'
import { setupFileWatcher, closeWatcher } from './watcher'
import { setupDevServerHandlers, killDevServer } from './services/dev-server'
import { setupRenderRouter } from './render-router'
import { setupGitHandlers } from './services/git'
import { setupGithubOAuth } from './oauth/github'
import { setupVercelOAuth } from './oauth/vercel'
import { setupSupabaseOAuth } from './oauth/supabase'
import { startMcpServer, stopMcpServer } from './mcp/server'
import { writeMcpConfig, removeMcpConfig } from './mcp/config-writer'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
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
  setupGithubOAuth()
  setupVercelOAuth()
  setupSupabaseOAuth()

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
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  removeMcpConfig()
})
