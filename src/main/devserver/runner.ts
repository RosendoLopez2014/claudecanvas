/**
 * Dev Server Runner — reliable process manager.
 *
 * One running process per project path. Strong lifecycle:
 *   start → wait for "ready" → running
 *   stop → SIGTERM → SIGKILL after timeout
 *   restart → stop then start
 *
 * Readiness detection:
 *   1. Scan stdout/stderr for URL patterns (localhost:PORT)
 *   2. Fall back to HTTP HEAD probing common ports
 *
 * NEVER uses shell: true. All commands are pre-validated SafeCommands.
 */
import { spawn, execFileSync, ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { join, basename } from 'path'
import { BrowserWindow, net } from 'electron'
import treeKill from 'tree-kill'
import type { DevServerPlan, SafeCommand } from '../../shared/devserver/types'
import { validatePlan, commandToString } from '../../shared/devserver/types'
import { recordSuccess, recordFailure } from './config-store'
import {
  DEV_SERVER_STARTUP_TIMEOUT_MS,
  DEV_SERVER_PROBE_PORTS,
  CRASH_LOOP_MAX,
  CRASH_LOOP_WINDOW_MS,
  DEV_KILL_TIMEOUT_MS,
} from '../../shared/constants'

// ── Types ─────────────────────────────────────────────────────────

export type RunnerStatus = 'configuring' | 'ready' | 'starting' | 'installing' | 'running' | 'error' | 'stopping'

export interface RunnerState {
  status: RunnerStatus
  url: string | null
  pid: number | null
  lastError: string | null
  plan: DevServerPlan | null
}

export interface StartResult {
  url?: string | null
  error?: string
  pid?: number
}

// ── State ─────────────────────────────────────────────────────────

const processes = new Map<string, ChildProcess>()
const urls = new Map<string, string>()
const starting = new Set<string>()
const crashHistory = new Map<string, number[]>()

// ── Logging ───────────────────────────────────────────────────────

function log(cwd: string, msg: string) {
  console.log(`[devserver] START [${basename(cwd)}] ${msg}`)
}
function warn(cwd: string, msg: string) {
  console.warn(`[devserver] FAIL [${basename(cwd)}] ${msg}`)
}

// ── Environment ───────────────────────────────────────────────────

function getShellEnv(): Record<string, string> {
  const env = { ...process.env, BROWSER: 'none' } as Record<string, string>
  const extraPaths = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    `${process.env.HOME}/.nvm/current/bin`,
    `${process.env.HOME}/.volta/bin`,
    `${process.env.HOME}/.fnm/current/bin`,
    '/usr/local/share/npm/bin',
  ]
  const currentPath = env.PATH || '/usr/bin:/bin'
  const missing = extraPaths.filter((p) => !currentPath.includes(p))
  if (missing.length > 0) {
    env.PATH = [...missing, currentPath].join(':')
  }
  return env
}

// ── Crash Loop Detection ──────────────────────────────────────────

function recordCrash(cwd: string): void {
  const now = Date.now()
  const history = crashHistory.get(cwd) || []
  history.push(now)
  const cutoff = now - CRASH_LOOP_WINDOW_MS
  crashHistory.set(cwd, history.filter((t) => t > cutoff))
}

function isInCrashLoop(cwd: string): boolean {
  const history = crashHistory.get(cwd) || []
  const cutoff = Date.now() - CRASH_LOOP_WINDOW_MS
  return history.filter((t) => t > cutoff).length >= CRASH_LOOP_MAX
}

export function clearCrashHistory(cwd: string): void {
  crashHistory.delete(cwd)
}

// ── Error Classification ──────────────────────────────────────────

function detectError(output: string): 'missing-deps' | 'port-in-use' | 'ebadf' | null {
  const lower = output.toLowerCase()
  if (lower.includes('ebadf') || lower.includes('bad file descriptor')) return 'ebadf'
  if (
    lower.includes('cannot find module') ||
    lower.includes('module not found') ||
    lower.includes('err_module_not_found') ||
    lower.includes('could not resolve') ||
    (lower.includes('enoent') && lower.includes('node_modules'))
  ) return 'missing-deps'
  if (lower.includes('eaddrinuse') || (lower.includes('port') && lower.includes('already in use'))) return 'port-in-use'
  return null
}

