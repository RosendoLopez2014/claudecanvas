import { ipcMain, net } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execFile } from 'child_process'
import simpleGit, { SimpleGit } from 'simple-git'
import { settingsStore } from '../store'
import { getSecureToken } from '../services/secure-storage'
import { GIT_PUSH_MODES, type GitPushMode } from '../../shared/constants'

/** Resolve the full path to the claude CLI binary. */
function findClaudeBinary(): string {
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'claude'),
    path.join(os.homedir(), '.claude', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return 'claude' // fallback to PATH lookup
}

const gitInstances = new Map<string, SimpleGit>()

function isValidPath(p: unknown): p is string {
  return typeof p === 'string' && p.length > 0 && path.isAbsolute(p)
}

// ── EBADF diagnostics ─────────────────────────────────────────────────
// All diagnostics use ONLY synchronous fs calls (no spawn) to avoid
// triggering more EBADF from child_process.
let lastFdDiagTime = 0
let fdCategorizationDone = false

/** Count open FDs via /dev/fd (kernel-provided, per-process on macOS). */
export function countOpenFds(): number {
  try {
    return fs.readdirSync('/dev/fd').length
  } catch {
    return -1
  }
}

/**
 * Categorize open FDs by type using fstatSync (no spawn needed).
 * Samples up to `sampleSize` FDs evenly across the full range.
 */
function categorizeFds(sampleSize = 300): Record<string, number> {
  const types: Record<string, number> = {}
  let entries: number[]
  try {
    entries = fs.readdirSync('/dev/fd').map(Number).filter((n) => !isNaN(n))
  } catch {
    return types
  }

  // Sample evenly if there are more entries than sampleSize
  const step = entries.length > sampleSize ? Math.floor(entries.length / sampleSize) : 1
  let sampled = 0
  for (let i = 0; i < entries.length && sampled < sampleSize; i += step) {
    try {
      const stat = fs.fstatSync(entries[i])
      let type = 'other'
      if (stat.isFIFO()) type = 'FIFO/pipe'
      else if (stat.isSocket()) type = 'socket'
      else if (stat.isCharacterDevice()) type = 'chardev'
      else if (stat.isBlockDevice()) type = 'blockdev'
      else if (stat.isDirectory()) type = 'dir'
      else if (stat.isFile()) type = 'file'
      types[type] = (types[type] || 0) + 1
      sampled++
    } catch {
      types['error/closed'] = (types['error/closed'] || 0) + 1
      sampled++
    }
  }

  // Scale sampled counts to estimate total if we sampled a subset
  if (step > 1) {
    for (const key of Object.keys(types)) {
      types[key] = Math.round(types[key] * step)
    }
    types['_sampled'] = sampled
    types['_total'] = entries.length
  }

  return types
}

function logFdDiagnostics(context: string): void {
  const now = Date.now()
  // Throttle to once per 2 seconds to avoid spam
  if (now - lastFdDiagTime < 2000) return
  lastFdDiagTime = now

  try {
    const fdCount = countOpenFds()
    const ptyCount = (globalThis as any).__ptyCount?.() ?? '?'
    const ptyClosing = (globalThis as any).__ptyClosingCount?.() ?? '?'
    const queueDepth = gitQueues.size

    // Max FD number shows how sparse the FD table is
    let maxFd = -1
    try {
      const entries = fs.readdirSync('/dev/fd').map(Number).filter((n) => !isNaN(n))
      maxFd = Math.max(...entries)
    } catch {}

    console.warn(
      `[git] EBADF DIAG: context=${context}, pid=${process.pid}, openFDs=${fdCount}, maxFD=${maxFd}, ptyCount=${ptyCount}, ptyClosing=${ptyClosing}, gitQueues=${queueDepth}, gitInstances=${gitInstances.size}`
    )

    // One-time FD categorization (no spawn — uses fstatSync)
    if (!fdCategorizationDone) {
      fdCategorizationDone = true
      const cats = categorizeFds()
      const sorted = Object.entries(cats)
        .filter(([k]) => !k.startsWith('_'))
        .sort((a, b) => b[1] - a[1])
      console.warn(
        `[git] FD CATEGORIES (no-spawn): ${sorted.map(([t, n]) => `${t}=${n}`).join(', ')}` +
        (cats._total ? ` (sampled ${cats._sampled} of ${cats._total})` : '')
      )
    }
  } catch (err) {
    console.warn(`[git] EBADF DIAG failed:`, err)
  }
}

