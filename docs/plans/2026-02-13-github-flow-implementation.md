# GitHub Flow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add push, pull, auto-fetch, AI commit messages, and one-click PR creation to Claude Canvas.

**Architecture:** simple-git handles all git operations in the main process. GitHub REST API (with stored OAuth token) handles PR creation. StatusBar gets sync indicators and a push popover. Auto-fetch runs on tab focus + 3-minute interval. Commit messages generated via `claude --print`.

**Tech Stack:** simple-git, Electron IPC, Zustand, React, Framer Motion, GitHub REST API, Claude CLI

---

### Task 1: Add Git Sync Fields to TabState

**Files:**
- Modify: `src/renderer/stores/tabs.ts`

**Step 1: Add fields to TabState interface**

In `src/renderer/stores/tabs.ts`, add after line 35 (`worktreePath: string | null`):

```typescript
  // Git sync
  gitAhead: number
  gitBehind: number
  gitSyncing: boolean
  gitRemoteConfigured: boolean
```

**Step 2: Add defaults to createDefaultTabState**

In `createDefaultTabState`, add after `worktreePath: null,` (line 58):

```typescript
    gitAhead: 0,
    gitBehind: 0,
    gitSyncing: false,
    gitRemoteConfigured: false,
```

**Step 3: Build and verify**

Run: `npx electron-vite build`
Expected: Clean build, no errors.

**Step 4: Commit**

```bash
git add src/renderer/stores/tabs.ts
git commit -m "feat(git-sync): add git sync fields to TabState"
```

---

### Task 2: Add git:fetch Handler

**Files:**
- Modify: `src/main/services/git.ts`

**Step 1: Add the fetch handler**

In `setupGitHandlers()` in `src/main/services/git.ts`, add after the `git:setRemote` handler (after line 199):

```typescript
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
```

**Step 2: Build and verify**

Run: `npx electron-vite build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add src/main/services/git.ts
git commit -m "feat(git-sync): add git:fetch handler with ahead/behind counts"
```

---

### Task 3: Add git:pull Handler

**Files:**
- Modify: `src/main/services/git.ts`

**Step 1: Add the pull handler**

After the `git:fetch` handler, add:

```typescript
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
```

**Step 2: Build and verify**

Run: `npx electron-vite build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add src/main/services/git.ts
git commit -m "feat(git-sync): add git:pull handler with stash/rebase/pop"
```

---

### Task 4: Add git:squashAndPush Handler

**Files:**
- Modify: `src/main/services/git.ts`

**Step 1: Add the squash+push handler**

After `git:pull`, add:

```typescript
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
```

**Step 2: Build and verify**

Run: `npx electron-vite build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add src/main/services/git.ts
git commit -m "feat(git-sync): add git:squashAndPush handler"
```

---

### Task 5: Add git:generateCommitMessage Handler

**Files:**
- Modify: `src/main/services/git.ts`

**Step 1: Add the AI commit message handler**

Add at the top of the file (after line 4):

```typescript
import { execFile } from 'child_process'
```

Then after the `git:squashAndPush` handler, add:

```typescript
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
        const child = execFile('claude', ['--print', prompt], {
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
```

**Step 2: Build and verify**

Run: `npx electron-vite build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add src/main/services/git.ts
git commit -m "feat(git-sync): add AI commit message generation via claude CLI"
```

---

### Task 6: Add git:createPr Handler

**Files:**
- Modify: `src/main/services/git.ts`

**Step 1: Add GitHub API helper and PR handler**

Add at the top (after the `execFile` import):

```typescript
import { net } from 'electron'
import { settingsStore } from '../store'
```

Then after `git:generateCommitMessage`, add:

```typescript
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
```

**Step 2: Build and verify**

Run: `npx electron-vite build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add src/main/services/git.ts
git commit -m "feat(git-sync): add git:createPr handler via GitHub REST API"
```

---

### Task 7: Expose New Handlers in Preload Bridge

**Files:**
- Modify: `src/preload/index.ts`

**Step 1: Add new methods to the git section**

