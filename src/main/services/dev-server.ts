import { spawn, execFileSync, ChildProcess } from 'child_process'
import { ipcMain, BrowserWindow, net } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import treeKill from 'tree-kill'
import {
  DEV_SERVER_STARTUP_TIMEOUT_MS,
  DEV_SERVER_PROBE_PORTS,
  CRASH_LOOP_MAX,
  CRASH_LOOP_WINDOW_MS,
  DEV_KILL_TIMEOUT_MS,
} from '../../shared/constants'
import { detectPackageManager } from './framework-detect'
import { isValidPath } from '../validate'

// ── State ────────────────────────────────────────────────────────────
const devProcesses = new Map<string, ChildProcess>()
const devUrls = new Map<string, string>()
const startingCwds = new Set<string>()
/** Crash timestamps per project — for crash loop detection. */
const crashHistory = new Map<string, number[]>()

type StatusStage = 'starting' | 'installing' | 'retrying' | 'ready' | 'error' | 'killing-port'

// ── Logging ──────────────────────────────────────────────────────────
function log(cwd: string, message: string) {
  const name = cwd.split('/').pop() || cwd
  console.log(`[dev-server] [${name}] ${message}`)
}
function warn(cwd: string, message: string) {
  const name = cwd.split('/').pop() || cwd
  console.warn(`[dev-server] [${name}] ${message}`)
}

// ── Helpers ──────────────────────────────────────────────────────────
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

function detectError(output: string): 'missing-deps' | 'port-in-use' | 'ebadf' | null {
  const lower = output.toLowerCase()
  if (lower.includes('ebadf') || lower.includes('bad file descriptor')) {
    return 'ebadf'
  }
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

// ── Crash Loop Detection ─────────────────────────────────────────────
function recordCrash(cwd: string): void {
  const now = Date.now()
  const history = crashHistory.get(cwd) || []
  history.push(now)
  // Prune entries older than the window
  const cutoff = now - CRASH_LOOP_WINDOW_MS
  const recent = history.filter((t) => t > cutoff)
  crashHistory.set(cwd, recent)
}

function isInCrashLoop(cwd: string): boolean {
  const history = crashHistory.get(cwd) || []
  const cutoff = Date.now() - CRASH_LOOP_WINDOW_MS
  const recent = history.filter((t) => t > cutoff)
  return recent.length >= CRASH_LOOP_MAX
}

function clearCrashHistory(cwd: string): void {
  crashHistory.delete(cwd)
}

// ── URL Probe Fallback ───────────────────────────────────────────────
/**
 * When stdout URL detection times out, probe common ports via HTTP HEAD
 * to find a running dev server. Returns the first responding URL or null.
 */
async function probeForUrl(ports: number[]): Promise<string | null> {
  const timeout = 2000
  const results = await Promise.allSettled(
    ports.map(
      (port) =>
        new Promise<string>((resolve, reject) => {
          const url = `http://localhost:${port}`
          const req = net.request({ url, method: 'HEAD' })
          const timer = setTimeout(() => {
            req.abort()
            reject(new Error('timeout'))
          }, timeout)
          req.on('response', (res) => {
            clearTimeout(timer)
            // Any HTTP response (even 404) means a server is listening
            if (res.statusCode !== undefined) {
              resolve(url)
            } else {
              reject(new Error('no status'))
            }
          })
          req.on('error', (err) => {
            clearTimeout(timer)
            reject(err)
          })
          req.end()
        })
    )
  )

  for (const r of results) {
    if (r.status === 'fulfilled') return r.value
  }
  return null
}

// ── Reliable Process Kill ────────────────────────────────────────────
/**
 * Kill a process tree: SIGTERM first, then SIGKILL after timeout.
 * Returns once the process is confirmed dead.
 */
function reliableTreeKill(pid: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let resolved = false
    const done = () => {
      if (resolved) return
      resolved = true
      resolve()
    }

    // First try SIGTERM (graceful)
    treeKill(pid, 'SIGTERM', (err) => {
      if (err) {
        // SIGTERM failed (maybe already dead) — try SIGKILL
        treeKill(pid, 'SIGKILL', () => done())
        return
      }
    })

    // Escalate to SIGKILL after timeout
    setTimeout(() => {
      if (resolved) return
      treeKill(pid, 'SIGKILL', () => done())
    }, DEV_KILL_TIMEOUT_MS)

    // Also resolve after a generous max wait even if kill callbacks don't fire
    setTimeout(done, DEV_KILL_TIMEOUT_MS + 2000)
  })
}