function extractPort(output: string): number | null {
  const match = output.match(/(?:port\s+|:)(\d{4,5})/i)
  return match ? parseInt(match[1], 10) : null
}

// ── Port Management ───────────────────────────────────────────────

function killPort(port: number): boolean {
  try {
    const pid = execFileSync('lsof', ['-ti', `:${port}`], { encoding: 'utf-8' }).trim()
    if (pid) {
      execFileSync('kill', ['-9', pid])
      return true
    }
  } catch { /* No process on port */ }
  return false
}

// ── URL Probe Fallback ────────────────────────────────────────────

async function probeForUrl(ports: number[]): Promise<string | null> {
  const timeout = 2000
  const results = await Promise.allSettled(
    ports.map(
      (port) =>
        new Promise<string>((resolve, reject) => {
          const url = `http://localhost:${port}`
          const req = net.request({ url, method: 'HEAD' })
          const timer = setTimeout(() => { req.abort(); reject(new Error('timeout')) }, timeout)
          req.on('response', (res) => {
            clearTimeout(timer)
            res.statusCode !== undefined ? resolve(url) : reject(new Error('no status'))
          })
          req.on('error', (err) => { clearTimeout(timer); reject(err) })
          req.end()
        })
    )
  )
  for (const r of results) {
    if (r.status === 'fulfilled') return r.value
  }
  return null
}

// ── Reliable Process Kill ─────────────────────────────────────────

function reliableTreeKill(pid: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let resolved = false
    const done = () => { if (resolved) return; resolved = true; resolve() }

    treeKill(pid, 'SIGTERM', (err) => {
      if (err) treeKill(pid, 'SIGKILL', () => done())
    })
    setTimeout(() => { if (!resolved) treeKill(pid, 'SIGKILL', () => done()) }, DEV_KILL_TIMEOUT_MS)
    setTimeout(done, DEV_KILL_TIMEOUT_MS + 2000)
  })
}

// ── Dependency Install ────────────────────────────────────────────

function installDeps(
  cwd: string,
  pm: string,
  sendOutput: (data: string) => void,
  sendStatus: (stage: string, message: string) => void,
): Promise<boolean> {
  return new Promise((resolve) => {
    log(cwd, `Installing dependencies with ${pm}...`)
    sendStatus('installing', `Running ${pm} install...`)

    // npm/pnpm/yarn/bun install — safe: no shell, known binary + known arg
    const proc = spawn(pm, ['install'], { cwd, shell: false, env: getShellEnv() })

    proc.stdout?.on('data', (data: Buffer) => sendOutput(data.toString()))
    proc.stderr?.on('data', (data: Buffer) => sendOutput(data.toString()))
    proc.on('exit', (code) => {
      log(cwd, `Dependency install exited (code=${code})`)
      resolve(code === 0)
    })
    proc.on('error', (err) => {
      warn(cwd, `Dependency install spawn error: ${err.message}`)
      resolve(false)
    })
  })
}

// ── Server Spawn ──────────────────────────────────────────────────

