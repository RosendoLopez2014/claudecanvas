import { ipcMain } from 'electron'
import simpleGit from 'simple-git'

export function setupWorktreeHandlers(): void {
  ipcMain.handle('worktree:list', async (_event, projectPath: string) => {
    const git = simpleGit(projectPath)
    const raw = await git.raw(['worktree', 'list', '--porcelain'])
    return parseWorktreeList(raw)
  })

  ipcMain.handle(
    'worktree:create',
    async (
      _event,
      opts: {
        projectPath: string
        branchName: string
        targetDir: string
      }
    ) => {
      const git = simpleGit(opts.projectPath)
      await git.raw(['worktree', 'add', opts.targetDir, '-b', opts.branchName])
      return { path: opts.targetDir, branch: opts.branchName }
    }
  )

  ipcMain.handle(
    'worktree:checkout',
    async (
      _event,
      opts: {
        projectPath: string
        branchName: string
        targetDir: string
      }
    ) => {
      const git = simpleGit(opts.projectPath)
      await git.raw(['worktree', 'add', opts.targetDir, opts.branchName])
      return { path: opts.targetDir, branch: opts.branchName }
    }
  )

  ipcMain.handle(
    'worktree:remove',
    async (
      _event,
      opts: {
        projectPath: string
        worktreePath: string
      }
    ) => {
      const git = simpleGit(opts.projectPath)
      await git.raw(['worktree', 'remove', opts.worktreePath])
      return { ok: true }
    }
  )

  ipcMain.handle('worktree:branches', async (_event, projectPath: string) => {
    const git = simpleGit(projectPath)
    const summary = await git.branchLocal()
    return { current: summary.current, branches: summary.all }
  })
}

function parseWorktreeList(
  raw: string
): Array<{ path: string; branch: string; head: string }> {
  const entries: Array<{ path: string; branch: string; head: string }> = []
  const blocks = raw.trim().split('\n\n')
  for (const block of blocks) {
    const lines = block.split('\n')
    const pathLine = lines.find((l) => l.startsWith('worktree '))
    const headLine = lines.find((l) => l.startsWith('HEAD '))
    const branchLine = lines.find((l) => l.startsWith('branch '))
    if (pathLine) {
      entries.push({
        path: pathLine.replace('worktree ', ''),
        head: headLine?.replace('HEAD ', '') || '',
        branch: branchLine?.replace('branch refs/heads/', '') || 'detached'
      })
    }
  }
  return entries
}