// ── Dependency Install ───────────────────────────────────────────────
function installDeps(cwd: string, getWindow: () => BrowserWindow | null): Promise<boolean> {
  return new Promise((resolve) => {
    const packageManager = detectPackageManager(cwd)

    log(cwd, `Installing dependencies with ${packageManager}...`)
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

    proc.on('exit', (code) => {
      log(cwd, `Dependency install exited with code ${code}`)
      resolve(code === 0)
    })
  })
}

// ── Types ────────────────────────────────────────────────────────────
interface StartResult {
  url?: string | null
  error?: string
  pid?: number
}

// ── Environment ──────────────────────────────────────────────────────
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

// ── Server Spawn ─────────────────────────────────────────────────────
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

    log(cwd, `Spawning: ${command}`)

    try {
      child = spawn(bin, args, {
        cwd,
        shell: true,
        env: getShellEnv()
      })
    } catch (err) {
      stderrBuf = `Failed to spawn process: ${err}`
      exitedEarly = true
      warn(cwd, `Spawn failed: ${err}`)
      finish(null)
      return
    }

    log(cwd, `Process started (pid=${child.pid})`)

    const checkOutput = (data: Buffer) => {
      const text = data.toString()
      const match = text.match(urlPattern)
      if (match) {
        log(cwd, `URL detected from stdout: ${match[0]}`)
        finish(match[0])
      }
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
      warn(cwd, `Process error: ${err.message}`)
      finish(null)
    })

    child.on('exit', (code) => {
      exitedEarly = true
      devProcesses.delete(cwd)
      devUrls.delete(cwd)
      log(cwd, `Process exited (code=${code})`)
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('dev:exit', { cwd, code })
      }
      finish(null)
    })

    setTimeout(() => finish(null), DEV_SERVER_STARTUP_TIMEOUT_MS)
  })
}

