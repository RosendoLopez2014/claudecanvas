import { watch, FSWatcher } from 'chokidar'
import { BrowserWindow, ipcMain } from 'electron'

const watchers = new Map<string, FSWatcher>()

export function setupFileWatcher(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('fs:watch', (_event, projectPath: string) => {
    if (watchers.has(projectPath)) return true

    const w = watch(projectPath, {
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

    w.on('change', (path) => {
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('fs:change', { projectPath, path })
      }
    })

    w.on('add', (path) => {
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('fs:add', { projectPath, path })
      }
    })

    w.on('unlink', (path) => {
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('fs:unlink', { projectPath, path })
      }
    })

    watchers.set(projectPath, w)
    return true
  })

  ipcMain.handle('fs:unwatch', (_event, projectPath?: string) => {
    if (projectPath && watchers.has(projectPath)) {
      watchers.get(projectPath)!.close()
      watchers.delete(projectPath)
    } else if (!projectPath) {
      for (const [, w] of watchers) w.close()
      watchers.clear()
    }
  })
}

export function closeWatcher(): void {
  for (const [, w] of watchers) w.close()
  watchers.clear()
}
