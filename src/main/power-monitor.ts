/**
 * Power Monitor — keep sessions alive through sleep and recover on wake.
 *
 * Two layers of protection:
 *
 * 1. PREVENTION: `powerSaveBlocker.start('prevent-app-suspension')` tells macOS
 *    not to App-Nap or suspend our process when the screen locks / display sleeps.
 *    This keeps PTY child processes (shell + Claude CLI) alive through idle timeouts.
 *
 * 2. RECOVERY: On full system sleep/wake (lid close), the kernel freezes everything.
 *    Network connections drop but processes resume. We health-check dev servers
 *    on wake and notify the renderer so it can reconnect a dead PTY if needed.
 */
import { powerMonitor, powerSaveBlocker, BrowserWindow } from 'electron'
import { getRunningUrls, stop } from './devserver/runner'
import { checkHealth } from './devserver/health-check'
import { RESUME_HEALTH_CHECK_DELAY_MS } from '../shared/constants'

let suspended = false
let powerSaveId: number | null = null

export function setupPowerMonitor(getWindow: () => BrowserWindow | null): void {
  // ── Layer 1: Prevent App Nap / app suspension ──────────────────
  // This is the primary defense — keeps the Electron main process and all
  // child processes (PTY, dev servers) alive when the display sleeps or
  // the user switches away. Without this, macOS may throttle or freeze
  // the app after a few minutes of inactivity.
  powerSaveId = powerSaveBlocker.start('prevent-app-suspension')
  console.log(`[power] App suspension blocker started (id=${powerSaveId})`)

  // ── Layer 2: Sleep/wake detection and recovery ─────────────────
  powerMonitor.on('suspend', () => {
    suspended = true
    console.log('[power] System suspending (full sleep)')
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('system:suspend')
    }
  })

  powerMonitor.on('resume', async () => {
    suspended = false
    console.log('[power] System resumed — scheduling health checks')
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('system:resume')
    }

    // Give the OS time to re-establish networking and wake child processes
    await new Promise((r) => setTimeout(r, RESUME_HEALTH_CHECK_DELAY_MS))

    // Health-check all running dev servers
    const running = getRunningUrls()
    if (running.size === 0) return

    console.log(`[power] Health-checking ${running.size} dev server(s)`)
    for (const [cwd, url] of running) {
      try {
        const result = await checkHealth(url, { retries: 2, retryDelayMs: 500 })
        if (result.healthy) {
          console.log(`[power] Dev server healthy: ${url} (${result.latencyMs}ms)`)
        } else {
          console.warn(`[power] Dev server unhealthy: ${url} — ${result.error}`)
          // Kill the zombie process and let the crash handler + self-healing loop restart it
          await stop(cwd)
          console.log(`[power] Killed unhealthy dev server for ${cwd} — self-healing loop will restart`)
        }
      } catch (err) {
        console.error(`[power] Health check error for ${cwd}:`, err)
      }
    }
  })
}

export function stopPowerSaveBlocker(): void {
  if (powerSaveId !== null && powerSaveBlocker.isStarted(powerSaveId)) {
    powerSaveBlocker.stop(powerSaveId)
    console.log(`[power] App suspension blocker stopped (id=${powerSaveId})`)
    powerSaveId = null
  }
}

export function isSuspended(): boolean {
  return suspended
}
