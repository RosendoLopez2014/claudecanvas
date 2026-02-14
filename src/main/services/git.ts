import { ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import simpleGit, { SimpleGit } from 'simple-git'

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
}