function spawnServer(
  plan: DevServerPlan,
  sendOutput: (data: string) => void,
): Promise<{ url: string | null; exitedEarly: boolean; stderr: string; process: ChildProcess | null }> {
  return new Promise((resolve) => {
    // CRITICAL: validate plan before spawning
    const validation = validatePlan(plan)
    if (!validation.ok) {
      warn(plan.cwd, `Plan validation failed: ${validation.error}`)
      resolve({ url: null, exitedEarly: true, stderr: `Validation error: ${validation.error}`, process: null })
      return
    }

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

    const cmdStr = commandToString(plan.command)
    log(plan.cwd, `Spawning: ${cmdStr} (shell: false)`)

    try {
      // NEVER shell: true — command is pre-validated SafeCommand
      // Use spawnCwd when the project has a nested app directory
      child = spawn(plan.command.bin, plan.command.args, {
        cwd: plan.spawnCwd || plan.cwd,
        shell: false,
        env: getShellEnv(),
      })
    } catch (err) {
      stderrBuf = `Failed to spawn process: ${err}`
      exitedEarly = true
      warn(plan.cwd, `Spawn failed: ${err}`)
      finish(null)
      return
    }

    log(plan.cwd, `Process started (pid=${child.pid})`)

    const checkOutput = (data: Buffer) => {
      const text = data.toString()
      const match = text.match(urlPattern)
      if (match) {
        log(plan.cwd, `URL detected: ${match[0]}`)
        finish(match[0])
      }
    }

    child.stdout?.on('data', (data: Buffer) => {
      checkOutput(data)
      sendOutput(data.toString())
    })
    child.stderr?.on('data', (data: Buffer) => {
      stderrBuf += data.toString()
      checkOutput(data)
      sendOutput(data.toString())
    })
    child.on('error', (err) => {
      stderrBuf += `\nProcess error: ${err.message}`
      exitedEarly = true
      processes.delete(plan.cwd)
      warn(plan.cwd, `Process error: ${err.message}`)
      finish(null)
    })
    child.on('exit', (code) => {
      exitedEarly = true
      processes.delete(plan.cwd)
      urls.delete(plan.cwd)
      log(plan.cwd, `Process exited (code=${code})`)
      finish(null)
    })

    setTimeout(() => finish(null), DEV_SERVER_STARTUP_TIMEOUT_MS)
  })
}

// ── Public API ────────────────────────────────────────────────────

export function isRunning(cwd: string): boolean {
  return processes.has(cwd)
}

export function getUrl(cwd: string): string | null {
  return urls.get(cwd) || null
}

export function getStatus(cwd: string): { running: boolean; url: string | null } {
  return { running: processes.has(cwd), url: urls.get(cwd) || null }
}

