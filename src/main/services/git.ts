import { ipcMain, net } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execFile } from 'child_process'
import { settingsStore } from '../store'
import { getSecureToken } from '../services/secure-storage'
import { isValidPath } from '../validate'
import { GIT_PUSH_MODES, type GitPushMode } from '../../shared/constants'
import { getGit, cleanupGitInstance, enqueue, withEbadfRetry } from './git-queue'

// Re-export for backward compatibility (consumed by worktree.ts, etc.)
export { getGit, cleanupGitInstance, cleanupAllGitInstances, enqueue, withEbadfRetry } from './git-queue'
export { countOpenFds, isEbadfError } from './git-diagnostics'

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

/** Build git -c args to inject the stored GitHub token via URL rewriting. */
function getGitAuthArgs(): string[] {
  const ghToken = getSecureToken('github')
  if (!ghToken) return []
  // Rewrite github.com URLs to embed the token as Basic auth credentials.
  // This only applies for the duration of this single git command.
  return ['-c', `url.https://x-access-token:${ghToken}@github.com/.insteadOf=https://github.com/`]
}

/** Strip embedded tokens from git error messages to prevent leaks in logs/UI. */
function sanitizeGitError(msg: string): string {
  // Matches x-access-token:<TOKEN>@ in git URLs
  return msg.replace(/x-access-token:[^@]+@/g, 'x-access-token:***@')
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
        console.error('git:fetch error:', sanitizeGitError(err?.message || ''))
        return { ahead: 0, behind: 0, error: sanitizeGitError(err?.message || '') }
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
        return { success: false, error: sanitizeGitError(err?.message || 'Pull failed') }
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
          return { success: false, error: sanitizeGitError(err?.message || 'Push failed') }
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