In `src/preload/index.ts`, inside the `git: { ... }` object (after `setRemote` around line 98), add:

```typescript
    fetch: (projectPath: string) =>
      ipcRenderer.invoke('git:fetch', projectPath) as Promise<{ ahead: number; behind: number; error?: string }>,
    pull: (projectPath: string) =>
      ipcRenderer.invoke('git:pull', projectPath) as Promise<{ success: boolean; conflicts?: boolean; error?: string }>,
    squashAndPush: (projectPath: string, message: string) =>
      ipcRenderer.invoke('git:squashAndPush', projectPath, message) as Promise<
        { success: true; branch: string } | { success: false; error: string; needsPull?: boolean }
      >,
    generateCommitMessage: (projectPath: string) =>
      ipcRenderer.invoke('git:generateCommitMessage', projectPath) as Promise<string>,
    createPr: (projectPath: string, opts: { title: string; body: string; base: string }) =>
      ipcRenderer.invoke('git:createPr', projectPath, opts) as Promise<
        { url: string; number: number } | { error: string }
      >
```

**Step 2: Update test mocks**

In `src/renderer/__tests__/setup.ts`, add to the `git` mock object:

```typescript
    fetch: vi.fn().mockResolvedValue({ ahead: 0, behind: 0 }),
    pull: vi.fn().mockResolvedValue({ success: true, conflicts: false }),
    squashAndPush: vi.fn().mockResolvedValue({ success: true, branch: 'main' }),
    generateCommitMessage: vi.fn().mockResolvedValue('Update components'),
    createPr: vi.fn().mockResolvedValue({ url: 'https://github.com/test/repo/pull/1', number: 1 }),
```

**Step 3: Build and run tests**

Run: `npx electron-vite build && npm test`
Expected: Clean build, all tests pass.

**Step 4: Commit**

```bash
git add src/preload/index.ts src/renderer/__tests__/setup.ts
git commit -m "feat(git-sync): expose git sync handlers in preload bridge"
```

---

### Task 8: Add Action Button Support to Toast System

The post-push toast needs a "Create PR" button. The current toast system only supports text.

**Files:**
- Modify: `src/renderer/stores/toast.ts`
- Modify: `src/renderer/components/Toast/Toast.tsx`

**Step 1: Update the Toast interface**

Replace the contents of `src/renderer/stores/toast.ts`:

```typescript
import { create } from 'zustand'

interface Toast {
  id: string
  message: string
  type: 'info' | 'success' | 'error'
  action?: { label: string; onClick: () => void }
  duration?: number
}

interface ToastStore {
  toasts: Toast[]
  addToast: (
    message: string,
    type?: 'info' | 'success' | 'error',
    opts?: { action?: { label: string; onClick: () => void }; duration?: number }
  ) => void
  removeToast: (id: string) => void
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (message, type = 'info', opts) => {
    const id = `toast-${Date.now()}`
    const duration = opts?.duration ?? 4000
    set((s) => ({ toasts: [...s.toasts, { id, message, type, action: opts?.action, duration }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, duration)
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))
```

**Step 2: Update Toast component to render action button**

In `src/renderer/components/Toast/Toast.tsx`, replace the toast content inside the `motion.div`:

```tsx
              <Icon size={14} />
              <span className="text-sm text-white/80">{toast.message}</span>
              {toast.action && (
                <button
                  onClick={() => {
                    toast.action!.onClick()
                    removeToast(toast.id)
                  }}
                  className="ml-1 px-2 py-0.5 text-xs rounded bg-white/10 hover:bg-white/20 text-white/80 transition-colors"
                >
                  {toast.action.label}
                </button>
              )}
              <button onClick={() => removeToast(toast.id)} className="ml-2 text-white/30 hover:text-white/60">
                <X size={12} />
              </button>
```

**Step 3: Verify existing toast callers still work**

All existing callers use `addToast(message, type)` with no third argument — the new `opts` parameter is optional, so no callers need updating.

Run: `npx electron-vite build && npm test`
Expected: Clean build, all tests pass.