/**
 * Check whether an error is an EBADF (bad file descriptor) error.
 * node-pty leaks FDs into child processes, so git spawns can fail transiently.
 * Checks err.code, err.message, and recursive err.cause chain.
 */
export function isEbadfError(err: unknown): boolean {
  if (!err) return false
  if (typeof err === 'object') {
    const e = err as Record<string, unknown>
    if (e.code === 'EBADF') return true
    if (String(e.message || '').includes('EBADF')) return true
    if (e.cause) return isEbadfError(e.cause)
  }
  if (typeof err === 'string' && err.includes('EBADF')) return true
  return false
}

/**
 * Retry a git operation on EBADF. A brief delay + retry resolves it once
 * the bad FDs are cleaned up by the OS.
 * Uses 150ms base delay (short because persistent EBADF won't resolve with time —
 * the leaked FDs persist until PTY processes exit).
 */
export async function withEbadfRetry<T>(fn: () => Promise<T>, retries = 3, context = 'unknown'): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err: unknown) {
      if (attempt < retries && isEbadfError(err)) {
        // Log FD diagnostics on first EBADF hit per retry chain
        if (attempt === 0) logFdDiagnostics(context)
        console.warn(`[git] EBADF on attempt ${attempt + 1}/${retries + 1}, retrying in 150ms... (${context})`)
        await new Promise((r) => setTimeout(r, 150))
        continue
      }
      throw err
    }
  }
  throw new Error('unreachable')
}

// ── Per-repo serial queue ──────────────────────────────────────────────
// Operations for the same repo run serially; different repos run in parallel.
const gitQueues = new Map<string, Promise<unknown>>()

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

export function getGit(projectPath: string): SimpleGit {
  const key = resolveGitRoot(projectPath)
  if (!gitInstances.has(key)) {
    // Limit concurrent git spawns to avoid EBADF from fd exhaustion
    // when PTY shells + chokidar watchers are consuming descriptors.
    gitInstances.set(key, simpleGit(key, { maxConcurrentProcesses: 3 }))
  }
  return gitInstances.get(key)!
}

/** Build git -c args to inject the stored GitHub token via URL rewriting. */
function getGitAuthArgs(): string[] {
  const ghToken = getSecureToken('github')
  if (!ghToken) return []
  // Rewrite github.com URLs to embed the token as Basic auth credentials.
  // This only applies for the duration of this single git command.
  return ['-c', `url.https://x-access-token:${ghToken}@github.com/.insteadOf=https://github.com/`]
}

/** Ensure a directory has a .git folder (minimal init without spawning) */
function ensureGitInit(cwd: string): void {
  const gitDir = path.join(cwd, '.git')
  if (fs.existsSync(gitDir)) return

  fs.mkdirSync(path.join(gitDir, 'objects'), { recursive: true })
  fs.mkdirSync(path.join(gitDir, 'refs', 'heads'), { recursive: true })
  fs.mkdirSync(path.join(gitDir, 'refs', 'tags'), { recursive: true })
  fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n')
  fs.writeFileSync(
    path.join(gitDir, 'config'),
    '[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n'
  )
}

