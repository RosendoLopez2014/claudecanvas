import * as fs from 'fs'
import * as path from 'path'
import simpleGit, { SimpleGit } from 'simple-git'
import { isEbadfError, logFdDiagnostics } from './git-diagnostics'

// ── SimpleGit instance cache ───────────────────────────────────────────
const gitInstances = new Map<string, SimpleGit>()

// ── Per-repo serial queue ──────────────────────────────────────────────
// Operations for the same repo run serially; different repos run in parallel.
const gitQueues = new Map<string, Promise<unknown>>()

// ── Git root cache ─────────────────────────────────────────────────────
// Avoids repeated file I/O from findGitRoot on every enqueue/getGit call.
const gitRootCache = new Map<string, string>()

/**
 * Find the actual git root for a project.
 * Checks cwd first, then immediate subdirectories for a .git with a remote.
 * Returns the path containing .git, or null.
 */
function findGitRoot(cwd: string): string | null {
  // 1. Check cwd itself
  if (fs.existsSync(path.join(cwd, '.git'))) {
    // Check if this .git has an origin remote (real repo, not our empty init)
    const configPath = path.join(cwd, '.git', 'config')
    if (fs.existsSync(configPath)) {
      const config = fs.readFileSync(configPath, 'utf-8')
      if (config.includes('[remote "origin"]')) return cwd
    }
  }

  // 2. Check immediate subdirectories
  try {
    const entries = fs.readdirSync(cwd, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const subGit = path.join(cwd, entry.name, '.git')
      if (fs.existsSync(subGit)) {
        const configPath = path.join(subGit, 'config')
        if (fs.existsSync(configPath)) {
          const config = fs.readFileSync(configPath, 'utf-8')
          if (config.includes('[remote "origin"]')) {
            return path.join(cwd, entry.name)
          }
        }
      }
    }
  } catch {}

  // 3. Fall back to cwd if it has any .git (even without remote)
  if (fs.existsSync(path.join(cwd, '.git'))) return cwd

  return null
}

export function resolveGitRoot(cwd: string): string {
  const resolved = path.resolve(cwd)
  if (gitRootCache.has(resolved)) return gitRootCache.get(resolved)!
  const root = findGitRoot(resolved) || resolved
  gitRootCache.set(resolved, root)
  // Cache root->root so lookups from either path hit cache
  if (root !== resolved) gitRootCache.set(root, root)
  return root
}

export function getGit(projectPath: string): SimpleGit {
  const key = resolveGitRoot(projectPath)
  if (!gitInstances.has(key)) {
    // Limit concurrent git spawns to avoid EBADF from fd exhaustion
    // when PTY shells + chokidar watchers are consuming descriptors.
    gitInstances.set(key, simpleGit(key, {
      maxConcurrentProcesses: 3,
      timeout: { block: 30_000 }, // 30s timeout to prevent hanging git ops
    }))
  }
  return gitInstances.get(key)!
}

/** Remove a single git instance from the cache (called on tab close). */
export function cleanupGitInstance(projectPath: string): void {
  const key = resolveGitRoot(projectPath)
  gitInstances.delete(key)
  gitQueues.delete(key)
  gitRootCache.delete(path.resolve(projectPath))
}

/** Remove all cached git instances (called on app shutdown). */
export function cleanupAllGitInstances(): void {
  gitInstances.clear()
  gitQueues.clear()
  gitRootCache.clear()
}

export function enqueue<T>(projectPath: string, fn: () => Promise<T>): Promise<T> {
  const key = resolveGitRoot(projectPath)
  const inflight = gitQueues.has(key)
  console.log(
    `[git-queue] ENQUEUE key=${key}${projectPath !== key ? ` (raw=${projectPath})` : ''} inflight=${inflight}`
  )

  // Wrap fn with a spawn gate: delay git spawns if PTY churn happened within 300ms.
  // This avoids inheriting half-closed FDs from PTY teardown.
  async function gatedFn(): Promise<T> {
    const lastChurn = (globalThis as any).__lastPtyChurnTime as number | undefined
    if (lastChurn) {
      const elapsed = Date.now() - lastChurn
      if (elapsed < 300) {
        const wait = 300 - elapsed
        console.log(`[git-queue] SPAWN-GATE waiting ${wait}ms after PTY churn`)
        await new Promise((r) => setTimeout(r, wait))
      }
    }
    return fn()
  }

  const prev = gitQueues.get(key) || Promise.resolve()
  const next = prev.then(gatedFn, gatedFn) as Promise<T>
  gitQueues.set(key, next)
  next.finally(() => {
    // Clean up if we're still the tail of the chain
    if (gitQueues.get(key) === next) {
      gitQueues.delete(key)
    }
  })
  return next
}

/**
 * Retry a git operation on EBADF. A brief delay + retry resolves it once
 * the bad FDs are cleaned up by the OS.
 * Uses 150ms base delay (short because persistent EBADF won't resolve with time --
 * the leaked FDs persist until PTY processes exit).
 */
export async function withEbadfRetry<T>(fn: () => Promise<T>, retries = 3, context = 'unknown'): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err: unknown) {
      if (attempt < retries && isEbadfError(err)) {
        // Log FD diagnostics on first EBADF hit per retry chain
        if (attempt === 0) logFdDiagnostics(context, gitQueues.size, gitInstances.size)
        console.warn(`[git] EBADF on attempt ${attempt + 1}/${retries + 1}, retrying in 150ms... (${context})`)
        await new Promise((r) => setTimeout(r, 150))
        continue
      }
      throw err
    }
  }
  throw new Error('unreachable')
}