export async function start(
  plan: DevServerPlan,
  getWindow: () => BrowserWindow | null,
): Promise<StartResult> {
  const cwd = plan.cwd
  const sendOutput = (data: string) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send('dev:output', { cwd, data })
  }
  const sendStatus = (stage: string, message: string, url?: string) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send('dev:status', { stage, message, url, cwd })
  }
  const sendExit = (code: number | null) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send('dev:exit', { cwd, code })
  }

  if (processes.has(cwd)) {
    log(cwd, 'Already running')
    return { error: 'Dev server already running for this project' }
  }
  if (starting.has(cwd)) {
    log(cwd, 'Already starting')
    return { error: 'Dev server is already starting for this project' }
  }
  if (isInCrashLoop(cwd)) {
    warn(cwd, `Crash loop detected — refusing restart`)
    sendStatus('error', 'Crash loop detected — fix errors before retrying')
    return { error: `Dev server crashed ${CRASH_LOOP_MAX} times in the last ${CRASH_LOOP_WINDOW_MS / 1000}s. Fix errors first.` }
  }

  starting.add(cwd)

  try {
    const MAX_RETRIES = 3
    const cmdStr = commandToString(plan.command)
    log(cwd, `Starting: ${cmdStr}`)

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      sendStatus(attempt === 0 ? 'starting' : 'retrying',
        attempt === 0 ? 'Starting dev server...' : `Retrying... (attempt ${attempt + 1})`)

      const result = await spawnServer(plan, sendOutput)

      // Success
      if (result.url) {
        if (result.process) processes.set(cwd, result.process)
        urls.set(cwd, result.url)
        crashHistory.delete(cwd)

        // Record success in persistent store
        recordSuccess(cwd, plan.command, plan.port, plan.detection.framework, plan.detection.script, plan.spawnCwd)

        // Re-attach exit handler for post-start crashes
        if (result.process) {
          result.process.removeAllListeners('exit')
          result.process.on('exit', (code) => {
            processes.delete(cwd)
            urls.delete(cwd)
            log(cwd, `Process exited post-start (code=${code})`)
            if (code !== 0 && code !== null) recordCrash(cwd)
            sendExit(code)
          })
        }

        log(cwd, `READY at ${result.url}`)
        sendStatus('ready', 'Dev server ready', result.url)
        return { url: result.url, pid: result.process?.pid }
      }

      // Exited early — try self-heal
      if (result.exitedEarly && attempt < MAX_RETRIES) {
        const errType = detectError(result.stderr)

        if (errType === 'ebadf') {
          log(cwd, `EBADF on attempt ${attempt + 1} — retrying in 500ms`)
          sendStatus('retrying', 'File descriptor error — retrying...')
          await new Promise((r) => setTimeout(r, 500))
          continue
        }

        if (errType === 'missing-deps') {
          sendStatus('installing', 'Dependencies missing — installing...')
          const installed = await installDeps(plan.spawnCwd || cwd, plan.manager, sendOutput, sendStatus)
          if (!installed) {
            sendStatus('error', 'Failed to install dependencies')
            recordFailure(cwd, 'Dependency installation failed')
            return { error: 'Dependency installation failed.' }
          }
          continue
        }

        if (errType === 'port-in-use') {
          const port = extractPort(result.stderr)
          if (port) {
            log(cwd, `Port ${port} in use — killing occupant`)
            sendStatus('starting', `Port ${port} in use — freeing it...`)
            killPort(port)
            await new Promise((r) => setTimeout(r, 1000))
            continue
          }
        }

        // Unknown crash
        recordCrash(cwd)
        const errMsg = `Dev server crashed on startup.\n\n${result.stderr.slice(0, 500)}`
        warn(cwd, `Crashed on attempt ${attempt + 1}`)
        sendStatus('error', 'Dev server crashed on startup')
        recordFailure(cwd, errMsg)
        return { error: errMsg }
      }

      // URL not detected but process may still be running — probe
      if (!result.exitedEarly && !result.url) {
        log(cwd, 'URL not detected — probing common ports...')

        const detectedPort = extractPort(result.stderr)
        const probePorts = detectedPort
          ? [detectedPort, ...DEV_SERVER_PROBE_PORTS.filter((p) => p !== detectedPort)]
          : plan.port
            ? [plan.port, ...DEV_SERVER_PROBE_PORTS.filter((p) => p !== plan.port)]
            : [...DEV_SERVER_PROBE_PORTS]

        const probeUrl = await probeForUrl(probePorts)

        if (result.process) {
          processes.set(cwd, result.process)

          // Attach exit handler
          result.process.removeAllListeners('exit')
          result.process.on('exit', (code) => {
            processes.delete(cwd)
            urls.delete(cwd)
            log(cwd, `Process exited post-start (code=${code})`)
            if (code !== 0 && code !== null) recordCrash(cwd)
            sendExit(code)
          })
        }

        if (probeUrl) {
          log(cwd, `READY via probe: ${probeUrl}`)
          urls.set(cwd, probeUrl)
          crashHistory.delete(cwd)
          recordSuccess(cwd, plan.command, plan.port, plan.detection.framework, plan.detection.script, plan.spawnCwd)
          sendStatus('ready', 'Dev server ready', probeUrl)
          return { url: probeUrl, pid: result.process?.pid }
        }

        warn(cwd, 'Server running but URL not detected')
        sendStatus('ready', 'Server started (URL not detected)')
        return { pid: result.process?.pid }
      }
    }

    sendStatus('error', 'Failed after retries')
    recordFailure(cwd, 'Failed after maximum retries')
    return { error: 'Could not start the dev server after multiple attempts.' }
  } finally {
    starting.delete(cwd)
  }
}

export async function stop(cwd: string): Promise<void> {
  if (processes.has(cwd)) {
    const proc = processes.get(cwd)!
    log(cwd, `STOP (pid=${proc.pid})`)
    if (proc.pid) await reliableTreeKill(proc.pid)
    processes.delete(cwd)
    urls.delete(cwd)
    log(cwd, 'Stopped')
  }
}

export async function stopAll(): Promise<void> {
  console.log('[devserver] STOP ALL')
  const kills = Array.from(processes.entries())
    .filter(([, p]) => p.pid)
    .map(([path, p]) => { log(path, `Shutting down (pid=${p.pid})`); return reliableTreeKill(p.pid!) })
  await Promise.allSettled(kills)
  processes.clear()
  urls.clear()
  console.log('[devserver] All stopped')
}

export function emergencyKillAll(): void {
  for (const [path, proc] of processes) {
    if (proc.pid) {
      log(path, `Emergency kill (pid=${proc.pid})`)
      treeKill(proc.pid, 'SIGKILL')
    }
  }
  processes.clear()
  urls.clear()
  crashHistory.clear()
}
