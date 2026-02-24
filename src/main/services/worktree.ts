import { ipcMain } from 'electron'
import { getGit, withEbadfRetry, enqueue } from './git'

export function setupWorktreeHandlers(): void {
  ipcMain.handle('worktree:list', async (_event, projectPath: string) => {
    return enqueue(projectPath, async () => {
      try {
        const git = getGit(projectPath)
        const raw = await withEbadfRetry(() => git.raw(['worktree', 'list', '--porcelain']), 3, 'worktree:list')
        return parseWorktreeList(raw)
      } catch (err: any) {
        console.error('[worktree] list failed:', err?.message)
        return { error: err?.message || 'Failed to list worktrees' }
      }
    })
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
      return enqueue(opts.projectPath, async () => {
        try {
          const git = getGit(opts.projectPath)
          await withEbadfRetry(() =>
            git.raw(['worktree', 'add', opts.targetDir, '-b', opts.branchName]),
            3, 'worktree:create'
          )
          return { path: opts.targetDir, branch: opts.branchName }
        } catch (err: any) {
          console.error('[worktree] create failed:', err?.message)
          return { error: err?.message || 'Failed to create worktree' }
        }
      })
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
      return enqueue(opts.projectPath, async () => {
        try {
          const git = getGit(opts.projectPath)
          await withEbadfRetry(() =>
            git.raw(['worktree', 'add', opts.targetDir, opts.branchName]),
            3, 'worktree:checkout'
          )
          return { path: opts.targetDir, branch: opts.branchName }
        } catch (err: any) {
          console.error('[worktree] checkout failed:', err?.message)
          return { error: err?.message || 'Failed to checkout worktree' }
        }
      })
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
      return enqueue(opts.projectPath, async () => {
        try {
          const git = getGit(opts.projectPath)
          await withEbadfRetry(() =>
            git.raw(['worktree', 'remove', opts.worktreePath]),
            3, 'worktree:remove'
          )
          return { ok: true }
        } catch (err: any) {
          console.error('[worktree] remove failed:', err?.message)
          return { error: err?.message || 'Failed to remove worktree' }
        }
      })
    }
  )

  ipcMain.handle('worktree:branches', async (_event, projectPath: string) => {
    return enqueue(projectPath, async () => {
      try {
        const git = getGit(projectPath)
        const summary = await withEbadfRetry(() => git.branchLocal(), 3, 'worktree:branches')
        return { current: summary.current, branches: summary.all }
      } catch (err: any) {
        console.error('[worktree] branches failed:', err?.message)
        return { error: err?.message || 'Failed to list branches' }
      }
    })
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
