import { spawn, execFileSync, ChildProcess } from 'child_process'
import { ipcMain, BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import treeKill from 'tree-kill'

const devProcesses = new Map<string, ChildProcess>()

type StatusStage = 'starting' | 'installing' | 'retrying' | 'ready' | 'error' | 'killing-port'

function sendStatus(
  getWindow: () => BrowserWindow | null,
  stage: StatusStage,
  message: string,
  url?: string,
  cwd?: string
) {
  const win = getWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send('dev:status', { stage, message, url, cwd })
  }
}

function detectError(output: string): 'missing-deps' | 'port-in-use' | null {
  const lower = output.toLowerCase()
  if (
    lower.includes('cannot find module') ||
    lower.includes('module not found') ||
    lower.includes('err_module_not_found') ||
    lower.includes('could not resolve') ||
    (lower.includes('enoent') && lower.includes('node_modules'))
  ) {
    return 'missing-deps'
  }
  if (lower.includes('eaddrinuse') || (lower.includes('port') && lower.includes('already in use'))) {
    return 'port-in-use'
  }
  return null
}

function extractPort(output: string): number | null {
  const match = output.match(/(?:port\s+|:)(\d{4,5})/i)
  return match ? parseInt(match[1], 10) : null
}

function killPort(port: number): boolean {
  try {
    const pid = execFileSync('lsof', ['-ti', `:${port}`], { encoding: 'utf-8' }).trim()
    if (pid) {
      execFileSync('kill', ['-9', pid])
      return true
    }
  } catch {
    // No process on port
  }
  return false
}

function installDeps(cwd: string, getWindow: () => BrowserWindow | null): Promise<boolean> {
  return new Promise((resolve) => {
    const packageManager = existsSync(join(cwd, 'yarn.lock'))
      ? 'yarn'
      : existsSync(join(cwd, 'pnpm-lock.yaml'))
        ? 'pnpm'
        : 'npm'

    sendStatus(getWindow, 'installing', `Running ${packageManager} install...`, undefined, cwd)

    const proc = spawn(packageManager, ['install'], { cwd, shell: true, env: getShellEnv() })

    proc.stdout?.on('data', (data: Buffer) => {
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('dev:output', { cwd, data: data.toString() })
      }
    })

    proc.stderr?.on('data', (data: Buffer) => {
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('dev:output', { cwd, data: data.toString() })
      }
    })

    proc.on('exit', (code) => resolve(code === 0))
  })
}

interface StartResult {
  url?: string | null
  error?: string
  pid?: number
}

function getShellEnv(): Record<string, string> {
  const env = { ...process.env, BROWSER: 'none' } as Record<string, string>

  // Ensure PATH includes common Node.js locations (Electron GUI launches may have minimal PATH)
  const extraPaths = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    `${process.env.HOME}/.nvm/current/bin`,
    `${process.env.HOME}/.volta/bin`,
    `${process.env.HOME}/.fnm/current/bin`,
    '/usr/local/share/npm/bin'
  ]
  const currentPath = env.PATH || '/usr/bin:/bin'
  const missing = extraPaths.filter((p) => !currentPath.includes(p))
  if (missing.length > 0) {
    env.PATH = [...missing, currentPath].join(':')
  }

  return env
}

function startServer(
  cwd: string,
  command: string,
  getWindow: () => BrowserWindow | null
): Promise<{ url: string | null; exitedEarly: boolean; stderr: string; process: ChildProcess | null }> {
  return new Promise((resolve) => {
    const [bin, ...args] = command.split(' ')

    let resolved = false
    let stderrBuf = ''
    let exitedEarly = false
    let child: ChildProcess | null = null
    const urlPattern = /https?:\/\/(?:localhost|127\.0\.0\.1):\d+/

    const finish = (url: string | null) => {
      if (resolved) return
      resolved = true
      resolve({ url, exitedEarly, stderr: stderrBuf, process: child })
    }

    try {
      child = spawn(bin, args, {
        cwd,
        shell: true,
        env: getShellEnv()
      })
    } catch (err) {
      stderrBuf = `Failed to spawn process: ${err}`
      exitedEarly = true
      finish(null)
      return
    }

    const checkOutput = (data: Buffer) => {
      const text = data.toString()
      const match = text.match(urlPattern)
      if (match) finish(match[0])
    }

    child.stdout?.on('data', (data: Buffer) => {
      checkOutput(data)
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('dev:output', { cwd, data: data.toString() })
      }
    })

    child.stderr?.on('data', (data: Buffer) => {
      stderrBuf += data.toString()
      checkOutput(data)
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('dev:output', { cwd, data: data.toString() })
      }
    })

    // Handle spawn errors (e.g., ENOENT) — without this the promise hangs forever
    child.on('error', (err) => {
      stderrBuf += `\nProcess error: ${err.message}`
      exitedEarly = true
      devProcesses.delete(cwd)
      finish(null)
    })

    child.on('exit', (code) => {
      exitedEarly = true
      devProcesses.delete(cwd)
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('dev:exit', { cwd, code })
      }
      finish(null)
    })

    // Timeout after 20s
    setTimeout(() => finish(null), 20000)
  })
}

