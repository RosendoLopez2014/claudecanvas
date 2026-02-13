import { spawn, IPty } from 'node-pty'
import { ipcMain, BrowserWindow } from 'electron'
import { platform } from 'os'
import { getMcpPort } from './mcp/server'

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
      env: (() => {
        const env = { ...process.env } as Record<string, string>
        // Remove Claude Code session markers so Claude CLI can run inside the embedded terminal
        delete env.CLAUDECODE
        delete env.CLAUDE_CODE_SESSION
        delete env.CLAUDE_CODE_ENTRY_POINT
        // Signal to Claude Code that it's running inside Canvas
        env.CLAUDE_CANVAS = '1'
        const mcpPort = getMcpPort()
        if (mcpPort) env.CLAUDE_CANVAS_MCP_PORT = String(mcpPort)
        return env
      })()
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
