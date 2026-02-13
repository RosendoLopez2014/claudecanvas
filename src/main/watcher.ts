import { watch, FSWatcher } from 'chokidar'
import { BrowserWindow, ipcMain } from 'electron'

let watcher: FSWatcher | null = null

export function setupFileWatcher(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('fs:watch', (_event, projectPath: string) => {
    if (watcher) watcher.close()

    watcher = watch(projectPath, {
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/out/**',
        '**/.next/**'
      ],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }
    })

    watcher.on('change', (path) => {
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('fs:change', path)
      }
    })

    watcher.on('add', (path) => {
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('fs:add', path)
      }
    })

    watcher.on('unlink', (path) => {
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('fs:unlink', path)
      }
    })

    return true
  })

  ipcMain.handle('fs:unwatch', () => {
    watcher?.close()
    watcher = null
  })
}

export function closeWatcher(): void {
  watcher?.close()
}
