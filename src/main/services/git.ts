import { ipcMain } from 'electron'
import simpleGit, { SimpleGit } from 'simple-git'

let git: SimpleGit | null = null

export function setupGitHandlers(): void {
  ipcMain.handle('git:init', (_event, cwd: string) => {
    git = simpleGit(cwd)
    return true
  })

  ipcMain.handle('git:status', async () => {
    if (!git) return null
    return git.status()
  })

  ipcMain.handle('git:branch', async () => {
    if (!git) return null
    const summary = await git.branchLocal()
    return { current: summary.current, branches: summary.all }
  })

  ipcMain.handle('git:log', async (_event, maxCount?: number) => {
    if (!git) return []
    const log = await git.log({ maxCount: maxCount || 20 })
    return log.all.map((entry) => ({
      hash: entry.hash,
      message: entry.message,
      date: entry.date,
      author: entry.author_name
    }))
  })

  ipcMain.handle('git:checkpoint', async (_event, message: string) => {
    if (!git) return null
    await git.add('.')
    const result = await git.commit(`[checkpoint] ${message}`)
    return { hash: result.commit, message }
  })

  ipcMain.handle('git:diff', async (_event, hash?: string) => {
    if (!git) return ''
    if (hash) {
      return git.diff([`${hash}~1`, hash])
    }
    return git.diff()
  })

  ipcMain.handle('git:show', async (_event, hash: string, filePath: string) => {
    if (!git) return ''
    return git.show([`${hash}:${filePath}`])
  })
}