// ── IPC Handlers ─────────────────────────────────────────────────────
export function setupDevServerHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('dev:start', async (_event, cwd: string, command?: string): Promise<StartResult> => {
    if (!isValidPath(cwd)) return { error: 'Invalid project path' }
    if (devProcesses.has(cwd)) {
      log(cwd, 'Already running — returning existing')
      return { error: 'Dev server already running for this project' }
    }
    if (startingCwds.has(cwd)) {
      log(cwd, 'Already starting — skipping')
      return { error: 'Dev server is already starting for this project' }
    }

    // Crash loop protection
    if (isInCrashLoop(cwd)) {
      warn(cwd, `Crash loop detected (${CRASH_LOOP_MAX} crashes in ${CRASH_LOOP_WINDOW_MS / 1000}s) — refusing restart`)
      sendStatus(getWindow, 'error', 'Crash loop detected — fix errors before retrying', undefined, cwd)
      return {
        error: `Dev server crashed ${CRASH_LOOP_MAX} times in the last ${CRASH_LOOP_WINDOW_MS / 1000} seconds. Fix project errors before trying again.`
      }
    }

    startingCwds.add(cwd)

    try {
      const cmd = command || 'npm run dev'
      const MAX_RETRIES = 3

      log(cwd, `Starting with command: ${cmd}`)

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
          devUrls.set(cwd, result.url)
          clearCrashHistory(cwd)
          log(cwd, `Ready at ${result.url}`)
          sendStatus(getWindow, 'ready', 'Dev server ready', result.url, cwd)
          return { url: result.url, pid: result.process?.pid }
        }

        // Server exited early — try to self-heal
        if (result.exitedEarly && attempt < MAX_RETRIES) {
          const errorType = detectError(result.stderr)

          if (errorType === 'ebadf') {
            log(cwd, `EBADF on attempt ${attempt + 1}/${MAX_RETRIES + 1}, retrying in 500ms...`)
            sendStatus(getWindow, 'retrying', 'File descriptor error — retrying...', undefined, cwd)
            await new Promise((r) => setTimeout(r, 500))
            continue
          }

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
              log(cwd, `Port ${port} in use — killing occupant`)
              sendStatus(getWindow, 'killing-port', `Port ${port} in use — freeing it...`, undefined, cwd)
              killPort(port)
              await new Promise((r) => setTimeout(r, 1000))
              continue
            }
          }

          // Unknown early exit — record crash
          recordCrash(cwd)
          warn(cwd, `Crashed on startup (attempt ${attempt + 1})`)
          sendStatus(getWindow, 'error', 'Dev server crashed on startup', undefined, cwd)
          return { error: `Dev server exited immediately. Check your project for errors.\n\nStderr:\n${result.stderr.slice(0, 500)}` }
        }

        // URL not detected but server might still be running — probe for URL
        if (!result.exitedEarly && !result.url) {
          log(cwd, 'URL not detected from stdout — probing common ports...')

          // Build probe list: detected port first, then common ports
          const detectedPort = extractPort(result.stderr)
          const probePorts = detectedPort
            ? [detectedPort, ...DEV_SERVER_PROBE_PORTS.filter((p) => p !== detectedPort)]
            : [...DEV_SERVER_PROBE_PORTS]

          const probeUrl = await probeForUrl(probePorts)

          if (result.process) {
            devProcesses.set(cwd, result.process)
          }

          if (probeUrl) {
            log(cwd, `URL found via probe: ${probeUrl}`)
            devUrls.set(cwd, probeUrl)
            clearCrashHistory(cwd)
            sendStatus(getWindow, 'ready', 'Dev server ready', probeUrl, cwd)
            return { url: probeUrl, pid: result.process?.pid }
          }

          // Probe also failed — server is running but URL unknown
          warn(cwd, 'Server running but URL not detected (stdout or probe)')
          sendStatus(getWindow, 'ready', 'Server started (URL not detected)', undefined, cwd)
          return { pid: result.process?.pid }
        }
      }

      sendStatus(getWindow, 'error', 'Failed after retries', undefined, cwd)
      return { error: 'Could not start the dev server after multiple attempts.' }
    } finally {
      startingCwds.delete(cwd)
    }
  })

  ipcMain.handle('dev:stop', async (_event, cwd?: string) => {
    if (cwd && devProcesses.has(cwd)) {
      const proc = devProcesses.get(cwd)!
      log(cwd, `Stopping server (pid=${proc.pid})...`)
      if (proc.pid) {
        await reliableTreeKill(proc.pid)
      }
      devProcesses.delete(cwd)
      devUrls.delete(cwd)
      log(cwd, 'Server stopped')
    } else if (!cwd) {
      // Stop all (app shutdown)
      console.log('[dev-server] Stopping all dev servers...')
      const kills = Array.from(devProcesses.entries())
        .filter(([, p]) => p.pid)
        .map(([path, p]) => {
          log(path, `Shutting down (pid=${p.pid})`)
          return reliableTreeKill(p.pid!)
        })
      await Promise.allSettled(kills)
      devProcesses.clear()
      devUrls.clear()
      console.log('[dev-server] All dev servers stopped')
    }
  })

  // Query running dev server for a project — used to recover state after HMR
  ipcMain.handle('dev:status', (_event, cwd: string) => {
    if (!isValidPath(cwd)) return { running: false, url: null }
    const running = devProcesses.has(cwd)
    const url = devUrls.get(cwd) || null
    return { running, url }
  })

  // Clear crash history for a project (e.g., after the user fixes their code)
  ipcMain.handle('dev:clearCrashHistory', (_event, cwd: string) => {
    if (!isValidPath(cwd)) return
    clearCrashHistory(cwd)
    log(cwd, 'Crash history cleared')
  })
}

export function killDevServer(): void {
  for (const [path, proc] of devProcesses) {
    if (proc.pid) {
      log(path, `Emergency kill (pid=${proc.pid})`)
      treeKill(proc.pid, 'SIGKILL')
    }
  }
  devProcesses.clear()
  devUrls.clear()
  crashHistory.clear()
}
