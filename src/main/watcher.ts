import { watch, FSWatcher } from 'chokidar'
import { BrowserWindow, ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { isValidPath } from './validate'

const watchers = new Map<string, FSWatcher>()
const closingWatchers = new Set<string>()

function fdCount(): number {
  try { return fs.readdirSync('/dev/fd').length } catch { return -1 }
}

// ── Chokidar ignore function ──────────────────────────────────────────
// MUST use a function (not glob strings) because chokidar v4's glob-based
// ignore only filters EVENTS — it still opens FDs for every file during
// the initial directory scan. A function-based ignore prevents recursion
// into ignored directories entirely, reducing FDs from ~17k to ~75.
const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'out', 'build', '.next',
  '.turbo', 'coverage', '.vercel', '.playwright-mcp', '.cache',
  '.parcel-cache', '.svelte-kit', '.output', '.nuxt', '__pycache__',
])

function shouldIgnore(filePath: string): boolean {
  const basename = path.basename(filePath)
  if (IGNORED_DIRS.has(basename)) return true
  if (basename.endsWith('.map')) return true
  return false
}

export function setupFileWatcher(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('fs:watch', (_event, projectPath: string) => {
    if (!isValidPath(projectPath)) return false
    if (watchers.has(projectPath)) {
      console.log(`[watcher] ALREADY WATCHING ${projectPath} (total=${watchers.size})`)
      return true
    }

    const fdBefore = fdCount()
    const w = watch(projectPath, {
      ignored: shouldIgnore,
      persistent: true,
      ignoreInitial: true,
      followSymlinks: false, // Prevent infinite loops from circular symlinks
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

    // Log FD delta once watcher is ready (all paths discovered)
    w.on('ready', () => {
      const fdAfter = fdCount()
      console.log(
        `[watcher] CREATE ${projectPath} — total=${watchers.size}, fdBefore=${fdBefore}, fdAfter=${fdAfter}, fdDelta=+${fdAfter - fdBefore}`
      )
    })

    return true
  })

  ipcMain.handle('fs:unwatch', (_event, projectPath?: string) => {
    if (projectPath && watchers.has(projectPath)) {
      const w = watchers.get(projectPath)!
      watchers.delete(projectPath)
      closingWatchers.add(projectPath)
      const fdBefore = fdCount()
      console.log(`[watcher] CLOSE-START ${projectPath} — remaining=${watchers.size}, closing=${closingWatchers.size}, fds=${fdBefore}`)
      w.close().then(() => {
        closingWatchers.delete(projectPath)
        const fdAfter = fdCount()
        console.log(`[watcher] CLOSE-DONE ${projectPath} — remaining=${watchers.size}, closing=${closingWatchers.size}, fds=${fdAfter}, fdDelta=${fdAfter - fdBefore}`)
      }).catch((err: unknown) => {
        closingWatchers.delete(projectPath)
        console.warn(`[watcher] CLOSE-ERROR ${projectPath}:`, err)
      })
    } else if (!projectPath) {
      const fdBefore = fdCount()
      console.log(`[watcher] CLOSE-ALL ${watchers.size} watchers, fds=${fdBefore}`)
      for (const [p, w] of watchers) {
        w.close().catch((err: unknown) => {
          console.warn(`[watcher] close error for ${p}:`, err)
        })
      }
      watchers.clear()
    }
  })
}

/** Close all watchers. Called on app exit only. */
export function closeWatcher(): void {
  for (const w of watchers.values()) w.close()
  watchers.clear()
}