export function setupDevServerHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('dev:start', async (_event, cwd: string, command?: string): Promise<StartResult> => {
    if (devProcesses.has(cwd)) return { error: 'Dev server already running for this project' }

    const cmd = command || 'npm run dev'
    const MAX_RETRIES = 2

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt === 0) {
        sendStatus(getWindow, 'starting', 'Starting dev server...', undefined, cwd)
      } else {
        sendStatus(getWindow, 'retrying', `Retrying... (attempt ${attempt + 1})`, undefined, cwd)
      }

      const result = await startServer(cwd, cmd, getWindow)

      // Success — server is running and URL detected
      if (result.url) {
        if (result.process) {
          devProcesses.set(cwd, result.process)
        }
        sendStatus(getWindow, 'ready', 'Dev server ready', result.url, cwd)
        return { url: result.url, pid: result.process?.pid }
      }

      // Server exited early — try to self-heal
      if (result.exitedEarly && attempt < MAX_RETRIES) {
        const errorType = detectError(result.stderr)

        if (errorType === 'missing-deps') {
          sendStatus(getWindow, 'installing', 'Dependencies missing — installing...', undefined, cwd)
          const installed = await installDeps(cwd, getWindow)
          if (!installed) {
            sendStatus(getWindow, 'error', 'Failed to install dependencies', undefined, cwd)
            return { error: 'Dependency installation failed. Check the terminal for details.' }
          }
          continue
        }

        if (errorType === 'port-in-use') {
          const port = extractPort(result.stderr)
          if (port) {
            sendStatus(getWindow, 'killing-port', `Port ${port} in use — freeing it...`, undefined, cwd)
            killPort(port)
            await new Promise((r) => setTimeout(r, 1000))
            continue
          }
        }

        // Unknown early exit
        sendStatus(getWindow, 'error', 'Dev server crashed on startup', undefined, cwd)
        return { error: `Dev server exited immediately. Check your project for errors.\n\nStderr:\n${result.stderr.slice(0, 500)}` }
      }

      // URL not detected but server might still be running
      if (!result.exitedEarly && !result.url) {
        if (result.process) {
          devProcesses.set(cwd, result.process)
        }
        sendStatus(getWindow, 'error', 'Server started but URL not detected', undefined, cwd)
        return { error: 'Dev server started but no URL was detected. The server may be running — check the terminal.' }
      }
    }

    sendStatus(getWindow, 'error', 'Failed after retries', undefined, cwd)
    return { error: 'Could not start the dev server after multiple attempts.' }
  })

  ipcMain.handle('dev:stop', (_event, cwd?: string) => {
    if (cwd && devProcesses.has(cwd)) {
      const proc = devProcesses.get(cwd)!
      if (proc.pid) treeKill(proc.pid, 'SIGTERM')
      devProcesses.delete(cwd)
    } else if (!cwd) {
      // Stop all (app shutdown)
      for (const [, proc] of devProcesses) {
        if (proc.pid) treeKill(proc.pid, 'SIGTERM')
      }
      devProcesses.clear()
    }
  })
}

export function killDevServer(): void {
  for (const [, proc] of devProcesses) {
    if (proc.pid) treeKill(proc.pid, 'SIGTERM')
  }
  devProcesses.clear()
}
