import type { BrowserWindow } from 'electron'
import type { CriticConfig, PlanDetectedEvent } from '../../shared/critic/types'
import { CRITIC_PLAN_DETECT_DEBOUNCE_MS, CRITIC_PTY_BUFFER_MAX } from '../../shared/constants'
import { addPtyDataListener } from '../pty'
import { getCriticConfig } from './config-store'

// Per-PTY rolling buffers
const ptyBuffers = new Map<string, string>()
const ptyTimers = new Map<string, ReturnType<typeof setTimeout>>()
// Cooldown: hash of last emitted plan per ptyId + timestamp
const lastPlanHash = new Map<string, { hash: string; time: number }>()
const COOLDOWN_MS = 15_000 // don't re-emit same plan within 15s

// Track which ptyId → (tabId, projectPath) for routing events
const ptyMeta = new Map<string, { tabId: string; projectPath: string }>()

export function registerPtyForDetection(
  ptyId: string, tabId: string, projectPath: string,
): void {
  ptyMeta.set(ptyId, { tabId, projectPath })
}

export function unregisterPtyForDetection(ptyId: string): void {
  ptyMeta.delete(ptyId)
  ptyBuffers.delete(ptyId)
  lastPlanHash.delete(ptyId)
  const timer = ptyTimers.get(ptyId)
  if (timer) { clearTimeout(timer); ptyTimers.delete(ptyId) }
}

/** Cheap string hash for cooldown dedup. */
function simpleHash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return h.toString(36)
}

// Guard: only register once (prevents leaks on hot reload)
let disposer: (() => void) | null = null

export function setupPlanDetector(getWindow: () => BrowserWindow | null): () => void {
  if (disposer) return disposer // already registered

  disposer = addPtyDataListener((ptyId, data) => {
    const meta = ptyMeta.get(ptyId)
    if (!meta) return

    const config = getCriticConfig(meta.projectPath)
    if (!config.enabled) return

    // Append to rolling buffer (cap size)
    let buf = (ptyBuffers.get(ptyId) ?? '') + data
    if (buf.length > CRITIC_PTY_BUFFER_MAX) buf = buf.slice(-CRITIC_PTY_BUFFER_MAX)
    ptyBuffers.set(ptyId, buf)

    // Debounced scan
    const existing = ptyTimers.get(ptyId)
    if (existing) clearTimeout(existing)
    ptyTimers.set(ptyId, setTimeout(() => {
      ptyTimers.delete(ptyId)
      const clean = buf.replace(/\x1b\[[0-9;]*m/g, '')
      const planText = extractPlan(clean, config.planDetectionKeywords)
      if (planText) {
        const confidence = computeConfidence(planText)
        if (confidence < 0.4) return // below threshold — too noisy

        // Cooldown: skip if same plan emitted recently
        const hash = simpleHash(planText)
        const last = lastPlanHash.get(ptyId)
        if (last && last.hash === hash && Date.now() - last.time < COOLDOWN_MS) return
        lastPlanHash.set(ptyId, { hash, time: Date.now() })

        const event: PlanDetectedEvent = {
          tabId: meta.tabId,
          projectPath: meta.projectPath,
          planText,
          confidence,
        }
        const win = getWindow()
        if (win && !win.isDestroyed()) {
          win.webContents.send('critic:planDetected', event)
        }
      }
    }, CRITIC_PLAN_DETECT_DEBOUNCE_MS))
  })

  return disposer
}

function extractPlan(text: string, keywords: string[]): string | null {
  const lines = text.split('\n')
  const startIdx = lines.findIndex((l) =>
    keywords.some((kw) => l.toLowerCase().includes(kw.toLowerCase()))
  )
  if (startIdx === -1) return null

  // Boundary rules: stop at code fences, "Executing...", "I'll now implement"
  const stopPatterns = [
    /^```[a-z]*/,
    /i'll now implement/i,
    /executing\.\.\./i,
    /i'll start by/i,
    /let me (start|begin)/i,
  ]

  let endIdx = lines.length
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (stopPatterns.some((p) => p.test(lines[i]))) {
      endIdx = i
      break
    }
  }

  const plan = lines.slice(startIdx, endIdx).join('\n').trim()
  return plan.length > 50 ? plan : null
}

function computeConfidence(planText: string): number {
  let score = 0
  const lines = planText.split('\n')
  // Structural signals
  if (lines.length >= 8) score += 0.3
  if (/^\d+[\.\)]/m.test(planText)) score += 0.2  // numbered steps
  if (/^[-*]\s/m.test(planText)) score += 0.1      // bullet points
  if (/^#+\s/m.test(planText)) score += 0.2        // headings
  if (lines.length >= 15) score += 0.2
  return Math.min(1, score)
}
