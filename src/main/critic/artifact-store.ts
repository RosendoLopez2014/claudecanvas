import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, renameSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { CriticRunArtifact, CriticFeedback } from '../../shared/critic/types'

function runDir(projectPath: string, runId: string): string {
  return join(projectPath, '.claude-wrapper', 'runs', runId)
}

/** Atomic write: write to .tmp then rename to prevent corruption. */
function atomicWrite(filePath: string, content: string): void {
  const tmp = filePath + '.tmp.' + randomUUID().slice(0, 6)
  writeFileSync(tmp, content, 'utf-8')
  renameSync(tmp, filePath)
}

/** Ensure .claude-wrapper/.gitignore exists with '*' to keep artifacts out of git. */
export function ensureGitignore(projectPath: string): void {
  const dir = join(projectPath, '.claude-wrapper')
  mkdirSync(dir, { recursive: true })
  const gi = join(dir, '.gitignore')
  if (!existsSync(gi)) writeFileSync(gi, '*\n', 'utf-8')
}

export function saveArtifact(artifact: CriticRunArtifact): void {
  const dir = runDir(artifact.projectPath, artifact.runId)
  mkdirSync(dir, { recursive: true })
  atomicWrite(join(dir, 'manifest.json'), JSON.stringify(artifact, null, 2))
}

export function loadArtifact(projectPath: string, runId: string): CriticRunArtifact | null {
  try { return JSON.parse(readFileSync(join(runDir(projectPath, runId), 'manifest.json'), 'utf-8')) }
  catch { return null }
}

export function listRuns(projectPath: string): string[] {
  const dir = join(projectPath, '.claude-wrapper', 'runs')
  try { return readdirSync(dir).sort().reverse() } catch { return [] }
}

export function savePlanText(projectPath: string, runId: string, text: string): void {
  const dir = runDir(projectPath, runId)
  mkdirSync(dir, { recursive: true })
  atomicWrite(join(dir, 'plan.md'), text)
}

export function saveDiff(projectPath: string, runId: string, diff: string): void {
  const dir = runDir(projectPath, runId)
  mkdirSync(dir, { recursive: true })
  atomicWrite(join(dir, 'diff.patch'), diff)
}

export function saveFeedback(
  projectPath: string, runId: string, phase: 'plan' | 'result', feedback: CriticFeedback,
): void {
  const dir = runDir(projectPath, runId)
  mkdirSync(dir, { recursive: true })
  atomicWrite(join(dir, `${phase}-feedback.json`), JSON.stringify(feedback, null, 2))
}