**Step 4: Commit**

```bash
git add src/renderer/stores/toast.ts src/renderer/components/Toast/Toast.tsx
git commit -m "feat(git-sync): add action button support to toast system"
```

---

### Task 9: Create useGitSync Hook

**Files:**
- Create: `src/renderer/hooks/useGitSync.ts`

**Step 1: Create the hook**

```typescript
import { useEffect, useRef } from 'react'
import { useTabsStore } from '@/stores/tabs'

const FETCH_INTERVAL_MS = 3 * 60 * 1000 // 3 minutes

/**
 * Auto-fetches from remote on tab focus and every 3 minutes.
 * Stores ahead/behind counts in the active tab's state.
 */
export function useGitSync() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const fetchForActiveTab = async () => {
      const tab = useTabsStore.getState().getActiveTab()
      if (!tab) return

      const projectPath = tab.project.path
      try {
        // Check if remote exists first
        const remoteUrl = await window.api.git.remoteUrl(projectPath)
        const hasRemote = !!remoteUrl

        if (!hasRemote) {
          useTabsStore.getState().updateTab(tab.id, {
            gitRemoteConfigured: false,
            gitAhead: 0,
            gitBehind: 0,
          })
          return
        }

        useTabsStore.getState().updateTab(tab.id, { gitRemoteConfigured: true })

        const result = await window.api.git.fetch(projectPath)
        if (!result.error) {
          useTabsStore.getState().updateTab(tab.id, {
            gitAhead: result.ahead,
            gitBehind: result.behind,
          })
        }
      } catch {
        // Network error — silently ignore, don't update counts
      }
    }

    // Fetch on mount (tab activated)
    fetchForActiveTab()

    // Fetch every 3 minutes
    intervalRef.current = setInterval(fetchForActiveTab, FETCH_INTERVAL_MS)

    // Fetch when window regains focus
    const onFocus = () => fetchForActiveTab()
    window.addEventListener('focus', onFocus)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      window.removeEventListener('focus', onFocus)
    }
  }, [useTabsStore((s) => s.activeTabId)]) // re-run when active tab changes
}
```

**Step 2: Wire into App.tsx**

In `src/renderer/App.tsx`, add the import:

```typescript
import { useGitSync } from './hooks/useGitSync'
```

And call it inside `App()`, after the other hooks:

```typescript
  useGitSync()
```

**Step 3: Build and verify**

Run: `npx electron-vite build`
Expected: Clean build.

**Step 4: Commit**

```bash
git add src/renderer/hooks/useGitSync.ts src/renderer/App.tsx
git commit -m "feat(git-sync): add useGitSync hook with auto-fetch"
```

---

### Task 10: Create PushPopover Component

**Files:**
- Create: `src/renderer/components/StatusBar/PushPopover.tsx`

**Step 1: Create the popover**

