import { spawn, IPty } from 'node-pty'
import { ipcMain, BrowserWindow } from 'electron'
import { platform } from 'os'
import { existsSync } from 'fs'
import { getMcpPort } from './mcp/server'
import { settingsStore } from './store'
import * as path from 'path'
import { PTY_BUFFER_BATCH_MS } from '../shared/constants'

const ptys = new Map<string, IPty>()
let idCounter = 0

const ALLOWED_SHELLS = new Set([
  '/bin/bash', '/bin/zsh', '/bin/sh', '/bin/fish',
  '/usr/bin/bash', '/usr/bin/zsh', '/usr/bin/fish',
  '/usr/local/bin/bash', '/usr/local/bin/zsh', '/usr/local/bin/fish',
  '/opt/homebrew/bin/bash', '/opt/homebrew/bin/zsh', '/opt/homebrew/bin/fish',
  'powershell.exe', 'cmd.exe', 'pwsh.exe'
])

export function setupPtyHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('pty:spawn', (_event, shell?: string, cwd?: string) => {
    // Validate cwd if provided
    if (cwd && (!path.isAbsolute(cwd) || !existsSync(cwd))) {
      return { error: `Invalid working directory: ${cwd}` }
    }

    // Validate shell against allow-list
    const defaultShell =
      shell || (platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/zsh')
    if (shell && !ALLOWED_SHELLS.has(shell)) {
      return { error: `Shell not allowed: ${shell}` }
    }

    const id = `pty-${++idCounter}`

    const ptyProcess = spawn(defaultShell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: cwd || process.env.HOME || '/',
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
        // Inject service tokens so CLI tools use the Canvas-authenticated accounts
        const tokens = settingsStore.get('oauthTokens') || {}
        if (tokens.github) env.GH_TOKEN = tokens.github
        if (tokens.vercel) env.VERCEL_TOKEN = tokens.vercel
        if (tokens.supabase) env.SUPABASE_ACCESS_TOKEN = tokens.supabase
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
            try {
              win.webContents.send(`pty:data:${id}`, buffer)
            } catch (err) {
              console.error(`[pty] send failed for ${id} (${buffer.length} bytes):`, err)
            }
          }
          buffer = ''
          sendScheduled = false
        }, PTY_BUFFER_BATCH_MS)
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
