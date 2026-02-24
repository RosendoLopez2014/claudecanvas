import { autoUpdater } from 'electron-updater'
import { app, BrowserWindow } from 'electron'

export function setupAutoUpdater(win: BrowserWindow): void {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    win.webContents.send('updater:status', {
      status: 'available' as const,
      version: info.version
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    win.webContents.send('updater:status', {
      status: 'downloading' as const,
      percent: progress.percent
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    win.webContents.send('updater:status', {
      status: 'ready' as const,
      version: info.version
    })
  })

  autoUpdater.on('error', (err) => {
    console.error('[updater] Error:', err.message)
  })

  autoUpdater.checkForUpdates().catch(() => {})
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000)
}

export function installUpdate(): void {
  setImmediate(() => autoUpdater.quitAndInstall(false, true))
}
