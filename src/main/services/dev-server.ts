import { spawn, ChildProcess } from 'child_process'
import { ipcMain, BrowserWindow } from 'electron'
import detectPort from 'detect-port'
import treeKill from 'tree-kill'

let devProcess: ChildProcess | null = null

export function setupDevServerHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('dev:start', async (_event, cwd: string, command?: string) => {
    if (devProcess) return { error: 'Dev server already running' }

    const cmd = command || 'npm run dev'
    const [bin, ...args] = cmd.split(' ')

    devProcess = spawn(bin, args, {
      cwd,
      shell: true,
      env: { ...process.env, BROWSER: 'none', PORT: '3000' }
    })

    // Detect the port the server starts on
    const portPromise = new Promise<number | null>((resolve) => {
      let attempts = 0
      const checkPort = async () => {
        if (attempts > 20) {
          resolve(null)
          return
        }
        attempts++
        for (let p = 3000; p <= 3010; p++) {
          const available = await detectPort(p)
          if (available !== p) {
            resolve(p)
            return
          }
        }
        setTimeout(checkPort, 500)
      }
      setTimeout(checkPort, 1000)
    })

    devProcess.stdout?.on('data', (data: Buffer) => {
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('dev:output', data.toString())
      }
    })

    devProcess.stderr?.on('data', (data: Buffer) => {
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('dev:output', data.toString())
      }
    })

    devProcess.on('exit', (code) => {
      devProcess = null
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('dev:exit', code)
      }
    })

    const port = await portPromise
    return { port, pid: devProcess?.pid, url: port ? `http://localhost:${port}` : null }
  })

  ipcMain.handle('dev:stop', () => {
    if (devProcess?.pid) {
      treeKill(devProcess.pid, 'SIGTERM')
      devProcess = null
    }
  })
}

export function killDevServer(): void {
  if (devProcess?.pid) {
    treeKill(devProcess.pid, 'SIGTERM')
    devProcess = null
  }
}