```tsx
import { useState, useEffect, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Loader2, ArrowUpRight } from 'lucide-react'
import { useTabsStore } from '@/stores/tabs'
import { useToastStore } from '@/stores/toast'
import { shell } from 'electron'

interface PushPopoverProps {
  onClose: () => void
}

export function PushPopover({ onClose }: PushPopoverProps) {
  const [message, setMessage] = useState('')
  const [generating, setGenerating] = useState(true)
  const [pushing, setPushing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const tab = useTabsStore((s) => s.getActiveTab())
  const projectPath = tab?.project.path

  // Generate AI commit message on mount
  useEffect(() => {
    if (!projectPath) return
    setGenerating(true)
    window.api.git.generateCommitMessage(projectPath).then((msg) => {
      setMessage(msg || '')
      setGenerating(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    })
  }, [projectPath])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const handlePush = useCallback(async () => {
    if (!projectPath || !message.trim() || pushing) return
    setPushing(true)
    const { addToast } = useToastStore.getState()

    const result = await window.api.git.squashAndPush(projectPath, message.trim())

    if (result.success) {
      const branch = result.branch
      const isMain = branch === 'main' || branch === 'master'

      // Refresh sync counts
      const counts = await window.api.git.fetch(projectPath)
      if (tab) {
        useTabsStore.getState().updateTab(tab.id, {
          gitAhead: counts.ahead || 0,
          gitBehind: counts.behind || 0,
          gitSyncing: false,
        })
      }

      if (isMain) {
        addToast(`Pushed to origin/${branch}`, 'success')
      } else {
        addToast(`Pushed to origin/${branch}`, 'success', {
          duration: 6000,
          action: {
            label: 'Create PR',
            onClick: async () => {
              // Generate PR body
              let body = ''
              try {
                body = await window.api.git.generateCommitMessage(projectPath)
              } catch {}
              const prResult = await window.api.git.createPr(projectPath, {
                title: message.trim(),
                body,
                base: 'main',
              })
              if ('url' in prResult) {
                addToast(`PR #${prResult.number} created`, 'success', {
                  duration: 6000,
                  action: {
                    label: 'Open',
                    onClick: () => window.open(prResult.url, '_blank'),
                  },
                })
              } else {
                addToast(`PR failed: ${prResult.error}`, 'error')
              }
            },
          },
        })
      }
      onClose()
    } else {
      if ('needsPull' in result && result.needsPull) {
        addToast('Push rejected — pulling changes first...', 'info')
        const pullResult = await window.api.git.pull(projectPath)
        if (pullResult.success && !pullResult.conflicts) {
          // Retry push
          const retryResult = await window.api.git.squashAndPush(projectPath, message.trim())
          if (retryResult.success) {
            addToast(`Pushed to origin/${retryResult.branch}`, 'success')
            onClose()
            return
          }
        } else if (pullResult.conflicts) {
          addToast('Conflicts detected — resolve in terminal', 'error')
        }
      } else {
        addToast(`Push failed: ${result.error}`, 'error')
      }
      setPushing(false)
    }
  }, [projectPath, message, pushing, tab, onClose])

  return (
    <motion.div
      ref={popoverRef}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.12 }}
      className="absolute bottom-full mb-2 right-0 w-72 bg-[var(--bg-tertiary)] border border-white/10 rounded-lg shadow-xl z-[200] p-3"
    >
      <div className="text-[11px] text-white/40 mb-2">Commit message</div>
      <input
        ref={inputRef}
        type="text"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handlePush()}
        placeholder={generating ? 'Generating message...' : 'What did you change?'}
        disabled={generating || pushing}
        className="w-full px-2.5 py-1.5 bg-[var(--bg-primary)] border border-white/10 rounded text-xs text-white placeholder-white/20 focus:outline-none focus:border-[var(--accent-cyan)]/50 disabled:opacity-50"
      />
      {generating && (
        <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-white/30">
          <Loader2 size={10} className="animate-spin" />
          AI generating...
        </div>
      )}
      <button
        onClick={handlePush}
        disabled={!message.trim() || generating || pushing}
        className="w-full mt-2 py-1.5 text-xs bg-[var(--accent-cyan)] text-black rounded font-medium disabled:opacity-40 flex items-center justify-center gap-1"
      >
        {pushing ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <>
            <ArrowUpRight size={12} />
            Push
          </>
        )}
      </button>
    </motion.div>
  )
}
```

**Step 2: Build and verify**

Run: `npx electron-vite build`
Expected: Clean build.

**Step 3: Commit**

```bash
git add src/renderer/components/StatusBar/PushPopover.tsx
git commit -m "feat(git-sync): create PushPopover with AI commit message"
```

---

### Task 11: Add Git Sync Controls to StatusBar

**Files:**
- Modify: `src/renderer/components/StatusBar/StatusBar.tsx`

**Step 1: Add imports**

At the top of StatusBar.tsx, update imports:

```typescript
import { useProjectStore } from '@/stores/project'
import { useCanvasStore } from '@/stores/canvas'
import { useWorkspaceStore } from '@/stores/workspace'
import { useToastStore } from '@/stores/toast'
import { useTabsStore } from '@/stores/tabs'
import {
  GitBranch, Play, Square, PanelRight, Eye, Loader2, FolderOpen,
  ArrowDown, ArrowUp, Check
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { PushPopover } from './PushPopover'
```

**Step 2: Add sync state and handlers**

Inside the `StatusBar` function, after `const activeTab = ...`, add:

```typescript
  const gitAhead = activeTab?.gitAhead ?? 0
  const gitBehind = activeTab?.gitBehind ?? 0
  const gitSyncing = activeTab?.gitSyncing ?? false
  const gitRemoteConfigured = activeTab?.gitRemoteConfigured ?? false
  const [showPushPopover, setShowPushPopover] = useState(false)
  const [pulling, setPulling] = useState(false)

  const handlePull = useCallback(async () => {
    const path = activeTab?.project.path
    if (!path || pulling) return
    setPulling(true)
    const { addToast } = useToastStore.getState()
    const result = await window.api.git.pull(path)
    if (result.success) {
      if (result.conflicts) {
        addToast('Pulled with conflicts — resolve in terminal', 'error')
      } else {
        addToast('Pulled latest changes', 'success')
      }
      // Refresh counts
      const counts = await window.api.git.fetch(path)
      if (activeTab) {
        useTabsStore.getState().updateTab(activeTab.id, {
          gitAhead: counts.ahead || 0,
          gitBehind: counts.behind || 0,
        })
      }
    } else {
      addToast(`Pull failed: ${result.error}`, 'error')
    }
    setPulling(false)
  }, [activeTab, pulling])
```

**Step 3: Add sync indicators to the JSX**

In the right-side `div` (the one with `className="flex items-center gap-3"`), add **before** the dev server start/stop section:

```tsx
        {/* Git sync indicators */}
        {gitRemoteConfigured && (
          <>
            {gitBehind > 0 && (
              <button
                onClick={handlePull}
                disabled={pulling}
                className="flex items-center gap-1 text-yellow-400 hover:text-yellow-300 transition-colors"
                title="Pull from remote"
              >
                {pulling ? <Loader2 size={10} className="animate-spin" /> : <ArrowDown size={10} />}
                <span>{gitBehind} Pull</span>
              </button>
            )}
            <div className="relative">
              {gitAhead > 0 ? (
                <button
                  onClick={() => setShowPushPopover((p) => !p)}
                  className="flex items-center gap-1 text-[var(--accent-cyan)] hover:text-white transition-colors"
                  title="Push to remote"
                >
                  <ArrowUp size={10} />
                  <span>{gitAhead} Push</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-cyan)] animate-pulse" />
                </button>
              ) : gitBehind === 0 ? (
                <span className="flex items-center gap-1 text-white/20">
                  <Check size={10} />
                  <span>Synced</span>
                </span>
              ) : null}
              <AnimatePresence>
                {showPushPopover && <PushPopover onClose={() => setShowPushPopover(false)} />}
              </AnimatePresence>
            </div>
          </>
        )}
```

**Step 4: Build and verify**

Run: `npx electron-vite build`
Expected: Clean build.

**Step 5: Commit**

```bash
git add src/renderer/components/StatusBar/StatusBar.tsx
git commit -m "feat(git-sync): add pull/push/synced indicators to StatusBar"
```

---

### Task 12: End-to-End Verification

**Step 1: Run full build**

Run: `npx electron-vite build`
Expected: Clean build, no errors.

**Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass (65+).

**Step 3: Manual smoke test**

Run: `npm run dev`

Verify:
1. Open a project with a GitHub remote → StatusBar shows "✓ Synced" or ahead/behind counts
2. Make an edit, create a checkpoint → StatusBar shows "↑ 1 Push" with pulsing dot
3. Click Push → popover appears with AI-generated message
4. Edit message, hit Enter → pushes, shows success toast
5. If on a branch: toast shows "Create PR" button
6. Click "Create PR" → PR created, toast shows PR link
7. Open a project with no remote → no sync indicators shown
8. Switch tabs → auto-fetch runs for the new tab

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(git-sync): complete GitHub flow with push, pull, and PR creation"
```
