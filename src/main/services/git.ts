import { ipcMain, net } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { execFile } from 'child_process'
import simpleGit, { SimpleGit } from 'simple-git'
import { settingsStore } from '../store'

const gitInstances = new Map<string, SimpleGit>()

function getGit(projectPath: string): SimpleGit {
  if (!gitInstances.has(projectPath)) {
    gitInstances.set(projectPath, simpleGit(projectPath))
  }
  return gitInstances.get(projectPath)!
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

export function setupGitHandlers(): void {
  ipcMain.handle('git:init', (_event, cwd: string) => {
    getGit(cwd)
    return true
  })

  ipcMain.handle('git:status', async (_event, projectPath: string) => {
    if (!projectPath) return null
    return getGit(projectPath).status()
  })

  ipcMain.handle('git:branch', async (_event, projectPath: string) => {
    if (!projectPath) return null
    const summary = await getGit(projectPath).branchLocal()
    return { current: summary.current, branches: summary.all }
  })

  ipcMain.handle('git:log', async (_event, projectPath: string, maxCount?: number) => {
    if (!projectPath) return []
    const log = await getGit(projectPath).log({ maxCount: maxCount || 20 })
    return log.all.map((entry) => ({
      hash: entry.hash,
      message: entry.message,
      date: entry.date,
      author: entry.author_name
    }))
  })

  ipcMain.handle('git:checkpoint', async (_event, projectPath: string, message: string) => {
    if (!projectPath) return null
    const g = getGit(projectPath)
    try {
      await g.add('.')
      const status = await g.status()
      // Nothing staged — nothing to commit
      if (status.staged.length === 0 && status.files.length === 0) {
        return { hash: null, message, error: 'nothing-to-commit' }
      }
      const result = await g.commit(`[checkpoint] ${message}`)
      return { hash: result.commit, message }
    } catch (err: any) {
      // "nothing to commit" is not a real error
      if (err?.message?.includes('nothing to commit')) {
        return { hash: null, message, error: 'nothing-to-commit' }
      }
      console.error('Checkpoint failed:', err)
      return { hash: null, message, error: err?.message || 'unknown' }
    }
  })

  ipcMain.handle('git:diff', async (_event, projectPath: string, hash?: string) => {
    if (!projectPath) return ''
    if (hash) {
      return getGit(projectPath).diff([`${hash}~1`, hash])
    }
    return getGit(projectPath).diff()
  })

  ipcMain.handle('git:diffBetween', async (_event, projectPath: string, fromHash: string, toHash: string) => {
    if (!projectPath) return ''
    return getGit(projectPath).diff([fromHash, toHash])
  })

  ipcMain.handle('git:show', async (_event, projectPath: string, hash: string, filePath: string) => {
    if (!projectPath) return ''
    return getGit(projectPath).show([`${hash}:${filePath}`])
  })

  ipcMain.handle('git:remoteUrl', async (_event, projectPath: string) => {
    if (!projectPath) return null
    try {
      const remotes = await getGit(projectPath).getRemotes(true)
      const origin = remotes.find((r) => r.name === 'origin')
      return origin?.refs?.push || origin?.refs?.fetch || null
    } catch {
      return null
    }
  })

  // Atomic: find git root (cwd or subdirectory) and return remote + branch
  ipcMain.handle('git:getProjectInfo', async (_event, cwd: string) => {
    try {
      const gitRoot = findGitRoot(cwd) || cwd
      const g = getGit(gitRoot)
      const remotes = await g.getRemotes(true)
      const origin = remotes.find((r) => r.name === 'origin')
      const remoteUrl = origin?.refs?.push || origin?.refs?.fetch || null
      let branch: string | null = null
      try {
        const summary = await g.branchLocal()
        branch = summary.current || null
      } catch {}
      return { remoteUrl, branch }
    } catch {
      return { remoteUrl: null, branch: null }
    }
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
    if (!projectPath) return { ahead: 0, behind: 0 }
    const g = getGit(projectPath)
    try {
      await g.fetch('origin')
      const branch = (await g.branchLocal()).current
      // Count commits ahead and behind
      const status = await g.raw(['rev-list', '--left-right', '--count', `origin/${branch}...HEAD`])
      const [behind, ahead] = status.trim().split(/\s+/).map(Number)
      return { ahead: ahead || 0, behind: behind || 0 }
    } catch (err: any) {
      // No remote, no tracking branch, or network error
      console.error('git:fetch error:', err?.message)
      return { ahead: 0, behind: 0, error: err?.message }
    }
  })

  ipcMain.handle('git:pull', async (_event, projectPath: string) => {
    if (!projectPath) return { success: false, error: 'No project path' }
    const g = getGit(projectPath)
    try {
      const branch = (await g.branchLocal()).current
      // Stash uncommitted changes
      const status = await g.status()
      const hadChanges = status.files.length > 0
      if (hadChanges) {
        await g.stash(['push', '-m', 'claude-canvas-auto-stash'])
      }
      // Pull with rebase
      await g.pull('origin', branch, { '--rebase': null })
      // Pop stash if we stashed
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

  ipcMain.handle(
    'git:squashAndPush',
    async (_event, projectPath: string, message: string) => {
      if (!projectPath) return { success: false, error: 'No project path' }
      const g = getGit(projectPath)
      try {
        const branch = (await g.branchLocal()).current

        // Find the fork point from the remote tracking branch
        let forkPoint: string
        try {
          forkPoint = (await g.raw(['merge-base', `origin/${branch}`, 'HEAD'])).trim()
        } catch {
          // No remote tracking — just push the current commit
          await g.push('origin', branch, { '--set-upstream': null })
          return { success: true, branch }
        }

        // Check if there are commits to squash
        const logOutput = await g.raw(['rev-list', '--count', `${forkPoint}..HEAD`])
        const commitCount = parseInt(logOutput.trim(), 10)

        if (commitCount <= 1) {
          // 0 or 1 commit — just amend message if needed, then push
          if (commitCount === 1) {
            await g.raw(['commit', '--amend', '-m', message])
          }
          await g.push('origin', branch, { '--set-upstream': null, '--force-with-lease': null })
          return { success: true, branch }
        }

        // Soft reset to fork point, re-commit as one
        await g.raw(['reset', '--soft', forkPoint])
        await g.commit(message)
        await g.push('origin', branch, { '--set-upstream': null, '--force-with-lease': null })
        return { success: true, branch }
      } catch (err: any) {
        // If push rejected, signal caller to pull first
        if (err?.message?.includes('rejected') || err?.message?.includes('non-fast-forward')) {
          return { success: false, error: 'rejected', needsPull: true }
        }
        return { success: false, error: err?.message || 'Push failed' }
      }
    }
  )

  ipcMain.handle('git:generateCommitMessage', async (_event, projectPath: string) => {
    if (!projectPath) return ''
    const g = getGit(projectPath)
    try {
      const branch = (await g.branchLocal()).current
      // Get a compact diff summary
      let diffStat: string
      try {
        diffStat = await g.raw(['diff', '--stat', `origin/${branch}...HEAD`])
      } catch {
        diffStat = await g.raw(['diff', '--stat', 'HEAD~1'])
      }
      if (!diffStat.trim()) return ''

      // Use claude CLI to generate the message
      return new Promise<string>((resolve) => {
        const prompt = `Generate a concise one-line git commit message (max 72 chars) for these changes. Reply with ONLY the message, no quotes, no prefix:\n\n${diffStat}`
        execFile('claude', ['--print', prompt], {
          timeout: 15000,
          env: { ...process.env }
        }, (err, stdout) => {
          if (err || !stdout.trim()) {
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

  ipcMain.handle(
    'git:createPr',
    async (
      _event,
      projectPath: string,
      opts: { title: string; body: string; base: string }
    ) => {
      if (!projectPath) return { error: 'No project path' }
      const token = settingsStore.get('oauthTokens.github') as string | undefined
      if (!token) return { error: 'Not authenticated with GitHub' }

      const g = getGit(projectPath)
      try {
        const branch = (await g.branchLocal()).current
        const remotes = await g.getRemotes(true)
        const origin = remotes.find((r) => r.name === 'origin')
        const remoteUrl = origin?.refs?.push || origin?.refs?.fetch || ''

        // Parse owner/repo from remote URL
        const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/)
        if (!match) return { error: 'Could not parse GitHub repo from remote URL' }
        const [, owner, repo] = match

        // Create PR via GitHub API
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
    }
  )
}
