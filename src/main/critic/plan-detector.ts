import type { BrowserWindow } from 'electron'
import type { CriticConfig, PlanDetectedEvent } from '../../shared/critic/types'
import { CRITIC_PLAN_DETECT_DEBOUNCE_MS, CRITIC_PTY_BUFFER_MAX } from '../../shared/constants'
import { addPtyDataListener } from '../pty'
import { getCriticConfig } from './config-store'
import { startPlanReview } from './engine'
import { engageGate, releaseGate, isGated } from './gate'
import { formatFeedbackCompact } from '../../shared/critic/format'
import { watch, existsSync, mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, basename } from 'node:path'

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

/**
 * Strip ALL ANSI escape sequences from terminal output.
 * Covers: CSI sequences (colors, cursor movement, erase), OSC (title),
 * private mode (DEC), and single-character escapes.
 */
function stripAnsi(text: string): string {
  return text
    // CSI sequences: \x1b[ ... (any params) ... (final letter)
    // Covers colors (\x1b[31m), cursor movement (\x1b[12A), erase (\x1b[2J), etc.
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    // OSC sequences: \x1b] ... (terminated by BEL \x07 or ST \x1b\\)
    .replace(/\x1b\].*?(?:\x07|\x1b\\)/g, '')
    // Single-char escapes: \x1b followed by one character (e.g., \x1b(B)
    .replace(/\x1b[()][0-9A-Z]/g, '')
    // Any remaining lone escape characters
    .replace(/\x1b/g, '')
    // Carriage returns (overwritten lines in TUI output)
    .replace(/\r/g, '')
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
      const clean = stripAnsi(buf)
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

        // Clear buffer after emitting so the next scan starts fresh.
        // Without this, the old plan stays in the buffer and extractPlan
        // finds it first on the next scan, hitting the cooldown dedup.
        ptyBuffers.set(ptyId, '')
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

// ── Plan file auto-review watcher ────────────────────────

// Track active watchers per project to prevent duplicates
const planFileWatchers = new Map<string, ReturnType<typeof watch>>()
// Debounce per file to avoid duplicate triggers from rapid writes
const planFileTimers = new Map<string, ReturnType<typeof setTimeout>>()
// Track files we've already reviewed to avoid re-reviewing on every save
const reviewedFiles = new Map<string, { mtime: number }>()
// Guard against concurrent auto-reviews
let autoReviewInFlight = false

/**
 * Markers that distinguish implementation plans from design docs/notes.
 * A file must contain at least one of these to trigger auto-review.
 */
const PLAN_MARKERS = [
  'executing-plans',        // superpowers skill reference
  '## Task',                // numbered task sections
  '### Task',
  '**Step ',                // step-by-step instructions
  'Implementation Plan',    // common plan title
]

function looksLikePlan(content: string): boolean {
  return PLAN_MARKERS.some((marker) => content.includes(marker))
}

/**
 * Watch `docs/plans/` for new implementation plan files.
 * Filters out design docs and non-plan files using content markers.
 * Auto-submits to critic engine; gate auto-releases on approve.
 */
export function setupPlanFileWatcher(
  getWindow: () => BrowserWindow | null,
  projectPath: string,
  tabId: string,
): () => void {
  const plansDir = join(projectPath, 'docs', 'plans')

  // Ensure directory exists
  if (!existsSync(plansDir)) {
    mkdirSync(plansDir, { recursive: true })
  }

  // Don't duplicate watchers for same project
  if (planFileWatchers.has(projectPath)) {
    return () => {}
  }

  const watcher = watch(plansDir, async (eventType, filename) => {
    if (!filename || !filename.endsWith('.md')) return

    const filePath = join(plansDir, filename)
    const config = getCriticConfig(projectPath)
    if (!config.enabled || !config.autoReviewPlan) return

    // Debounce: wait for writes to settle (3s — Write tool can be slow for large files)
    const timerKey = `${projectPath}:${filename}`
    const existing = planFileTimers.get(timerKey)
    if (existing) clearTimeout(existing)

    planFileTimers.set(timerKey, setTimeout(async () => {
      planFileTimers.delete(timerKey)

      if (!existsSync(filePath)) return

      // Skip if already reviewing something
      if (autoReviewInFlight || isGated(projectPath)) return

      // Skip if already reviewed this version
      const stat = await import('node:fs').then(fs => fs.promises.stat(filePath))
      const prev = reviewedFiles.get(filePath)
      if (prev && Math.abs(prev.mtime - stat.mtimeMs) < 1000) return

      const planText = await readFile(filePath, 'utf-8')

      // Must look like an implementation plan (not a design doc or notes)
      if (!looksLikePlan(planText)) {
        console.log(`[plan-detector] Skipping ${filename} — no plan markers found`)
        return
      }

      // Mark as reviewed BEFORE starting (prevents duplicate triggers)
      reviewedFiles.set(filePath, { mtime: stat.mtimeMs })
      autoReviewInFlight = true

      console.log(`[plan-detector] Auto-reviewing plan file: ${filename}`)

      // Engage gate + run review
      await engageGate(getWindow, projectPath, tabId, `Auto-reviewing plan: ${filename}`)

      try {
        const feedback = await startPlanReview(
          getWindow, tabId, projectPath, planText,
          `Project: ${projectPath}`,
        )

        if (feedback.verdict === 'approve') {
          await releaseGate(getWindow, projectPath, `Plan auto-approved: ${filename}`, 'critic_approve')
        }
        // If revise/reject: gate stays active. Claude's next tool call
        // gets blocked with the verdict via assertCriticAllows().
        // The full feedback is visible in the CriticPanel.
      } catch (err) {
        console.error(`[plan-detector] Auto-review failed:`, err)
        await releaseGate(getWindow, projectPath, 'Auto-review failed — gate released', 'error')
      } finally {
        autoReviewInFlight = false
      }
    }, 3000)) // 3s debounce — Write tool can be slow for large plan files
  })

  planFileWatchers.set(projectPath, watcher)

  return () => {
    watcher.close()
    planFileWatchers.delete(projectPath)
  }
}
