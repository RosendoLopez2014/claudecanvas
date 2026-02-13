import { spawn, IPty } from 'node-pty'
import { ipcMain, BrowserWindow } from 'electron'
import { platform } from 'os'

const ptys = new Map<string, IPty>()
let idCounter = 0

export function setupPtyHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('pty:spawn', (_event, shell?: string) => {
    const id = `pty-${++idCounter}`
    const defaultShell =
      shell || (platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/zsh')

    const ptyProcess = spawn(defaultShell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: process.env.HOME || '/',
      env: { ...process.env } as Record<string, string>
    })

    ptys.set(id, ptyProcess)

    // Buffer PTY output and send in batches
    let buffer = ''
    let sendScheduled = false

    ptyProcess.onData((data) => {
      buffer += data
      if (!sendScheduled) {
        sendScheduled = true
        setTimeout(() => {
          const win = getWindow()
          if (win && !win.isDestroyed()) {
            win.webContents.send(`pty:data:${id}`, buffer)
          }
          buffer = ''
          sendScheduled = false
        }, 8) // ~120fps batching
      }
    })

    ptyProcess.onExit(({ exitCode }) => {
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send(`pty:exit:${id}`, exitCode)
      }
      ptys.delete(id)
    })

    return id
  })

  ipcMain.on('pty:write', (_event, id: string, data: string) => {
    ptys.get(id)?.write(data)
  })

  ipcMain.on('pty:resize', (_event, id: string, cols: number, rows: number) => {
    ptys.get(id)?.resize(cols, rows)
  })

  ipcMain.on('pty:kill', (_event, id: string) => {
    ptys.get(id)?.kill()
    ptys.delete(id)
  })

  ipcMain.on('pty:setCwd', (_event, id: string, cwd: string) => {
    ptys.get(id)?.write(`cd ${JSON.stringify(cwd)}\r`)
  })
}

export function killAllPtys(): void {
  for (const [id, pty] of ptys) {
    pty.kill()
    ptys.delete(id)
  }
}