/** Set or replace origin remote by editing .git/config directly (no spawn) */
function setOriginRemote(cwd: string, remoteUrl: string): void {
  const configPath = path.join(cwd, '.git', 'config')
  let config = fs.readFileSync(configPath, 'utf-8')

  // Remove existing [remote "origin"] section
  config = config.replace(
    /\[remote "origin"\][^\[]*(?=\[|$)/s,
    ''
  ).trimEnd()

  // Append new remote section
  config += `\n[remote "origin"]\n\turl = ${remoteUrl}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`

  fs.writeFileSync(configPath, config)
}

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

// ── Git root cache ─────────────────────────────────────────────────────
// Avoids repeated file I/O from findGitRoot on every enqueue/getGit call.
const gitRootCache = new Map<string, string>()

function resolveGitRoot(cwd: string): string {
  const resolved = path.resolve(cwd)
  if (gitRootCache.has(resolved)) return gitRootCache.get(resolved)!
  const root = findGitRoot(resolved) || resolved
  gitRootCache.set(resolved, root)
  // Cache root→root so lookups from either path hit cache
  if (root !== resolved) gitRootCache.set(root, root)
  return root
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

export function setupGitHandlers(): void {
  ipcMain.handle('git:cleanup', (_event, projectPath: string) => {
    cleanupGitInstance(projectPath)
  })

  ipcMain.handle('git:init', (_event, cwd: string) => {
    getGit(cwd)
    return true
  })

  ipcMain.handle('git:status', async (_event, projectPath: string) => {
    if (!isValidPath(projectPath)) return null
    return enqueue(projectPath, () => withEbadfRetry(() => getGit(projectPath).status(), 3, 'git:status'))
  })

  ipcMain.handle('git:branch', async (_event, projectPath: string) => {
    if (!isValidPath(projectPath)) return null
    return enqueue(projectPath, async () => {
      const summary = await withEbadfRetry(() => getGit(projectPath).branchLocal(), 3, 'git:branch')
      return { current: summary.current, branches: summary.all }
    })
  })

  ipcMain.handle('git:log', async (_event, projectPath: string, maxCount?: number) => {
    if (!isValidPath(projectPath)) return []
    return enqueue(projectPath, async () => {
      const g = getGit(projectPath)
      const log = await withEbadfRetry(() => g.log({ maxCount: maxCount || 20, '--stat': null }), 3, 'git:log')
      return log.all.map((entry) => {
        const diff = entry.diff
        return {
          hash: entry.hash,
          message: entry.message,
          date: entry.date,
          author: entry.author_name,
          filesChanged: diff?.files?.length ?? 0,
          insertions: diff?.insertions ?? 0,
          deletions: diff?.deletions ?? 0,
          files: (diff?.files ?? []).slice(0, 5).map((f) => f.file),
        }
      })
    })
  })

  ipcMain.handle('git:checkpoint', async (_event, projectPath: string, message: string) => {
    if (!isValidPath(projectPath)) return null
    return enqueue(projectPath, async () => {
      const g = getGit(projectPath)
      try {
        await withEbadfRetry(() => g.add('.'), 3, 'git:checkpoint:add')
        const status = await withEbadfRetry(() => g.status(), 3, 'git:checkpoint:status')
        if (status.staged.length === 0 && status.files.length === 0) {
          return { hash: null, message, error: 'nothing-to-commit' }
        }
        const result = await withEbadfRetry(() => g.commit(`[checkpoint] ${message}`), 3, 'git:checkpoint:commit')
        return { hash: result.commit, message }
      } catch (err: any) {
        if (err?.message?.includes('nothing to commit')) {
          return { hash: null, message, error: 'nothing-to-commit' }
        }
        console.error('Checkpoint failed:', err)
        return { hash: null, message, error: err?.message || 'unknown' }
      }
    })
  })

  ipcMain.handle('git:diff', async (_event, projectPath: string, hash?: string) => {
    if (!isValidPath(projectPath)) return ''
    return enqueue(projectPath, () => {
      if (hash) return withEbadfRetry(() => getGit(projectPath).diff([`${hash}~1`, hash]), 3, 'git:diff')
      return withEbadfRetry(() => getGit(projectPath).diff(), 3, 'git:diff')
    })
  })

  ipcMain.handle('git:diffBetween', async (_event, projectPath: string, fromHash: string, toHash: string) => {
    if (!isValidPath(projectPath)) return ''
    return enqueue(projectPath, () => withEbadfRetry(() => getGit(projectPath).diff([fromHash, toHash]), 3, 'git:diffBetween'))
  })

  ipcMain.handle('git:show', async (_event, projectPath: string, hash: string, filePath: string) => {
    if (!isValidPath(projectPath)) return ''
    return enqueue(projectPath, () => withEbadfRetry(() => getGit(projectPath).show([`${hash}:${filePath}`]), 3, 'git:show'))
  })

  ipcMain.handle('git:remoteUrl', async (_event, projectPath: string) => {
    if (!isValidPath(projectPath)) return null
    return enqueue(projectPath, async () => {
      try {
        const remotes = await withEbadfRetry(() => getGit(projectPath).getRemotes(true), 3, 'git:remoteUrl')
        const origin = remotes.find((r) => r.name === 'origin')
        return origin?.refs?.push || origin?.refs?.fetch || null
      } catch {
        return null
      }
    })
  })

  // Atomic: find git root (cwd or subdirectory) and return remote + branch
  // enqueue() normalizes the key through resolveGitRoot, so all ops on the
  // same repo serialize under one key regardless of path variation.
  ipcMain.handle('git:getProjectInfo', async (_event, cwd: string) => {
    return enqueue(cwd, async () => {
      try {
        const g = getGit(cwd) // getGit normalizes to git root via resolveGitRoot
        const remotes = await withEbadfRetry(() => g.getRemotes(true), 3, 'getProjectInfo:remotes')
        const origin = remotes.find((r) => r.name === 'origin')
        const remoteUrl = origin?.refs?.push || origin?.refs?.fetch || null
        let branch: string | null = null
        try {
          const summary = await withEbadfRetry(() => g.branchLocal(), 3, 'getProjectInfo:branch')
          branch = summary.current || null
        } catch {}
        return { remoteUrl, branch }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.warn('[git] getProjectInfo failed:', message)
        return { remoteUrl: null, branch: null, error: message }
      }
    })
  })

  // Init git in a folder and set the origin remote (pure fs, no spawn)
  ipcMain.handle(
    'git:setRemote',
    async (_event, cwd: string, remoteUrl: string): Promise<{ ok: true } | { error: string }> => {
      try {
        ensureGitInit(cwd)
        setOriginRemote(cwd, remoteUrl)
        // Store the simpleGit instance in the map for this cwd
        getGit(cwd)
        return { ok: true }
      } catch (err: any) {
        return { error: err?.message || String(err) }
      }
    }
  )

  ipcMain.handle('git:fetch', async (_event, projectPath: string) => {
    if (!isValidPath(projectPath)) return { ahead: 0, behind: 0 }
    return enqueue(projectPath, async () => {
      const g = getGit(projectPath)
      try {
        const authArgs = getGitAuthArgs()
        await withEbadfRetry(() => g.raw([...authArgs, 'fetch', 'origin']), 3, 'git:fetch:origin')
        const branch = (await withEbadfRetry(() => g.branchLocal(), 3, 'git:fetch:branch')).current
        const status = await withEbadfRetry(() => g.raw(['rev-list', '--left-right', '--count', `origin/${branch}...HEAD`]), 3, 'git:fetch:revlist')
        const [behind, ahead] = status.trim().split(/\s+/).map(Number)
        return { ahead: ahead || 0, behind: behind || 0 }
      } catch (err: any) {
        console.error('git:fetch error:', err?.message)
        return { ahead: 0, behind: 0, error: err?.message }
      }
    })
  })

  ipcMain.handle('git:pull', async (_event, projectPath: string) => {
    if (!isValidPath(projectPath)) return { success: false, error: 'Invalid project path' }
    return enqueue(projectPath, async () => {
      const g = getGit(projectPath)
      try {
        const branch = (await withEbadfRetry(() => g.branchLocal(), 3, 'git:pull:branch')).current
        const status = await withEbadfRetry(() => g.status(), 3, 'git:pull:status')
        const hadChanges = status.files.length > 0
        if (hadChanges) {
          await withEbadfRetry(() => g.stash(['push', '-m', 'claude-canvas-auto-stash']), 3, 'git:pull:stash-push')
        }
        const authArgs = getGitAuthArgs()
        await withEbadfRetry(() => g.raw([...authArgs, 'pull', '--rebase', 'origin', branch]), 3, 'git:pull:rebase')
        if (hadChanges) {
          try {
            await g.stash(['pop'])
            return { success: true, conflicts: false }
          } catch {
            return { success: true, conflicts: true }
          }
        }
        return { success: true, conflicts: false }
      } catch (err: any) {
        return { success: false, error: err?.message || 'Pull failed' }
      }
    })
  })

  ipcMain.handle(
    'git:squashAndPush',
    async (_event, projectPath: string, message: string) => {
      if (!isValidPath(projectPath)) return { success: false, error: 'Invalid project path' }
      return enqueue(projectPath, async () => {
        const g = getGit(projectPath)
        try {
          const branch = (await withEbadfRetry(() => g.branchLocal(), 3, 'git:push:branch')).current
          const authArgs = getGitAuthArgs()
          const mode = (settingsStore.get('gitPushMode') || 'solo') as GitPushMode
          const config = GIT_PUSH_MODES[mode]
          const isProtected = config.protectedBranches.includes(branch)
          const isFeatureBranch = !isProtected

          const shouldSquash = config.squash === true
            || (config.squash === 'feature-only' && isFeatureBranch)

          const canForce = config.forceAllowed === true
            || (config.forceAllowed === 'feature-only' && isFeatureBranch)

          const pushArgs = canForce
            ? [...authArgs, 'push', '--set-upstream', '--force-with-lease', 'origin', branch]
            : [...authArgs, 'push', '--set-upstream', 'origin', branch]

          try {
            await withEbadfRetry(() => g.raw([...authArgs, 'fetch', 'origin']), 3, 'git:push:prefetch')
          } catch (fetchErr: any) {
            console.warn('[git] pre-push fetch failed:', fetchErr?.message)
          }

          try {
            const status = await withEbadfRetry(() => g.raw(['rev-list', '--left-right', '--count', `origin/${branch}...HEAD`]), 3, 'git:push:revlist')
            const [behind] = status.trim().split(/\s+/).map(Number)
            if (behind > 0) {
              return { success: false, error: 'rejected', needsPull: true }
            }
          } catch {
            // No tracking branch yet — safe to push
          }

          if (!shouldSquash) {
            await withEbadfRetry(() => g.raw(pushArgs), 3, 'git:push:push')
            return { success: true, branch }
          }

          let forkPoint: string
          try {
            forkPoint = (await withEbadfRetry(() => g.raw(['merge-base', `origin/${branch}`, 'HEAD']), 3, 'git:push:mergebase')).trim()
          } catch {
            await withEbadfRetry(() => g.raw(pushArgs), 3, 'git:push:push-nofork')
            return { success: true, branch }
          }

          const logOutput = await withEbadfRetry(() => g.raw(['rev-list', '--count', `${forkPoint}..HEAD`]), 3, 'git:push:count')
          const commitCount = parseInt(logOutput.trim(), 10)

          if (commitCount <= 1) {
            if (commitCount === 1 && canForce) {
              await withEbadfRetry(() => g.raw(['commit', '--amend', '-m', message]), 3, 'git:push:amend')
            }
            await withEbadfRetry(() => g.raw(pushArgs), 3, 'git:push:push-single')
            return { success: true, branch }
          }

          await withEbadfRetry(() => g.raw(['reset', '--soft', forkPoint]), 3, 'git:push:reset')
          await withEbadfRetry(() => g.commit(message), 3, 'git:push:commit')
          await withEbadfRetry(() => g.raw(pushArgs), 3, 'git:push:push-squash')
          return { success: true, branch }
        } catch (err: any) {
          if (err?.message?.includes('rejected') || err?.message?.includes('non-fast-forward')) {
            return { success: false, error: 'rejected', needsPull: true }
          }
          return { success: false, error: err?.message || 'Push failed' }
        }
      })
    }
  )

  ipcMain.handle('git:generateCommitMessage', async (_event, projectPath: string) => {
    if (!isValidPath(projectPath)) return ''
    return enqueue(projectPath, async () => {
      const g = getGit(projectPath)
      try {
        const branch = (await g.branchLocal()).current
        let diffStat = ''
        const strategies = [
          () => g.raw(['diff', '--stat', `origin/${branch}...HEAD`]),
          () => g.raw(['diff', '--stat', 'HEAD~1']),
          () => g.raw(['log', '--oneline', '-10']),
          () => g.raw(['diff', '--stat']),
        ]
        for (const strategy of strategies) {
          try {
            const result = await strategy()
            if (result.trim()) { diffStat = result; break }
          } catch { /* try next */ }
        }
        if (!diffStat.trim()) return ''

        const claudeBin = findClaudeBinary()
        return new Promise<string>((resolve) => {
          const prompt = `Generate a concise one-line git commit message (max 72 chars) for these changes. Reply with ONLY the message, no quotes, no prefix:\n\n${diffStat}`
          const env = { ...process.env }
          delete env.CLAUDECODE
          console.log('[git] generating commit message with:', claudeBin)
          execFile(claudeBin, ['--print', prompt], {
            timeout: 30000,
            env
          }, (err, stdout, stderr) => {
            if (err) {
              console.error('[git] claude CLI error:', err.message)
              if (stderr) console.error('[git] claude stderr:', stderr)
              resolve('')
            } else if (!stdout.trim()) {
              console.warn('[git] claude CLI returned empty output')
              resolve('')
            } else {
              resolve(stdout.trim().replace(/^["']|["']$/g, ''))
            }
          })
        })
      } catch {
        return ''
      }
    })
  })

  ipcMain.handle(
    'git:createPr',
    async (
      _event,
      projectPath: string,
      opts: { title: string; body: string; base: string }
    ) => {
      if (!isValidPath(projectPath)) return { error: 'Invalid project path' }
      const token = getSecureToken('github')
      if (!token) return { error: 'Not authenticated with GitHub' }

      return enqueue(projectPath, async () => {
        const g = getGit(projectPath)
        try {
          const branch = (await g.branchLocal()).current
          const remotes = await g.getRemotes(true)
          const origin = remotes.find((r) => r.name === 'origin')
          const remoteUrl = origin?.refs?.push || origin?.refs?.fetch || ''

          const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/)
          if (!match) return { error: 'Could not parse GitHub repo from remote URL' }
          const [, owner, repo] = match

          const response = await net.fetch(
            `https://api.github.com/repos/${owner}/${repo}/pulls`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                title: opts.title,
                body: opts.body,
                head: branch,
                base: opts.base || 'main'
              })
            }
          )

          const data = await response.json() as any
          if (!response.ok) {
            return { error: data.message || `GitHub API error ${response.status}` }
          }
          return { url: data.html_url, number: data.number }
        } catch (err: any) {
          return { error: err?.message || 'Failed to create PR' }
        }
      })
    }
  )

  // Rollback to a specific commit (hard reset)
  ipcMain.handle(
    'git:rollback',
    async (_event, projectPath: string, hash: string): Promise<{ success: boolean; error?: string }> => {
      if (!isValidPath(projectPath)) return { success: false, error: 'Invalid path' }
      return enqueue(projectPath, async () => {
        try {
          const git = getGit(projectPath)
          await git.reset(['--hard', hash])
          return { success: true }
        } catch (err: any) {
          return { success: false, error: err?.message || 'Rollback failed' }
        }
      })
    }
  )

  // Revert a single file to a specific commit version
  ipcMain.handle(
    'git:revertFile',
    async (_event, projectPath: string, hash: string, filePath: string): Promise<{ success: boolean; error?: string }> => {
      if (!isValidPath(projectPath)) return { success: false, error: 'Invalid path' }
      return enqueue(projectPath, async () => {
        try {
          const git = getGit(projectPath)
          await git.checkout([hash, '--', filePath])
          return { success: true }
        } catch (err: any) {
          return { success: false, error: err?.message || 'Revert failed' }
        }
      })
    }
  )
}
