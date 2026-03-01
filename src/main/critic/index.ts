import { ipcMain, BrowserWindow } from 'electron'
import { isValidPath } from '../validate'
import { getSecureToken, setSecureToken, deleteSecureToken } from '../services/secure-storage'
import { getCriticConfig, setCriticConfig } from './config-store'
import { startPlanReview, startResultReview, getActiveRun, abortRun, completeRun } from './engine'
import { collectDiagnostics } from './diagnostics'
import { listRuns, loadArtifact } from './artifact-store'
import { setupPlanDetector, registerPtyForDetection, unregisterPtyForDetection } from './plan-detector'

export function setupCriticHandlers(getWindow: () => BrowserWindow | null): void {
  // Plan detection
  setupPlanDetector(getWindow)

  // Config (non-sensitive)
  ipcMain.handle('critic:getConfig', (_e, projectPath: string) => {
    if (!isValidPath(projectPath)) return { error: 'Invalid path' }
    return getCriticConfig(projectPath)
  })
  ipcMain.handle('critic:setConfig', (_e, projectPath: string, config: any) => {
    if (!isValidPath(projectPath)) return { error: 'Invalid path' }
    setCriticConfig(projectPath, config)
    return { ok: true }
  })

  // API key (secure storage — main process reads internally, never exposes raw key in IPC)
  ipcMain.handle('critic:hasApiKey', () => !!getSecureToken('critic_openai'))
  ipcMain.handle('critic:setApiKey', (_e, key: string) => {
    if (key) setSecureToken('critic_openai', key)
    else deleteSecureToken('critic_openai')
    return { ok: true }
  })

  // PTY registration for plan detection
  ipcMain.on('critic:registerPty', (_e, ptyId: string, tabId: string, projectPath: string) => {
    registerPtyForDetection(ptyId, tabId, projectPath)
  })
  ipcMain.on('critic:unregisterPty', (_e, ptyId: string) => {
    unregisterPtyForDetection(ptyId)
  })

  // Reviews (tabId required for per-tab isolation)
  ipcMain.handle('critic:reviewPlan', async (_e, tabId: string, projectPath: string, planText: string, ctx: string) => {
    if (!isValidPath(projectPath)) return { error: 'Invalid path' }
    try { return await startPlanReview(getWindow, tabId, projectPath, planText, ctx) }
    catch (err) { return { error: (err as Error).message } }
  })
  ipcMain.handle('critic:reviewResult', async (_e, tabId: string, projectPath: string, diff: string, diag: any, ctx: string) => {
    if (!isValidPath(projectPath)) return { error: 'Invalid path' }
    try { return await startResultReview(getWindow, tabId, projectPath, diff, diag, ctx) }
    catch (err) { return { error: (err as Error).message } }
  })

  // Run management
  ipcMain.handle('critic:getActiveRun', (_e, tabId: string) => getActiveRun(tabId))
  ipcMain.handle('critic:abort', (_e, tabId: string) => { abortRun(tabId); return { ok: true } })
  ipcMain.handle('critic:complete', (_e, tabId: string) => { completeRun(tabId); return { ok: true } })

  // Diagnostics
  ipcMain.handle('critic:collectDiagnostics', async (_e, p: string) => {
    if (!isValidPath(p)) return { error: 'Invalid path' }
    return collectDiagnostics(p)
  })

  // History
  ipcMain.handle('critic:listRuns', (_e, p: string) => listRuns(p))
  ipcMain.handle('critic:loadRun', (_e, p: string, runId: string) => loadArtifact(p, runId))
}
