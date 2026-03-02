/**
 * Dev Server System — barrel file.
 *
 * Sets up IPC handlers for the new resolver + runner architecture.
 * Replaces the old src/main/services/dev-server.ts handlers.
 */
import { ipcMain, BrowserWindow } from 'electron'
import { readFileSync } from 'fs'
import { join } from 'path'
import { isValidPath } from '../validate'
import { resolveDevServerPlan, needsVerification } from './resolve'
import * as runner from './runner'
import * as configStore from './config-store'
import { parseCommandString, validatePlan, commandToString, extractScriptName } from '../../shared/devserver/types'
import type { DevServerPlan, SafeCommand } from '../../shared/devserver/types'
import { runSelfHealingLoop } from './self-healing-loop'
import { isLocked } from './repair-lock'
import { repairSessions } from './repair-session'

export function setupDevServerSystem(getWindow: () => BrowserWindow | null): void {
  // ── Wire self-healing loop to runner crash events ─────────────
  runner.setCrashHandler(({ cwd, exitCode, crashOutput, getWindow: gw }) => {
    // Skip if a repair is already in progress for this project
    if (isLocked(cwd) || repairSessions.has(cwd)) return
    runSelfHealingLoop({ cwd, exitCode, crashOutput, getWindow: gw }).catch((err) => {
      console.error('[self-heal] Loop error:', err)
    })
  })

  // ── Resolve ─────────────────────────────────────────────────────
  ipcMain.handle('devserver:resolve', (_event, projectPath: string) => {
    if (!isValidPath(projectPath)) return { error: 'Invalid project path' }
    let plan = resolveDevServerPlan(projectPath)
    // Remap subdirectory cwd for tracking (keep project root as cwd)
    if (plan.cwd !== projectPath) {
      plan = { ...plan, spawnCwd: plan.cwd, cwd: projectPath }
    }
    return {
      plan,
      needsVerification: needsVerification(plan, configStore.getDevConfig(projectPath)),
    }
  })

  // ── Start ───────────────────────────────────────────────────────
  ipcMain.handle('dev:start', async (_event, cwd: string, command?: string) => {
    if (!isValidPath(cwd)) return { error: 'Invalid project path' }

    // Guard against empty/whitespace-only command strings
    const trimmedCommand = command?.trim() || undefined

    let plan: DevServerPlan

    if (trimmedCommand) {
      // User provided a raw command string — parse and validate
      const parsed = parseCommandString(trimmedCommand)
      if (!parsed) {
        return { error: `Invalid command: "${trimmedCommand}". Only ${[...new Set(['npm', 'pnpm', 'yarn', 'bun', 'node', 'npx'])].join(', ')} are allowed.` }
      }
      plan = {
        cwd,
        manager: parsed.bin as DevServerPlan['manager'],
        command: parsed,
        confidence: 'high',
        reasons: ['User-provided command'],
        detection: {},
      }
    } else {
      // Auto-resolve — but refuse to start low-confidence plans blindly.
      // The renderer should resolve first and show a picker for low confidence.
      plan = resolveDevServerPlan(cwd)
      if (plan.confidence === 'low') {
        const cmdStr = commandToString(plan.command)
        console.log(`[devserver] Refusing auto-start: low confidence (${cmdStr})`)
        return {
          errorCode: 'DEV_COMMAND_UNRESOLVED',
          error: 'Could not auto-detect dev command. Please configure it manually.',
          needsConfiguration: true,
          plan,
        }
      }

      // Resolver may have found a subdirectory project (e.g. landio-clone/).
      // Remap: keep project root as tracking key, use subdirectory for spawning.
      if (plan.cwd !== cwd) {
        plan = { ...plan, spawnCwd: plan.cwd, cwd }
      }
    }

    const validation = validatePlan(plan)
    if (!validation.ok) {
      return { error: `Command validation failed: ${validation.error}` }
    }

    // ── Script existence check (universal safety net) ─────────────
    // If the command references a package.json script, verify it exists
    // before spawning. Catches stale caches, stale userOverrides, and
    // any other source of invalid commands regardless of how they arrived.
    const effectiveCwd = plan.spawnCwd || cwd
    const scriptName = extractScriptName(plan.command)
    if (scriptName) {
      try {
        const pkg = JSON.parse(readFileSync(join(effectiveCwd, 'package.json'), 'utf-8'))
        if (!pkg.scripts?.[scriptName]) {
          const cmdStr = commandToString(plan.command)
          console.log(`[devserver] Script "${scriptName}" not found in package.json — refusing to start (${cmdStr})`)
          // Clear stale persisted config that led us here
          configStore.clearDevConfig(cwd)
          return {
            errorCode: 'DEV_COMMAND_UNRESOLVED',
            error: `Script "${scriptName}" does not exist in package.json. Please configure the dev command.`,
            needsConfiguration: true,
            plan,
          }
        }
      } catch {
        // Can't read package.json — let the runner try and fail with a better error
      }
    }

    return runner.start(plan, getWindow)
  })

  // ── Stop ────────────────────────────────────────────────────────
  ipcMain.handle('dev:stop', async (_event, cwd?: string) => {
    if (cwd) {
      await runner.stop(cwd)
    } else {
      await runner.stopAll()
    }
  })

  // ── Status ──────────────────────────────────────────────────────
  ipcMain.handle('dev:status', (_event, cwd: string) => {
    if (!isValidPath(cwd)) return { running: false, url: null }
    return runner.getStatus(cwd)
  })

  // ── Crash History ───────────────────────────────────────────────
  ipcMain.handle('dev:clearCrashHistory', (_event, cwd: string) => {
    if (!isValidPath(cwd)) return
    runner.clearCrashHistory(cwd)
    console.log(`[devserver] Crash history cleared for ${cwd}`)
  })

  // ── Config Store ────────────────────────────────────────────────
  ipcMain.handle('devserver:setOverride', (_event, projectPath: string, commandStr: string, port?: number) => {
    if (!isValidPath(projectPath)) return { error: 'Invalid path' }
    const parsed = parseCommandString(commandStr)
    if (!parsed) return { error: `Invalid command: "${commandStr}"` }
    configStore.setUserOverride(projectPath, parsed, port)
    return { ok: true }
  })

  ipcMain.handle('devserver:clearOverride', (_event, projectPath: string) => {
    if (!isValidPath(projectPath)) return
    configStore.clearUserOverride(projectPath)
  })

  ipcMain.handle('devserver:getConfig', (_event, projectPath: string) => {
    if (!isValidPath(projectPath)) return null
    return configStore.getDevConfig(projectPath)
  })
}

/** Emergency kill on app quit. */
export function killAllDevServers(): void {
  runner.emergencyKillAll()
}
