import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import type { CriticPhase, CriticRunArtifact, CriticFeedback, CriticDiagnostics, CriticEvent } from '../../shared/critic/types'
import { emitCriticEvent } from './events'
import { reviewPlan, reviewResult } from '../services/openai'
import { saveArtifact, savePlanText, saveDiff, saveFeedback, ensureGitignore } from './artifact-store'
import { getCriticConfig } from './config-store'
import { getSecureToken } from '../services/secure-storage'

// Per-tab runs (NOT per-project — two tabs on same project get independent runs)
const activeRuns = new Map<string, CriticRunArtifact>()
// Guard against concurrent reviews on the same tab (double-click, rapid fire)
const inFlightReviews = new Set<string>()

export function getActiveRun(tabId: string): CriticRunArtifact | null {
  return activeRuns.get(tabId) ?? null
}

function requireApiKey(): string {
  const key = getSecureToken('critic_openai')
  if (!key) throw new Error('No OpenAI API key configured — add one in Critic settings')
  return key
}

export async function startPlanReview(
  getWindow: () => BrowserWindow | null,
  tabId: string,
  projectPath: string,
  planText: string,
  projectContext: string,
): Promise<CriticFeedback> {
  // Prevent concurrent reviews for the same tab
  if (inFlightReviews.has(tabId)) {
    throw new Error('A review is already in progress for this tab')
  }
  inFlightReviews.add(tabId)

  try {
    const config = getCriticConfig(projectPath)
    const apiKey = requireApiKey()
    const runId = randomUUID().slice(0, 8)
    ensureGitignore(projectPath)

    const artifact: CriticRunArtifact = {
      runId, tabId, projectPath, startedAt: Date.now(),
      phase: 'critic_reviewing_plan', plan: planText,
      iteration: 1, maxIterations: config.maxIterations,
    }
    activeRuns.set(tabId, artifact)

    const emit = (phase: CriticPhase, message: string, extras?: Partial<CriticEvent>) => {
      artifact.phase = phase
      saveArtifact(artifact)
      emitCriticEvent(getWindow, {
        runId, tabId, projectPath, phase, message, timestamp: Date.now(),
        iteration: artifact.iteration, maxIterations: artifact.maxIterations,
        ...extras,
      })
    }

    emit('critic_reviewing_plan', 'Sending plan to critic...')
    savePlanText(projectPath, runId, planText)

    const feedback = await reviewPlan(config, apiKey, planText, projectContext)
    artifact.planFeedback = feedback
    saveFeedback(projectPath, runId, 'plan', feedback)
    emit('plan_feedback_ready', `Critic verdict: ${feedback.verdict}`, { feedback })
    return feedback
  } catch (err) {
    const msg = (err as Error).message
    // Emit error if we have an active run (requireApiKey may throw before run is created)
    const run = activeRuns.get(tabId)
    if (run) {
      run.phase = 'error'
      saveArtifact(run)
      emitCriticEvent(getWindow, {
        runId: run.runId, tabId, projectPath, phase: 'error',
        message: `Critic error: ${msg}`, timestamp: Date.now(), error: msg,
      })
      activeRuns.delete(tabId)
    }
    throw err
  } finally {
    inFlightReviews.delete(tabId)
  }
}

export async function startResultReview(
  getWindow: () => BrowserWindow | null,
  tabId: string,
  projectPath: string,
  gitDiff: string,
  diagnostics: CriticDiagnostics,
  projectContext: string,
): Promise<CriticFeedback> {
  // Prevent concurrent reviews for the same tab
  if (inFlightReviews.has(tabId)) {
    throw new Error('A review is already in progress for this tab')
  }
  inFlightReviews.add(tabId)

  try {
    const config = getCriticConfig(projectPath)
    const apiKey = requireApiKey()

    let artifact = activeRuns.get(tabId)
    const runId = artifact?.runId ?? randomUUID().slice(0, 8)

    if (!artifact) {
      ensureGitignore(projectPath)
      artifact = {
        runId, tabId, projectPath, startedAt: Date.now(),
        phase: 'post_review_prep', iteration: 0, // will be incremented below
        maxIterations: config.maxIterations,
      }
      activeRuns.set(tabId, artifact)
    }

    // Increment BEFORE review — iteration tracks "which review number is this"
    artifact.iteration++

    // Stop condition: allow exactly maxIterations reviews (1..N), stop when exceeds
    if (artifact.iteration > config.maxIterations) {
      artifact.phase = 'done'
      saveArtifact(artifact)
      emitCriticEvent(getWindow, {
        runId, tabId, projectPath, phase: 'done', timestamp: Date.now(),
        message: `Max iterations (${config.maxIterations}) reached.`,
      })
      activeRuns.delete(tabId)
      return artifact.resultFeedback ?? { verdict: 'approve', summary: 'Max iterations reached', issues: [] }
    }

    const emit = (phase: CriticPhase, message: string, extras?: Partial<CriticEvent>) => {
      artifact!.phase = phase
      saveArtifact(artifact!)
      emitCriticEvent(getWindow, {
        runId, tabId, projectPath, phase, message, timestamp: Date.now(),
        iteration: artifact!.iteration, maxIterations: artifact!.maxIterations,
        ...extras,
      })
    }

    emit('critic_reviewing_result', `Reviewing result (iteration ${artifact.iteration})...`)
    saveDiff(projectPath, runId, gitDiff)
    artifact.diagnostics = diagnostics
    artifact.gitDiff = gitDiff

    const feedback = await reviewResult(config, apiKey, {
      originalPlan: artifact.plan ?? '(no plan recorded)',
      gitDiff, diagnostics, projectContext,
    })
    artifact.resultFeedback = feedback
    saveFeedback(projectPath, runId, 'result', feedback)

    if (feedback.verdict === 'approve') {
      emit('done', 'Critic approved the implementation.', { feedback })
      activeRuns.delete(tabId)
    } else {
      emit('result_feedback_ready', `Iteration ${artifact.iteration}: ${feedback.verdict}`, { feedback })
    }
    return feedback
  } catch (err) {
    const msg = (err as Error).message
    // Emit error if we have an active run
    const run = activeRuns.get(tabId)
    if (run) {
      run.phase = 'error'
      saveArtifact(run)
      emitCriticEvent(getWindow, {
        runId: run.runId, tabId, projectPath, phase: 'error',
        message: `Critic error: ${msg}`, timestamp: Date.now(), error: msg,
      })
      activeRuns.delete(tabId)
    }
    throw err
  } finally {
    inFlightReviews.delete(tabId)
  }
}

export function abortRun(tabId: string): void {
  const run = activeRuns.get(tabId)
  if (run) { run.phase = 'aborted'; saveArtifact(run); activeRuns.delete(tabId) }
}

export function completeRun(tabId: string): void {
  const run = activeRuns.get(tabId)
  if (run) { run.phase = 'done'; saveArtifact(run); activeRuns.delete(tabId) }
}
