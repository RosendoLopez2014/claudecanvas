import { spawn, IPty } from 'node-pty'
import { ipcMain, BrowserWindow } from 'electron'
import { platform } from 'os'
import { existsSync } from 'fs'
import { randomUUID } from 'crypto'
import { getMcpPort } from './mcp/server'
import { getSecureToken } from './services/secure-storage'
import * as path from 'path'
import { PTY_BUFFER_BATCH_MS } from '../shared/constants'

const ptys = new Map<string, IPty>()
const closingPtys = new Set<string>()

// Expose PTY count for EBADF diagnostics (read by git.ts via globalThis)
;(globalThis as any).__ptyCount = () => ptys.size
;(globalThis as any).__ptyClosingCount = () => closingPtys.size

// Expose PTY churn timestamp for git spawn gate (read by git.ts via globalThis)
// Updated on every PTY spawn, kill, and exit so git can delay spawns during FD churn.
;(globalThis as any).__lastPtyChurnTime = 0

function markPtyChurn(): void {
  ;(globalThis as any).__lastPtyChurnTime = Date.now()
}

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

    const id = `pty-${randomUUID()}`

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
        const ghToken = getSecureToken('github')
        const vercelToken = getSecureToken('vercel')
        const supabaseRaw = getSecureToken('supabase')
        if (ghToken) env.GH_TOKEN = ghToken
        if (vercelToken) env.VERCEL_TOKEN = vercelToken
        if (supabaseRaw) {
          // Parse access token from compound format
          try { const p = JSON.parse(supabaseRaw) as { accessToken?: string }; env.SUPABASE_ACCESS_TOKEN = p.accessToken || supabaseRaw } catch { env.SUPABASE_ACCESS_TOKEN = supabaseRaw }
        }
        return env
      })()
    })

    ptys.set(id, ptyProcess)
    markPtyChurn()
    console.log(`[pty] SPAWN ${id} (pid=${ptyProcess.pid}, total=${ptys.size})`)

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
      const wasClosing = closingPtys.delete(id)
      markPtyChurn()
      console.log(`[pty] EXIT ${id} (code=${exitCode}, wasClosing=${wasClosing}, remaining=${ptys.size - 1})`)
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send(`pty:exit:${id}`, exitCode)
      }
      ptys.delete(id)
    })

    return id
  })

  ipcMain.on('pty:write', (_event, id: string, data: string) => {
    if (closingPtys.has(id)) return
    try {
      ptys.get(id)?.write(data)
    } catch (err) {
      // PTY may have been killed between lookup and write (race with exit)
      if ((err as NodeJS.ErrnoException).code !== 'EBADF') {
        console.error('Unhandled pty write error', err)
      }
    }
  })

  ipcMain.on('pty:resize', (_event, id: string, cols: number, rows: number) => {
    if (closingPtys.has(id)) return
    ptys.get(id)?.resize(cols, rows)
  })

  ipcMain.on('pty:kill', (_event, id: string) => {
    const pty = ptys.get(id)
    if (pty && !closingPtys.has(id)) {
      closingPtys.add(id)
      markPtyChurn()
      console.log(`[pty] KILL ${id} (pid=${pty.pid}, total=${ptys.size}, closing=${closingPtys.size})`)
      pty.kill()

      // Escalate to SIGKILL if process doesn't exit within 5s
      const killTimer = setTimeout(() => {
        if (ptys.has(id)) {
          console.warn(`[pty] SIGKILL escalation for ${id} (pid=${pty.pid}) — process ignored SIGTERM`)
          try { pty.kill('SIGKILL') } catch {}
          // Final failsafe: forcibly remove from map after 2s more
          setTimeout(() => {
            if (ptys.has(id)) {
              console.warn(`[pty] Force-removing stale PTY ${id} from map`)
              ptys.delete(id)
              closingPtys.delete(id)
            }
          }, 2000)
        }
      }, 5000)

      // Clear timer if process exits normally
      pty.onExit(() => clearTimeout(killTimer))
    }
  })

  ipcMain.on('pty:setCwd', (_event, id: string, cwd: string) => {
    ptys.get(id)?.write(`cd ${JSON.stringify(cwd)}\r`)
  })
}

export function killAllPtys(): void {
  for (const [id, pty] of ptys) {
    closingPtys.add(id)
    try { pty.kill() } catch {}
  }
  // Force SIGKILL after brief delay for any stragglers during app shutdown
  setTimeout(() => {
    for (const [, pty] of ptys) {
      try { pty.kill('SIGKILL') } catch {}
    }
    ptys.clear()
    closingPtys.clear()
  }, 1000)
}
